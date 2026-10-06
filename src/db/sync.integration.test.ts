import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db, withoutOutboxTracking } from './dexie'
import type { Expense, ExpenseSplit, OutboxEntry, RateBookEntry } from '../types'

// pushOutbox/pullAll/runSync 一直没有自动化测试，根本原因是它们一开头就判断
// `if (!supabase) return`——测试环境没配Supabase环境变量，supabase 本来就是 null，
// 早退分支直接跳过，真正的逻辑从没被跑到过。这个文件把 ../api/supabaseClient
// mock 掉，塞一个假client进去，专门回归过去两周真实撞见过的3次同步事故：
// 08-25 分摊被误清成0人、0009迁移修的分摊推送中间态、08-23 同步重叠。
//
// 用 vi.hoisted + getter 而不是直接 vi.mock 一个固定对象——sync.ts 每次用到
// supabase 都是走 `import { supabase } from ...` 这个实时绑定，getter 能让每个
// test 在 beforeEach 里换一个新的假client，不用重新 import 模块
const state = vi.hoisted(() => ({ client: null as unknown as { rpc: unknown; from: unknown } }))

vi.mock('../api/supabaseClient', () => ({
  get supabase() {
    return state.client
  },
}))

const { pushOutbox, pullAll, runSync } = await import('./sync')

// 跟 sync.ts 里 TABLE_ORDER 保持一致——pullAll 每轮会遍历这19张表，
// 测试里没特别配置的表一律当成"远端没有变化"处理
const ALL_TABLES = [
  'trips', 'members', 'tripMembers', 'itineraryDays', 'itineraryItems', 'daySatisfactions',
  'rateBookEntries', 'expenses', 'expenseSplits', 'expenseSatisfactions', 'expenseLineItems',
  'expenseLineItemMembers', 'expenseDayAllocations', 'expenseRateAllocations', 'budgets',
  'settlements', 'feedback', 'wishlistPlaces', 'wishlistPlaceLinks',
] as const

function makeSupabaseMock() {
  const selectResults = new Map<string, { data: unknown[]; error: unknown }>()
  const selectCalls: string[] = []
  const upsertCalls: { table: string; row: unknown }[] = []
  const upsertErrors = new Map<string, unknown>()
  const deleteCalls: { table: string; id: unknown }[] = []
  const rpcCalls: { name: string; args: unknown }[] = []
  let rpcResult: { error: unknown } = { error: null }

  const from = vi.fn((table: string) => ({
    select: vi.fn(async () => {
      selectCalls.push(table)
      return selectResults.get(table) ?? { data: [], error: null }
    }),
    upsert: vi.fn(async (row: unknown) => {
      upsertCalls.push({ table, row })
      return { error: upsertErrors.get(table) ?? null }
    }),
    delete: vi.fn(() => ({
      eq: vi.fn(async (_col: string, id: unknown) => {
        deleteCalls.push({ table, id })
        return { error: null }
      }),
      match: vi.fn(async () => ({ error: null })),
    })),
  }))

  const rpc = vi.fn(async (name: string, args: unknown) => {
    rpcCalls.push({ name, args })
    return rpcResult
  })

  return {
    client: { from, rpc },
    selectCalls,
    upsertCalls,
    deleteCalls,
    rpcCalls,
    setSelect: (table: string, result: { data: unknown[]; error: unknown }) => selectResults.set(table, result),
    setUpsertError: (table: string, error: unknown) => upsertErrors.set(table, error),
    setRpcResult: (result: { error: unknown }) => { rpcResult = result },
  }
}

function outboxEntry(overrides: Partial<OutboxEntry>): OutboxEntry {
  return {
    id: crypto.randomUUID(),
    tableName: 'expenseSplits',
    recordId: '',
    operation: 'upsert',
    payload: null,
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: Date.now(),
    ...overrides,
  }
}

function splitRow(overrides: Partial<ExpenseSplit>): ExpenseSplit {
  return { id: crypto.randomUUID(), householdId: 'h1', expenseId: 'exp-1', memberId: 'm1', shareAmount: 0, deletedAt: null, ...overrides }
}

