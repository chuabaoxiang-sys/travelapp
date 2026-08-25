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
  'expenseRateAllocations',
  'budgets',
  'settlements',
  'feedback',
  'wishlistPlaces',
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

// 哪些本地行该当成"远端已删除"清掉——单独抽成纯函数，不用连supabase就能测。
//
// expenseSplits是唯一的例外：它不逐行进outbox，pushOutbox按expenseId分组整批推送
// （见0009_atomic_expense_split_push.sql），所以它的outbox条目recordId存的是
// expenseId，不是每一行分摊记录自己的id——如果直接拿"这一行的id在不在pendingIds
// 里"来判断，永远查不到（比较的根本不是同一种id），保护形同虚设。真实后果：
// 刚记完一笔分摊、推送还没落地remote时，如果这时候恰好跑到pullAll（比如两次
// 自动同步之间的间隔撞上了），remote这时还查不到这几行，会被当成"远端已删除"
// 直接清掉本地——这正是"默认保存后分摊变成0"这个bug的根因，而且不是偶发：
// 只要保存和同步时机凑在一起就必然触发，跟输入的具体内容无关
export function computeIdsToDelete(
  tableName: string,
  localRows: { id: string; expenseId?: string }[],
  remoteIds: Set<string>,
  pendingIds: Set<string>,
): string[] {
  const isPending = tableName === 'expenseSplits'
    ? (r: { id: string; expenseId?: string }) => pendingIds.has(r.expenseId ?? '')
    : (r: { id: string }) => pendingIds.has(r.id)
  return localRows.filter((r) => !remoteIds.has(r.id) && !isPending(r)).map((r) => r.id)
}

// 返回"这一轮真的有多少行发生了变化"，给UI用来提示"刚拿到新东西"。
// 注意不能直接用 toPut.length 当这个数字——每一轮都会把远端所有行原样 bulkPut 回本地，
// 所以 toPut 基本恒等于全表行数，拿它当"有新数据"会导致每轮都误报。这里只数真正
// 有差异的：本地压根没有的行、或者 updatedAt 变了的行，加上被删掉的行。
export async function pullAll(): Promise<number> {
  if (!supabase) return 0
  let changed = 0

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

      const existing = localById.get(localRow.id)
      if (config.hasUpdatedAt) {
        // 本地有还没推上去的更新改动，这一轮先不覆盖——等那条推成功后下一轮自然就一致了
        if (existing && existing.updatedAt > localRow.updatedAt) continue
        if (!existing || existing.updatedAt !== localRow.updatedAt) changed++
      } else if (!existing) {
        // 没有 updatedAt 的表只认"本地压根没这行"，改动无法便宜地判断，宁可少报不误报
        changed++
      }
      toPut.push(localRow)
    }

    if (toPut.length) {
      await withoutOutboxTracking(() => table.bulkPut(toPut))
    }

    // 远端已经没有、本地也没有待推送记录的行，说明是别的设备删除的，本地也跟着删掉
    // （expenseSplits这张表的判断逻辑见computeIdsToDelete的注释）
    const remoteIds = new Set(data.map((r: any) => r.id))
    const idsToDelete = computeIdsToDelete(tableName, localRows, remoteIds, pendingIds)
    if (idsToDelete.length) {
      await withoutOutboxTracking(() => table.bulkDelete(idsToDelete))
      changed += idsToDelete.length
    }

    if (tableName === 'itineraryDays') {
      const allDays = await db.itineraryDays.toArray()
      dayToTrip = new Map(allDays.map((d) => [d.id, d.tripId]))
    }
  }

  return changed
}

// "这一轮拉到了新东西"的订阅口子。做成极简的回调集合而不是引入状态库/context——
// 目前只有顶部那个同步角标需要知道这件事，用来短暂显示"刚更新"
type PullListener = (changedRows: number) => void
const pullListeners = new Set<PullListener>()

export function onPulledChanges(cb: PullListener): () => void {
  pullListeners.add(cb)
  return () => pullListeners.delete(cb)
}

