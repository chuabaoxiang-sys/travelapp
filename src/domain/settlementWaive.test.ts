import { describe, it, expect, beforeEach, vi } from 'vitest'
import i18n from '../lib/i18n'
import { db } from '../db/dexie'
import { computeBalances, owedAfterWaive, simplifyDebts, openExpenseDebts, closedExpenseDebts } from './splits'
import { createSettlement } from './settlements'
import { buildSettlementText } from './settlementText'
import type { Expense, ExpenseSplit } from '../types'

vi.mock('./household', () => ({ getCurrentHouseholdId: async () => 'h1', getCachedHouseholdIdSync: () => 'h1' }))

// 结算「免了」（0054，2026-11-10）：真实情况是 KN 要还 BX RM53.58，BX 不要 KN 还
function expense(id: string, home: number): Expense {
  return {
    id, householdId: 'h1', tripId: 't1', categoryId: 'cat-food', phase: 'during_trip', description: id,
    expenseCurrency: 'MYR', expenseAmount: home, rateBookEntryId: null, rateUsed: 1, homeAmount: home,
    paidBy: 'bx', recordedBy: 'bx', expenseDate: '2026-10-31', itineraryDayId: null, itineraryItemId: null,
    splitType: 'equal', deletedAt: null, createdAt: 0, updatedAt: 0,
  } as Expense
}
function split(expenseId: string, memberId: string, shareAmount: number): ExpenseSplit {
  return { id: `${expenseId}-${memberId}`, householdId: 'h1', expenseId, memberId, shareAmount, deletedAt: null }
}

beforeEach(async () => {
  await Promise.all([db.expenses.clear(), db.expenseSplits.clear(), db.settlements.clear(), db.taxRefunds.clear(), db.outbox.clear()])
  await db.expenses.add(expense('e1', 107.16))
  await db.expenseSplits.bulkAdd([split('e1', 'bx', 53.58), split('e1', 'kn', 53.58)])
  await i18n.changeLanguage('zh')
})

describe('结算「免了」', () => {
  it('免了整笔：两人都两清，不算已付/已收；账面应分摊不变，免了之后 KN 少 53.58、BX 多 53.58', async () => {
    await createSettlement({ tripId: 't1', fromMemberId: 'kn', toMemberId: 'bx', amount: 53.58, settledDate: '2026-11-10', note: null, waived: true })
    const b = await computeBalances('t1')
    const kn = b.find((x) => x.memberId === 'kn')!
    const bx = b.find((x) => x.memberId === 'bx')!
    expect(kn.net).toBe(0)
    expect(bx.net).toBe(0)
    expect([kn.settledOut, bx.settledIn]).toEqual([0, 0])
    expect([kn.owed, bx.owed]).toEqual([53.58, 53.58])
    expect([owedAfterWaive(kn), owedAfterWaive(bx)]).toEqual([0, 107.16])
    expect(kn.waivedInFrom).toEqual(['bx'])
    expect(bx.waivedOutTo).toEqual(['kn'])
    expect(simplifyDebts(b)).toEqual([])
  })

  it('只免一部分：剩下的照样要还', async () => {
    await createSettlement({ tripId: 't1', fromMemberId: 'kn', toMemberId: 'bx', amount: 3.58, settledDate: '2026-11-10', note: null, waived: true })
    const b = await computeBalances('t1')
    expect(b.find((x) => x.memberId === 'kn')!.net).toBe(-50)
    expect(simplifyDebts(b)).toEqual([{ from: 'kn', to: 'bx', amount: 50 }])
  })

  // 真实情况（东京北海道 2026）：KN 的现金退税在 BX 手上，BX 又免了剩下的，结算建议两清，
  // 按笔结算也要跟着清——以前它只认按笔结算和预付款，三笔一直挂着
  it('按笔结算：退税、免了按日期从早到晚抵掉，跟结算建议一致；删掉免了就变回没结清', async () => {
    await db.expenses.add({ ...expense('e2', 40), expenseDate: '2026-11-01' })
    await db.expenseSplits.bulkAdd([split('e2', 'bx', 20), split('e2', 'kn', 20)])
    await db.taxRefunds.add({
      id: 'r1', householdId: 'h1', tripId: 't1', method: 'cash', currency: 'JPY', foreignAmount: 2000, rate: 0.0266,
      homeAmount: 53.26, pending: false, memberIds: ['kn'], receivedBy: 'bx', rateBookEntryId: null,
      refundDate: '2026-11-06', note: null, createdBy: 'bx', createdAt: 0, updatedAt: 0, deletedAt: null,
    })
    // KN 一共欠 53.58 + 20 = 73.58；退税抵 53.26，剩 20.32 由 BX 免了
    const waiveId = await createSettlement({ tripId: 't1', fromMemberId: 'kn', toMemberId: 'bx', amount: 20.32, settledDate: '2026-11-10', note: null, waived: true })
    expect(simplifyDebts(await computeBalances('t1'))).toEqual([])
    expect(await openExpenseDebts('t1')).toEqual([])
    const closed = await closedExpenseDebts('t1')
    expect(closed.map((d) => [d.expenseId, d.refundAmount, d.waivedAmount])).toEqual([
      ['e1', 53.26, 0.32],
      ['e2', 0, 20],
    ])

    await db.settlements.delete(waiveId)
    expect((await openExpenseDebts('t1')).map((d) => [d.expenseId, d.remaining])).toEqual([['e1', 0.32], ['e2', 20]])
  })

  it('复制出去的文字：应分摊写免了之后的，括号写清楚，旅伴花费合计不变', async () => {
    await createSettlement({ tripId: 't1', fromMemberId: 'kn', toMemberId: 'bx', amount: 53.58, settledDate: '2026-11-10', note: null, waived: true })
    const balances = await computeBalances('t1')
    const text = buildSettlementText({
      tripName: '东京北海道 2026', currencySymbol: 'RM', balances, transfers: [], settledCount: 1,
      nameOf: (id) => id.toUpperCase(), appHost: 'x',
    }, i18n.t)
    expect(text).toContain('旅伴花费 RM107.16')
    expect(text).toContain('BX 应分摊 RM107.16（免了 KN RM53.58）')
    expect(text).toContain('KN 应分摊 RM0（BX 免了 RM53.58）')
  })
})
