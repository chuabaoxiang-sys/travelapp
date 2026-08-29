import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from './dexie'
import type { ExpenseSplit, OutboxEntry } from '../types'

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

// 跟 sync.ts 里 TABLE_ORDER 保持一致——pullAll 每轮会遍历这14张表，
// 测试里没特别配置的表一律当成"远端没有变化"处理
const ALL_TABLES = [
  'trips', 'members', 'tripMembers', 'itineraryDays', 'itineraryItems',
  'rateBookEntries', 'expenses', 'expenseSplits', 'expenseDayAllocations',
  'expenseRateAllocations', 'budgets', 'settlements', 'feedback', 'wishlistPlaces',
] as const

function makeSupabaseMock() {
  const selectResults = new Map<string, { data: unknown[]; error: unknown }>()
  const selectCalls: string[] = []
  const upsertCalls: { table: string; row: unknown }[] = []
  const rpcCalls: { name: string; args: unknown }[] = []
  let rpcResult: { error: unknown } = { error: null }

  const from = vi.fn((table: string) => ({
    select: vi.fn(async () => {
      selectCalls.push(table)
      return selectResults.get(table) ?? { data: [], error: null }
    }),
    upsert: vi.fn(async (row: unknown) => {
      upsertCalls.push({ table, row })
      return { error: null }
    }),
    delete: vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
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
    rpcCalls,
    setSelect: (table: string, result: { data: unknown[]; error: unknown }) => selectResults.set(table, result),
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
  return { id: crypto.randomUUID(), householdId: 'h1', expenseId: 'exp-1', memberId: 'm1', shareAmount: 0, ...overrides }
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
})