// 10-06事故里的那条重名汇率和那笔账目（Banana Milk）的形状
function rateRow(overrides: Partial<RateBookEntry>): RateBookEntry {
  return {
    id: 'rate-dup', householdId: 'h1', tripId: 't1', foreignCurrency: 'KRW', label: 'rate', rate: 0.00304,
    source: 'api_accepted', createdBy: 'm1', lastUsedAt: 1, archived: false, createdAt: 1,
    exchangedHomeAmount: null, exchangedForeignAmount: null, ...overrides,
  }
}

function expenseRow(overrides: Partial<Expense>): Expense {
  return {
    id: 'exp-banana', householdId: 'h1', tripId: 't1', categoryId: 'c1', expenseDate: '2026-10-06', phase: 'during_trip',
    expenseCurrency: 'KRW', expenseAmount: 1800, rateBookEntryId: 'rate-dup', rateUsed: 0.00304, homeAmount: 5.47,
    paidBy: 'm2', recordedBy: 'm1', splitType: 'equal', itineraryDayId: null, itineraryItemId: null,
    description: 'Banana Milk', deletedAt: null, createdAt: 1000, updatedAt: 1000, ...overrides,
  } as Expense
}

// 测试里直接摆本地数据，不能让 hook 顺手再记一条 outbox，打乱精心布置的队列
function seedLocal(fn: () => Promise<unknown>) {
  return withoutOutboxTracking(fn)
}