// 网络不好时一轮同步可能比10秒的前台间隔还慢，定时器不会等上一轮跑完就又
// 触发下一轮。两轮同时跑，各自的 pullAll() 会重叠使用 dexie.ts 里那个屏蔽
// outbox 记录的计数器——单靠计数器只能防止"提前解除屏蔽"，但两轮各自完整
// 跑一遍推送/拉取本身就是重复劳动，也可能读到彼此中途的过渡状态。这里直接
// 用一个进行中标记把重叠的调用整个跳过，同一时间只让一轮真正在跑
let syncInFlight = false

export async function runSync(): Promise<void> {
  if (!supabase) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  if (syncInFlight) return
  syncInFlight = true
  try {
    await pushOutbox()
    const changed = await pullAll()
    if (changed > 0) pullListeners.forEach((cb) => cb(changed))
  } catch {
    // 网络抖动/偶发失败，下个周期自然会重试，这里不需要往上抛出打断调用方
  } finally {
    syncInFlight = false
  }
}

// outbox里status='synced'的行只是"这条已经推送成功"的历史记录，本身不再有任何
// 用途（连"同步详情"页面都只看pending的），但一直没有任何机制会删掉它们——
// 从产生的那一刻起就永久留在本地，用得越久这张表就越大。这里每天检查一次，把
// 超过7天的synced记录清掉；pending的行不管多老都不碰，那是"同步详情"该管的事，
// 不该在这里被悄悄删掉
const OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const PRUNE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const PRUNE_LAST_RUN_KEY = 'outboxPruneLastRunAt'

export async function pruneSyncedOutbox(): Promise<void> {
  const lastRun = Number(localStorage.getItem(PRUNE_LAST_RUN_KEY) ?? 0)
  if (Date.now() - lastRun < PRUNE_CHECK_INTERVAL_MS) return
  localStorage.setItem(PRUNE_LAST_RUN_KEY, String(Date.now()))

  const cutoff = Date.now() - OUTBOX_RETENTION_MS
  const staleIds = await db.outbox
    .where('status')
    .equals('synced')
    .and((e) => e.createdAt < cutoff)
    .primaryKeys()
  if (staleIds.length) await db.outbox.bulkDelete(staleIds)
}

let syncTimer: ReturnType<typeof setInterval> | null = null

const FOREGROUND_INTERVAL_MS = 10_000
const BACKGROUND_INTERVAL_MS = 60_000

function scheduleSync(intervalMs: number) {
  if (syncTimer) clearInterval(syncTimer)
  syncTimer = setInterval(() => void runSync(), intervalMs)
}

// 启动周期性同步。三条触发路径：
//   1. 一进App立刻跑一次
//   2. 定时跑——前台10秒一次，切到后台放宽到60秒
//   3. 网络恢复(online)、以及页面重新回到前台(visibilitychange)时立刻跑一次
//
// 为什么要加 visibilitychange：这个APP的数据是一家人共享的，但同步一直是静默轮询。
// 最常见的场景是"放下手机一阵子，再拿起来看家里其他人记了什么"——如果只靠定时器，
// 这时候要等最多一整个周期才能看到新数据，会让人觉得APP是死的。回前台立刻拉一次
// 几乎不花成本，却正好覆盖了感知延迟最要紧的那一刻。
// 前台缩到10秒（原来固定30秒）是为了照顾"两个人当面一起对账"的场景；后台反而放宽到
// 60秒，避免手机在口袋里时白白耗电/耗流量。
export function startAutoSync() {
  if (!supabase) return
  void runSync()
  void pruneSyncedOutbox()
  window.addEventListener('online', () => void runSync())
  if (syncTimer) return

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void runSync()
      scheduleSync(FOREGROUND_INTERVAL_MS)
    } else {
      scheduleSync(BACKGROUND_INTERVAL_MS)
    }
  })

  scheduleSync(document.visibilityState === 'visible' ? FOREGROUND_INTERVAL_MS : BACKGROUND_INTERVAL_MS)
}
