import { describe, it, expect } from 'vitest'
import { evaluateTripClear } from './tripClear'
import type { Expense, ExpenseSplit, TaxRefund } from '../types'

// 旅程通关四关（2026-11-12）：补完刷卡扣款、退税到账、代购收齐、结算两清
function expense(id: string, over: Partial<Expense> = {}): Expense {
  return {
    id, householdId: 'h1', tripId: 't1', categoryId: 'cat-food', phase: 'during_trip', description: id,
    expenseCurrency: 'MYR', expenseAmount: 100, rateBookEntryId: null, rateUsed: 1, homeAmount: 100,
    paidBy: 'bx', recordedBy: 'bx', expenseDate: '2026-10-31', itineraryDayId: null, itineraryItemId: null,
    splitType: 'equal', deletedAt: null, createdAt: 0, updatedAt: 0, ...over,
  } as Expense
}
function refund(pending: boolean): TaxRefund {
  return {
    id: 'r1', householdId: 'h1', tripId: 't1', method: 'card', currency: 'JPY', foreignAmount: 1300, rate: 0.0272,
    homeAmount: 35.33, pending, memberIds: ['bx'], receivedBy: 'bx', rateBookEntryId: null,
    refundDate: '2026-11-06', note: null, createdBy: 'bx', createdAt: 0, updatedAt: 0, deletedAt: null,
  }
}
const proxySplit = (repaidAt: number | null): ExpenseSplit => ({
  id: 'p1', householdId: 'h1', expenseId: 'e1', memberId: 'bx', shareAmount: 40, deletedAt: null,
  proxyName: '妈妈', proxyAmount: 40, proxyRepaidAt: repaidAt,
})

describe('evaluateTripClear', () => {
  it('东京北海道现在的样子：只差一笔退到卡的退税没到账 → 4 关过 3 关', () => {
    const s = evaluateTripClear({ expenses: [expense('e1')], splits: [], refunds: [refund(true)], transfers: [], memberCount: 2 })
    expect(s.checks.map((c) => [c.key, c.done])).toEqual([['cards', true], ['refunds', false], ['proxies', true], ['settle', true]])
    expect(s.checks[1]).toMatchObject({ count: 1, amount: 35.33 })
    expect([s.doneCount, s.cleared]).toEqual([3, false])
  })

  it('全部做完就通关；没有刷卡、退税、代购的那几关直接算过', () => {
    const s = evaluateTripClear({ expenses: [expense('e1')], splits: [], refunds: [refund(false)], transfers: [], memberCount: 2 })
    expect(s.cleared).toBe(true)
    expect(s.doneCount).toBe(4)
  })

  it('待补的刷卡、没收的代购、没转的账各自卡住对应那一关', () => {
    const s = evaluateTripClear({
      expenses: [expense('e1'), expense('e2', { paymentCardId: 'tng', cardChargePending: true } as Partial<Expense>)],
      splits: [proxySplit(null)],
      refunds: [],
      transfers: [{ amount: 53.58 }],
      memberCount: 2,
    })
    expect(s.checks.filter((c) => !c.done).map((c) => c.key)).toEqual(['cards', 'proxies', 'settle'])
    expect(s.checks.find((c) => c.key === 'proxies')).toMatchObject({ count: 1, amount: 40 })
  })

  it('一个人的行程没有「结算两清」这一关', () => {
    const s = evaluateTripClear({ expenses: [expense('e1')], splits: [proxySplit(1)], refunds: [], transfers: [], memberCount: 1 })
    expect(s.checks.map((c) => c.key)).toEqual(['cards', 'refunds', 'proxies'])
    expect(s.cleared).toBe(true)
  })
})