describe('pushOutbox / pullAll / runSync（真实mock网络层）', () => {
  let mock: ReturnType<typeof makeSupabaseMock>

  beforeEach(async () => {
    for (const t of ALL_TABLES) await db.table(t).clear()
    await db.outbox.clear()
    mock = makeSupabaseMock()
    state.client = mock.client
    // Node 21+ 自带一个没有 onLine 属性的全局 navigator，runSync() 的
    // `!navigator.onLine` 判断在这个环境下永远是 true，会被误判成"离线"直接早退——
    // 这跟 syncInFlight 的重叠保护无关，只是测试环境本身的差异，得先垫平
    vi.stubGlobal('navigator', { onLine: true })
  })

  it('0009迁移修的那次回归：同一笔expenseId的多条待推送分摊记录，合并成一次RPC调用，' +
    '而不是逐行调用；成功时整组一起标记synced', async () => {
    await db.expenseSplits.bulkAdd([
      splitRow({ id: 'split-a', expenseId: 'exp-1', memberId: 'm1', shareAmount: 50 }),
      splitRow({ id: 'split-b', expenseId: 'exp-1', memberId: 'm2', shareAmount: 50 }),
    ])
    await db.outbox.bulkAdd([
      outboxEntry({ id: 'ob-1', recordId: 'exp-1', payload: { expenseId: 'exp-1' } }),
      outboxEntry({ id: 'ob-2', recordId: 'exp-1', payload: { expenseId: 'exp-1' } }),
    ])

    const result = await pushOutbox()

    expect(mock.rpcCalls).toHaveLength(1)
    expect(mock.rpcCalls[0].name).toBe('replace_expense_splits')
    expect(mock.rpcCalls[0].args).toMatchObject({
      p_expense_id: 'exp-1',
      p_rows: expect.arrayContaining([
        expect.objectContaining({ id: 'split-a', member_id: 'm1', share_amount: 50 }),
        expect.objectContaining({ id: 'split-b', member_id: 'm2', share_amount: 50 }),
      ]),
    })
    expect(result).toEqual({ pushed: 2, failed: 0 })
    const entries = await db.outbox.bulkGet(['ob-1', 'ob-2'])
    expect(entries.map((e) => e?.status)).toEqual(['synced', 'synced'])
  })

  it('RPC失败时整组一起留在pending、attempts都加1——不会出现"组内一半成功一半失败"的中间态', async () => {
    await db.expenseSplits.bulkAdd([splitRow({ id: 'split-a', expenseId: 'exp-1' })])
    await db.outbox.bulkAdd([
      outboxEntry({ id: 'ob-1', recordId: 'exp-1', payload: { expenseId: 'exp-1' } }),
      outboxEntry({ id: 'ob-2', recordId: 'exp-1', payload: { expenseId: 'exp-1' } }),
    ])
    mock.setRpcResult({ error: { message: '延迟约束触发', code: '55006' } })

    const result = await pushOutbox()

    expect(result).toEqual({ pushed: 0, failed: 2 })
    const entries = await db.outbox.bulkGet(['ob-1', 'ob-2'])
    expect(entries.every((e) => e?.status === 'pending')).toBe(true)
    expect(entries.every((e) => e?.attempts === 1)).toBe(true)
    expect(entries[0]?.lastError).toContain('延迟约束触发')
  })

  it('08-25事故回归：expenseSplits这笔账目的分摊还没推到远端时，pullAll不能把本地这几行当成' +
    '"远端已删除"清掉——通过真实的pullAll端到端验证，不只是测底下的纯函数', async () => {
    await db.expenseSplits.bulkAdd([
      splitRow({ id: 'split-x', expenseId: 'exp-42', memberId: 'm1', shareAmount: 25 }),
      splitRow({ id: 'split-y', expenseId: 'exp-42', memberId: 'm2', shareAmount: 25 }),
    ])
    // recordId 是 expenseId，不是分摊行自己的id——跟 domain/splits.ts 的
    // saveExpenseSplits 实际入队方式一致
    await db.outbox.add(outboxEntry({ id: 'ob-1', recordId: 'exp-42', payload: { expenseId: 'exp-42' } }))
    // 远端这次查询还查不到这两行（推送还没落地，或者两次同步撞在了一起）
    mock.setSelect('expense_split', { data: [], error: null })

    await pullAll()

    const remaining = await db.expenseSplits.toArray()
    expect(remaining.map((r) => r.id).sort()).toEqual(['split-x', 'split-y'])
  })

  it('08-27事故回归：这笔账目的分摊改动本地还"待同步"时，pullAll不能把云端返回的' +
    '（可能是另一台设备还没看到这次改动前的旧版本）分摊行接回本地——不然会跟本地这份' +
    '还没推上去的改动一起留在本地，变成同一个人有2条分摊记录，撞上数据库那道唯一性约束', async () => {
    await db.expenseSplits.add(splitRow({ id: 'split-local', expenseId: 'exp-99', memberId: 'm1', shareAmount: 100 }))
    await db.outbox.add(outboxEntry({ id: 'ob-1', recordId: 'exp-99', payload: { expenseId: 'exp-99' } }))
    // 远端这次查询返回的是"另一台设备眼里、这次本地改动之前"的旧版本——
    // id跟本地这条不一样，代表的是同一个人（member_id相同）但内容不同的一行
    mock.setSelect('expense_split', {
      data: [{ id: 'split-remote-stale', household_id: 'h1', expense_id: 'exp-99', member_id: 'm1', share_amount: 999 }],
      error: null,
    })

    await pullAll()

    const remaining = await db.expenseSplits.where('expenseId').equals('exp-99').toArray()
    expect(remaining.map((r) => r.id)).toEqual(['split-local'])
  })

  it('08-23事故回归：runSync()重叠调用时，第二次会被syncInFlight直接挡掉，' +
    '不会真的把14张表再拉一遍', async () => {
    // 全部表返回空，模拟"这一轮没有任何变化"，pushOutbox 也没有待推送——
    // 纯粹只关心 select 总次数是不是等于一整轮（14张表），而不是两轮（28次）
    const p1 = runSync()
    const p2 = runSync()
    await Promise.all([p1, p2])

    expect(mock.selectCalls).toHaveLength(ALL_TABLES.length)
  })

  it('10-06事故回归：卡了一小时的旧记录终于推通时，推的是本地现在的样子——不能把用户' +
    '后来改好的汇率盖回去，也不能把已经删掉的汇率推上去"复活"', async () => {
    // 本地现在的样子：这笔账已经改用 Eddy change，重名的 "rate" 已经删掉
    await seedLocal(() => db.expenses.put(expenseRow({ rateBookEntryId: 'rate-eddy', rateUsed: 0.00293, homeAmount: 5.27, updatedAt: 2000 })))
    await db.outbox.bulkAdd([
      // 卡住的旧快照：新建 "rate" 被重名拒收，引用它的账目跟着卡住
      outboxEntry({ id: 'ob-rate-insert', tableName: 'rateBookEntries', recordId: 'rate-dup', payload: rateRow({}), attempts: 25, createdAt: 100 }),
      outboxEntry({ id: 'ob-exp-insert', tableName: 'expenses', recordId: 'exp-banana', payload: expenseRow({}), attempts: 25, createdAt: 101 }),
      // 升级前的旧版本逐条推：后来的修改和删除早就单独推成功了
      outboxEntry({ id: 'ob-exp-edit', tableName: 'expenses', recordId: 'exp-banana', payload: expenseRow({ rateBookEntryId: 'rate-eddy' }), status: 'synced', createdAt: 200 }),
      outboxEntry({ id: 'ob-rate-delete', tableName: 'rateBookEntries', recordId: 'rate-dup', operation: 'delete', status: 'synced', createdAt: 300 }),
    ])

    await pushOutbox()

    expect(mock.upsertCalls.filter((c) => c.table === 'rate_book_entry')).toHaveLength(0)
    expect(mock.deleteCalls).toEqual([{ table: 'rate_book_entry', id: 'rate-dup' }])
    const expenseUpserts = mock.upsertCalls.filter((c) => c.table === 'expense')
    expect(expenseUpserts).toHaveLength(1)
    expect(expenseUpserts[0].row).toMatchObject({ rate_book_entry_id: 'rate-eddy', rate_used: 0.00293, home_amount: 5.27 })
    const entries = await db.outbox.bulkGet(['ob-rate-insert', 'ob-exp-insert'])
    expect(entries.map((e) => e?.status)).toEqual(['synced', 'synced'])
  })

  it('本地已经删掉、删除也还在排队：只推删除，删之前排着的新增/修改不再推', async () => {
    await db.outbox.bulkAdd([
      outboxEntry({ id: 'ob-1', tableName: 'rateBookEntries', recordId: 'rate-dup', payload: rateRow({}), createdAt: 100 }),
      outboxEntry({ id: 'ob-2', tableName: 'rateBookEntries', recordId: 'rate-dup', payload: rateRow({ lastUsedAt: 5 }), createdAt: 101 }),
      outboxEntry({ id: 'ob-3', tableName: 'rateBookEntries', recordId: 'rate-dup', operation: 'delete', createdAt: 102 }),
    ])

    const result = await pushOutbox()

    expect(mock.upsertCalls).toHaveLength(0)
    expect(mock.deleteCalls).toEqual([{ table: 'rate_book_entry', id: 'rate-dup' }])
    expect(result).toEqual({ pushed: 3, failed: 0 })
    const entries = await db.outbox.bulkGet(['ob-1', 'ob-2', 'ob-3'])
    expect(entries.every((e) => e?.status === 'synced')).toBe(true)
  })

  it('同一条记录排了好几次修改：只推一次，推的是本地现在的内容，几条一起标记synced', async () => {
    await seedLocal(() => db.expenses.put(expenseRow({ description: '第三次改的', updatedAt: 3000 })))
    await db.outbox.bulkAdd([
      outboxEntry({ id: 'ob-1', tableName: 'expenses', recordId: 'exp-banana', payload: expenseRow({ description: '第一次' }), createdAt: 100 }),
      outboxEntry({ id: 'ob-2', tableName: 'expenses', recordId: 'exp-banana', payload: expenseRow({ description: '第二次' }), createdAt: 101 }),
      outboxEntry({ id: 'ob-3', tableName: 'expenses', recordId: 'exp-banana', payload: expenseRow({ description: '第三次改的' }), createdAt: 102 }),
    ])

    const result = await pushOutbox()

    expect(mock.upsertCalls).toHaveLength(1)
    expect(mock.upsertCalls[0].row).toMatchObject({ id: 'exp-banana', notes: '第三次改的' })
    expect(result).toEqual({ pushed: 3, failed: 0 })
    const entries = await db.outbox.bulkGet(['ob-1', 'ob-2', 'ob-3'])
    expect(entries.every((e) => e?.status === 'synced')).toBe(true)
  })

  it('推失败时这一组全部留在pending、attempts各自加1，报错原样记下来给同步详情看', async () => {
    await seedLocal(() => db.rateBookEntries.put(rateRow({})))
    await db.outbox.bulkAdd([
      outboxEntry({ id: 'ob-1', tableName: 'rateBookEntries', recordId: 'rate-dup', payload: rateRow({}), attempts: 3, createdAt: 100 }),
      outboxEntry({ id: 'ob-2', tableName: 'rateBookEntries', recordId: 'rate-dup', payload: rateRow({}), attempts: 0, createdAt: 101 }),
    ])
    mock.setUpsertError('rate_book_entry', { message: 'duplicate key value violates unique constraint', code: '23505' })

    const result = await pushOutbox()

    expect(result).toEqual({ pushed: 0, failed: 2 })
    const entries = await db.outbox.bulkGet(['ob-1', 'ob-2'])
    expect(entries.map((e) => e?.status)).toEqual(['pending', 'pending'])
    expect(entries.map((e) => e?.attempts)).toEqual([4, 1])
    expect(entries[0]?.lastError).toContain('23505')
  })

  it('0041：重试次数刚好跨过"卡住"门槛时向服务器报一次，只带技术字段，不带内容', async () => {
    await seedLocal(() => db.rateBookEntries.put(rateRow({})))
    await db.outbox.add(outboxEntry({ id: 'ob-1', tableName: 'rateBookEntries', recordId: 'rate-dup', payload: rateRow({}), attempts: 9, createdAt: 1000 }))
    mock.setUpsertError('rate_book_entry', {
      message: 'duplicate key value violates unique constraint "idx_rate_book_entry_trip_currency_label"',
      details: 'Key (trip_id, currency_code, label)=(t1, KRW, rate) already exists.',
      code: '23505',
    })

    await pushOutbox()

    const reports = mock.rpcCalls.filter((c) => c.name === 'report_sync_problem')
    expect(reports).toHaveLength(1)
    expect(reports[0].args).toEqual({
      p_table: 'rateBookEntries',
      p_operation: 'upsert',
      p_record_id: 'rate-dup',
      p_error_code: '23505',
      p_error_label: 'idx_rate_book_entry_trip_currency_label',
      p_attempts: 10,
      p_queued_at: new Date(1000).toISOString(),
      p_app_version: 'test',
    })
    expect(JSON.stringify(reports[0].args)).not.toContain('KRW')

    // 下一轮再失败（第11次）不重复报
    await pushOutbox()
    expect(mock.rpcCalls.filter((c) => c.name === 'report_sync_problem')).toHaveLength(1)
  })

  it('0041：还没到门槛的失败不报；报过卡住的记录推成功后报一声已恢复', async () => {
    await seedLocal(() => db.rateBookEntries.put(rateRow({})))
    await db.outbox.bulkAdd([
      outboxEntry({ id: 'ob-fresh', tableName: 'expenses', recordId: 'exp-banana', payload: expenseRow({}), attempts: 2 }),
      outboxEntry({ id: 'ob-stuck', tableName: 'rateBookEntries', recordId: 'rate-dup', payload: rateRow({}), attempts: 25 }),
    ])
    mock.setUpsertError('expense', { message: 'boom', code: '23503' })

    await pushOutbox()

    expect(mock.rpcCalls.filter((c) => c.name === 'report_sync_problem')).toHaveLength(0)
    const resolved = mock.rpcCalls.filter((c) => c.name === 'resolve_sync_problem')
    expect(resolved).toEqual([{ name: 'resolve_sync_problem', args: { p_table: 'rateBookEntries', p_record_id: 'rate-dup', p_status: 'resolved' } }])
  })

  it('保底：本地找不到这一行、也从没删过（写入失败回滚之类）时，照旧推排队里最新的那份内容，不漏推', async () => {
    await db.outbox.bulkAdd([
      outboxEntry({ id: 'ob-1', tableName: 'expenses', recordId: 'exp-banana', payload: expenseRow({ description: '旧' }), createdAt: 100 }),
      outboxEntry({ id: 'ob-2', tableName: 'expenses', recordId: 'exp-banana', payload: expenseRow({ description: '新' }), createdAt: 101 }),
    ])

    await pushOutbox()

    expect(mock.deleteCalls).toHaveLength(0)
    expect(mock.upsertCalls).toHaveLength(1)
    expect(mock.upsertCalls[0].row).toMatchObject({ id: 'exp-banana', notes: '新' })
  })
})
