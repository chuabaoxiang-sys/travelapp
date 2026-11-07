import { describe, it, expect } from 'vitest'
import { cardTripSpend, estimateCashback, defaultCashbackOwner, cashbackSummary } from './cashback'
import type { CardCashback, Expense } from '../types'

function expense(over: Partial<Expense>): Expense {
  return {
    id: 'e', householdId: 'h1', tripId: 't1', categoryId: 'cat-shop', phase: 'during_trip', description: null,
    expenseCurrency: 'JPY', expenseAmount: 1000, rateBookEntryId: null, rateUsed: 0.026, homeAmount: 26,
    paidBy: 'bx', recordedBy: 'bx', expenseDate: '2026-10-25', itineraryDayId: null, itineraryItemId: null,
    splitType: 'equal', paymentCardId: 'tng', cardChargePending: false, deletedAt: null, createdAt: 0, updatedAt: 0, ...over,
  } as Expense
}

function cashback(over: Partial<CardCashback>): CardCashback {
  return { id: 'c', householdId: 'h1', tripId: 't1', paymentCardId: 'tng', memberId: 'bx', amount: 10, note: null, createdBy: null, createdAt: 0, updatedAt: 0, deletedAt: null, ...over }
}

const list = [
  expense({ id: 'a', homeAmount: 400 }),
  expense({ id: 'b', homeAmount: 500, cardChargePending: true }), // 估算的也算
  expense({ id: 'c', homeAmount: 100, paidBy: 'kn' }),
  expense({ id: 'd', homeAmount: 999, paymentCardId: 'mbb' }), // 别的卡
  expense({ id: 'e', homeAmount: 50, paymentCardId: null, rateBookEntryId: 'r1' }), // 现金
  expense({ id: 'f', homeAmount: 70, deletedAt: 1 }), // 删掉的
]

describe('cardTripSpend / estimateCashback', () => {
  it('只算这张卡、没删的刷卡账（含待补的估算）', () => {
    expect(cardTripSpend(list, 'tng')).toBe(1000)
  })
  it('按比例估：RM1000 × 5% = RM50；没设比例就不估', () => {
    expect(estimateCashback(1000, 5)).toBe(50)
    expect(estimateCashback(912.4, 5)).toBe(45.62)
    expect(estimateCashback(1000, null)).toBeNull()
    expect(estimateCashback(0, 5)).toBeNull()
  })
})

describe('defaultCashbackOwner', () => {
  it('这趟用这张卡付钱最多的人', () => {
    expect(defaultCashbackOwner(list, 'tng', 'me')).toBe('bx')
    expect(defaultCashbackOwner([expense({ paidBy: 'kn', homeAmount: 300 }), expense({ homeAmount: 100 })], 'tng', 'me')).toBe('kn')
  })
  it('这趟没用过这张卡：退回当前成员', () => {
    expect(defaultCashbackOwner(list, 'other', 'me')).toBe('me')
  })
})

describe('cashbackSummary', () => {
  it('合计和按人分开，删掉的不算', () => {
    const s = cashbackSummary([cashback({ amount: 45.6 }), cashback({ id: 'x', amount: 12.3, memberId: 'kn' }), cashback({ id: 'y', amount: 99, deletedAt: 1 })])
    expect(s.total).toBe(57.9)
    expect(s.byMember.get('bx')).toBe(45.6)
    expect(s.byMember.get('kn')).toBe(12.3)
  })
})
