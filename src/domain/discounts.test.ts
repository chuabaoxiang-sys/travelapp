import { describe, it, expect } from 'vitest'
import { discountInHome, discountSummary } from './discounts'
import type { Expense } from '../types'

function expense(over: Partial<Expense>): Expense {
  return {
    id: 'e', householdId: 'h1', tripId: 't1', categoryId: 'cat-shop', phase: 'during_trip', description: null,
    expenseCurrency: 'JPY', expenseAmount: 16000, rateBookEntryId: null, rateUsed: 0.026075, homeAmount: 417.2,
    paidBy: 'bx', recordedBy: 'bx', expenseDate: '2026-10-25', itineraryDayId: null, itineraryItemId: null,
    splitType: 'equal', deletedAt: null, createdAt: 0, updatedAt: 0, ...over,
  } as Expense
}

describe('discountInHome', () => {
  it('按这笔的实际比例折成本位币：¥2,000 优惠、实付 ¥16,000 = RM417.20 → 省 RM52.15', () => {
    expect(discountInHome(expense({ discountAmount: 2000 }))).toBe(52.15)
  })
  it('没记优惠 = 0', () => {
    expect(discountInHome(expense({ discountAmount: null }))).toBe(0)
    expect(discountInHome(expense({}))).toBe(0)
  })
  it('本位币记的账，优惠就是本位币', () => {
    expect(discountInHome(expense({ expenseCurrency: 'MYR', expenseAmount: 100, homeAmount: 100, discountAmount: 15 }))).toBe(15)
  })
})

describe('discountSummary', () => {
  it('只算记了优惠、没删的账', () => {
    const list = [
      expense({ id: 'a', discountAmount: 2000 }),
      expense({ id: 'b', expenseCurrency: 'MYR', expenseAmount: 100, homeAmount: 100, discountAmount: 15 }),
      expense({ id: 'c' }),
      expense({ id: 'd', discountAmount: 500, deletedAt: 1 }),
    ]
    expect(discountSummary(list)).toEqual({ total: 67.15, count: 2 })
  })
})

describe('discountSummary 跟代购（分给代购的人那部分不算）', () => {
  // 实付 ¥14,000 = RM374.59，优惠 ¥2,000（≈ RM53.51），朋友的东西原价 ¥15,000（占原价 15/16）
  const base = { id: 'p', expenseAmount: 14000, homeAmount: 374.59, discountAmount: 2000 }
  const splits = [{ expenseId: 'p', proxyName: '妈妈', proxyAmount: 15000, deletedAt: null }]
  it('默认不分给代购的人：全额算', () => {
    expect(discountSummary([expense(base)], splits).total).toBe(53.51)
  })
  it('分给代购的人：只算你们自己那 1/16', () => {
    expect(discountSummary([expense({ ...base, proxyDiscountShared: true })], splits).total).toBe(3.34)
  })
  it('分给了但这笔没有代购行：全额算', () => {
    expect(discountSummary([expense({ ...base, proxyDiscountShared: true })], []).total).toBe(53.51)
  })
})
