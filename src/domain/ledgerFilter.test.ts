import { describe, it, expect } from 'vitest'
import { matchesLedgerFilter, isFilterActive, filterCount, PAY_CASH, PAY_PENDING, EMPTY_LEDGER_FILTER } from './ledgerFilter'
import type { Expense } from '../types'

function expense(over: Partial<Expense>): Expense {
  return {
    id: 'e', householdId: 'h1', tripId: 't1', categoryId: 'cat-food', phase: 'during_trip', description: null,
    expenseCurrency: 'JPY', expenseAmount: 1000, rateBookEntryId: 'r1', rateUsed: 0.03, homeAmount: 30,
    paidBy: 'bx', recordedBy: 'bx', expenseDate: '2026-10-31', itineraryDayId: null, itineraryItemId: null,
    splitType: 'equal', deletedAt: null, createdAt: 0, updatedAt: 0, ...over,
  } as Expense
}

const cashFood = expense({ categoryId: 'cat-food' })
const cardTransport = expense({ categoryId: 'cat-transport', rateBookEntryId: null, paymentCardId: 'tng', cardChargePending: false })
const pendingTransport = expense({ categoryId: 'cat-transport', rateBookEntryId: null, paymentCardId: 'tng', cardChargePending: true })
const otherCardShop = expense({ categoryId: 'cat-shop', rateBookEntryId: null, paymentCardId: 'mbb', cardChargePending: false })
const rmHotel = expense({ categoryId: 'cat-stay', expenseCurrency: 'MYR', rateBookEntryId: null })

describe('matchesLedgerFilter', () => {
  it('什么都没选 = 不筛', () => {
    for (const e of [cashFood, cardTransport, rmHotel]) expect(matchesLedgerFilter(e, EMPTY_LEDGER_FILTER)).toBe(true)
    expect(isFilterActive(EMPTY_LEDGER_FILTER)).toBe(false)
  })

  it('分类：同一组里是"或"', () => {
    const f = { categoryIds: ['cat-food', 'cat-transport'], payments: [] }
    expect([cashFood, cardTransport, otherCardShop, rmHotel].map((e) => matchesLedgerFilter(e, f))).toEqual([true, true, false, false])
  })

  it('付款方式："现金"= 所有不是刷卡的（含直接记本位币的）', () => {
    const f = { categoryIds: [], payments: [PAY_CASH] }
    expect([cashFood, cardTransport, rmHotel].map((e) => matchesLedgerFilter(e, f))).toEqual([true, false, true])
  })

  it('付款方式：某张卡只认这张卡；"待补扣款"只认还没补的刷卡', () => {
    expect([cardTransport, pendingTransport, otherCardShop].map((e) => matchesLedgerFilter(e, { categoryIds: [], payments: ['tng'] }))).toEqual([true, true, false])
    expect([cardTransport, pendingTransport, cashFood].map((e) => matchesLedgerFilter(e, { categoryIds: [], payments: [PAY_PENDING] }))).toEqual([false, true, false])
  })

  it('两组之间是"且"：餐饮或交通，并且是 TNG 刷的', () => {
    const f = { categoryIds: ['cat-food', 'cat-transport'], payments: ['tng'] }
    expect([cashFood, cardTransport, pendingTransport, otherCardShop].map((e) => matchesLedgerFilter(e, f))).toEqual([false, true, true, false])
    expect(filterCount(f)).toBe(3)
  })
})
