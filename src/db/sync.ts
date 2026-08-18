import { db, withoutOutboxTracking } from './dexie'
import { supabase } from '../api/supabaseClient'
import { SYNC_CONFIG } from './syncMapping'

// 表的拉取顺序有讲究：itineraryItems 拉回来时要用 itineraryDays 已经落地的
// day->trip 映射去补 tripId（远端 itinerary_item 表本身没有 trip_id 列），
// 所以 itineraryDays 必须排在 itineraryItems 前面
const TABLE_ORDER = [
  'trips',
  'members',
  'tripMembers',
  'itineraryDays',
  'itineraryItems',
  'rateBookEntries',
  'expenses',
  'expenseSplits',
  'expenseDayAllocations',
  'budgets',
  'settlements',
  'feedback',
] as const

// Supabase 的错误是普通对象（PostgrestError：message/details/hint/code），不是 Error 实例，
// 用 String(err) 只会得到没用的 "[object Object]"，这里把有用的字段拼出来方便排查
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    return [e.message, e.details, e.hint, e.code].filter(Boolean).join(' | ') || JSON.stringify(err)
  }
  return String(err)
}

export async function pushOutbox(): Promise<{ pushed: number; failed: number }> {
  if (!supabase) return { pushed: 0, failed: 0 }

  const pending = await db.outbox.where('status').equals('pending').sortBy('createdAt')
  let pushed = 0
  let failed = 0

  // expenseSplits 不逐行推送（原因见 db/dexie.ts SYNCED_TABLES 的注释和
  // 0009_atomic_expense_split_push.sql）——按 expense_id 分组，每组只用当下
  // db.expenseSplits 里真实的本地行数据整批调用 replace_expense_splits() 原子推送，
  // 完全不看 entry.payload 里存的是什么形状。这样天然也兼容升级前遗留在本地、
  // 还是旧版单行 payload 形状的 pending entry——反正只用它的 expenseId 分组，
  // 具体分摊金额一律以本地当前数据为准
  const splitEntries = pending.filter((e) => e.tableName === 'expenseSplits')
  const otherEntries = pending.filter((e) => e.tableName !== 'expenseSplits')

  const expenseIds = [...new Set(splitEntries.map((e) => (e.payload as { expenseId?: string } | null)?.expenseId).filter((id): id is string => !!id))]
  for (const expenseId of expenseIds) {
    const group = splitEntries.filter((e) => (e.payload as { expenseId?: string } | null)?.expenseId === expenseId)
    try {
      const rows = await db.expenseSplits.where('expenseId').equals(expenseId).toArray()
      const { error } = await supabase.rpc('replace_expense_splits', {
        p_expense_id: expenseId,
        p_rows: rows.map((r) => ({ id: r.id, member_id: r.memberId, share_amount: r.shareAmount })),
      })
      if (error) throw error
      await Promise.all(group.map((e) => db.outbox.update(e.id, { status: 'synced' })))
      pushed += group.length
    } catch (err) {
      failed += group.length
      const lastError = describeError(err)
      await Promise.all(group.map((e) => db.outbox.update(e.id, { attempts: e.attempts + 1, lastError })))
    }
  }

  for (const entry of otherEntries) {
    const config = SYNC_CONFIG[entry.tableName]
    if (!config) {
      // 理论上不会出现未知表名；出现了也不能让它卡住队列，直接跳过
      await db.outbox.update(entry.id, { status: 'synced' })
      continue
    }

    try {
      if (entry.operation === 'delete') {
        if (config.conflictColumns === 'id') {
          const { error } = await supabase.from(config.remoteTable).delete().eq('id', entry.recordId)
          if (error) throw error
        } else {
          // 目前只有 tripMembers 用复合键，而这张表从未被真正写入过，这个分支是为
          // 将来万一启用而准备的占位实现：recordId 约定成 "tripId:memberId" 格式
          const [tripId, memberId] = entry.recordId.split(':')
          const { error } = await supabase.from(config.remoteTable).delete().match({ trip_id: tripId, member_id: memberId })
          if (error) throw error
        }
      } else {
        const remoteRow = config.toRemote(entry.payload)
        const { error } = await supabase.from(config.remoteTable).upsert(remoteRow, { onConflict: config.conflictColumns })
        if (error) throw error
      }
      await db.outbox.update(entry.id, { status: 'synced' })
      pushed++
    } catch (err) {
      failed++
      await db.outbox.update(entry.id, {
        attempts: entry.attempts + 1,
        lastError: describeError(err),
      })
    }
  }

  return { pushed, failed }
}

export async function pullAll(): Promise<void> {
  if (!supabase) return

  let dayToTrip: Map<string, string> | null = null

  for (const tableName of TABLE_ORDER) {
    const config = SYNC_CONFIG[tableName]
    const { data, error } = await supabase.from(config.remoteTable).select('*')
    if (error || !data) continue // 这张表这次拉失败就跳过，不阻塞其他表，下个周期重试

    const table = db.table(tableName)
    const localRows = await table.toArray()
    const localById = new Map(localRows.map((r: any) => [r.id, r]))

    const pendingIds = new Set(
      (await db.outbox.where('tableName').equals(tableName).toArray())
        .filter((e) => e.status === 'pending')
        .map((e) => e.recordId),
    )

    const toPut: any[] = []
    for (const remoteRow of data) {
      const localRow = config.fromRemote(remoteRow)

      if (tableName === 'itineraryItems' && dayToTrip) {
        localRow.tripId = dayToTrip.get(localRow.dayId) ?? localRow.tripId
      }

      if (config.hasUpdatedAt) {
        const existing = localById.get(localRow.id)
        // 本地有还没推上去的更新改动，这一轮先不覆盖——等那条推成功后下一轮自然就一致了
        if (existing && existing.updatedAt > localRow.updatedAt) continue
      }
      toPut.push(localRow)
    }

    if (toPut.length) {
      await withoutOutboxTracking(() => table.bulkPut(toPut))
    }

    // 远端已经没有、本地也没有待推送记录的行，说明是别的设备删除的，本地也跟着删掉
    const remoteIds = new Set(data.map((r: any) => r.id))
    const idsToDelete = localRows
      .map((r: any) => r.id)
      .filter((id: string) => !remoteIds.has(id) && !pendingIds.has(id))
    if (idsToDelete.length) {
      await withoutOutboxTracking(() => table.bulkDelete(idsToDelete))
    }

    if (tableName === 'itineraryDays') {
      const allDays = await db.itineraryDays.toArray()
      dayToTrip = new Map(allDays.map((d) => [d.id, d.tripId]))
    }
  }
}

export async function runSync(): Promise<void> {
  if (!supabase) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  try {
    await pushOutbox()
    await pullAll()
  } catch {
    // 网络抖动/偶发失败，下个周期自然会重试，这里不需要往上抛出打断调用方
  }
}

let syncTimer: ReturnType<typeof setInterval> | null = null

// 启动周期性同步：一进App先跑一次，之后每30秒跑一次，网络恢复时也立刻跑一次
export function startAutoSync() {
  if (!supabase) return
  void runSync()
  window.addEventListener('online', () => void runSync())
  if (syncTimer) return
  syncTimer = setInterval(() => void runSync(), 30_000)
}
