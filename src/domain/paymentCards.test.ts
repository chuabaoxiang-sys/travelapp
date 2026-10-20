import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../db/dexie'
import {
  isCardExpense,
  pickEstimateRate,
  createPaymentCard,
  deletePaymentCard,
  archivePaymentCard,
  unarchivePaymentCard,
  renamePaymentCard,
  cardUsageForTrip,
} from './paymentCards'
import type { Expense, RateBookEntry } from '../types'

vi.mock('./household', () => ({ getCurrentHouseholdId: async () => 'h1' }))

function expense(id: string, over: Partial<Expense> = {}): Expense {
  return {
    id, householdId: 'h1', tripId: 't1', categoryId: 'cat-food', phase: 'during_trip', description: null,
    expenseCurrency: 'JPY', expenseAmount: 1000, rateBookEntryId: null, rateUsed: 0.03, homeAmount: 30,
    paidBy: 'm1', recordedBy: 'm1', expenseDate: '2026-10-20', itineraryDayId: null, itineraryItemId: null,
    splitType: 'none', deletedAt: null, createdAt: 0, updatedAt: 0, ...over,
  }
}

function rate(id: string, over: Partial<RateBookEntry> = {}): RateBookEntry {
  return {
    id, householdId: 'h1', tripId: 't1', foreignCurrency: 'JPY', label: id, rate: 0.0295, source: 'manual',
    createdBy: null, lastUsedAt: 0, archived: false, createdAt: 0, ...over,
  }
}

describe('isCardExpense', () => {
  it('有卡、没挂现金汇率才算刷卡', () => {
    expect(isCardExpense(expense('a', { paymentCardId: 'c1' }))).toBe(true)
    expect(isCardExpense(expense('a'))).toBe(false)
  })
  it('老版本把它改成了现金汇率（卡还留着）→ 按现金算', () => {
    expect(isCardExpense(expense('a', { paymentCardId: 'c1', rateBookEntryId: 'r1' }))).toBe(false)
    expect(isCardExpense(expense('a', { paymentCardId: 'c1', rateSpread: true }))).toBe(false)
  })
})

describe('pickEstimateRate', () => {
  const base = { cardId: 'c1', currency: 'JPY', tripId: 't1' }

  it('优先用这张卡最近一次的真实汇率（跨行程也算）', () => {
    const expenses = [
      expense('old', { paymentCardId: 'c1', rateUsed: 0.031, expenseDate: '2026-05-01', tripId: 't0' }),
      expense('new', { paymentCardId: 'c1', rateUsed: 0.0297, expenseDate: '2026-10-19', tripId: 't0' }),
    ]
    expect(pickEstimateRate({ ...base, expenses, rateEntries: [rate('r1')] })).toBe(0.0297)
  })

  it('跳过：估算中的、别的币种、已删除的、别的卡、正在编辑的这一笔', () => {
    const expenses = [
      expense('pending', { paymentCardId: 'c1', rateUsed: 0.04, cardChargePending: true, expenseDate: '2026-10-20' }),
      expense('krw', { paymentCardId: 'c1', rateUsed: 0.0033, expenseCurrency: 'KRW', expenseDate: '2026-10-20' }),
      expense('deleted', { paymentCardId: 'c1', rateUsed: 0.05, deletedAt: 1, expenseDate: '2026-10-20' }),
      expense('other', { paymentCardId: 'c2', rateUsed: 0.06, expenseDate: '2026-10-20' }),
      expense('self', { paymentCardId: 'c1', rateUsed: 0.07, expenseDate: '2026-10-20' }),
      expense('real', { paymentCardId: 'c1', rateUsed: 0.0299, expenseDate: '2026-10-01' }),
    ]
    expect(pickEstimateRate({ ...base, expenses, rateEntries: [], excludeExpenseId: 'self' })).toBe(0.0299)
  })

  it('这张卡没有真实汇率 → 用这趟这个币种最近用过的现金汇率（不含停用的、别的行程的）', () => {
    const rateEntries = [
      rate('older', { rate: 0.03, lastUsedAt: 1 }),
      rate('newer', { rate: 0.0294, lastUsedAt: 5 }),
      rate('archived', { rate: 0.02, lastUsedAt: 9, archived: true }),
      rate('otherTrip', { rate: 0.01, lastUsedAt: 9, tripId: 't9' }),
    ]
    expect(pickEstimateRate({ ...base, expenses: [], rateEntries })).toBe(0.0294)
  })

  it('什么都没有 → null，要用户填实际扣款', () => {
    expect(pickEstimateRate({ ...base, expenses: [], rateEntries: [] })).toBeNull()
  })
})

describe('卡的增改停用删（真实走 Dexie）', () => {
  beforeEach(async () => {
    await db.paymentCards.clear()
    await db.expenses.clear()
  })

  it('新建、改名、停用、重新启用', async () => {
    const c = await createPaymentCard('  TNG VISA ', 'm1')
    expect((await db.paymentCards.get(c.id))?.name).toBe('TNG VISA')
    await renamePaymentCard(c.id, 'TNG Visa')
    expect((await db.paymentCards.get(c.id))?.name).toBe('TNG Visa')
    await archivePaymentCard(c.id)
    expect((await db.paymentCards.get(c.id))?.archivedAt).not.toBeNull()
    await unarchivePaymentCard(c.id)
    expect((await db.paymentCards.get(c.id))?.archivedAt).toBeNull()
  })

  it('没挂过开销的卡可以删；挂过的（哪怕开销已删除）删不掉', async () => {
    const unused = await createPaymentCard('A', 'm1')
    await deletePaymentCard(unused.id)
    expect(await db.paymentCards.get(unused.id)).toBeUndefined()

    const used = await createPaymentCard('B', 'm1')
    await db.expenses.add(expense('e1', { paymentCardId: used.id, deletedAt: 123 }))
    await expect(deletePaymentCard(used.id)).rejects.toThrow()
    expect(await db.paymentCards.get(used.id)).toBeDefined()
  })

  it('cardUsageForTrip：只算这趟、没删除的刷卡开销；单一币种才给平均汇率', async () => {
    await db.expenses.bulkAdd([
      expense('a', { paymentCardId: 'c1', expenseAmount: 1000, homeAmount: 30 }),
      expense('b', { paymentCardId: 'c1', expenseAmount: 3000, homeAmount: 88 }),
      expense('gone', { paymentCardId: 'c1', deletedAt: 1 }),
      expense('cash', { paymentCardId: 'c1', rateBookEntryId: 'r1' }),
      expense('otherTrip', { paymentCardId: 'c1', tripId: 't2' }),
      expense('k1', { paymentCardId: 'c2', expenseCurrency: 'JPY' }),
      expense('k2', { paymentCardId: 'c2', expenseCurrency: 'KRW' }),
    ])
    const usage = await cardUsageForTrip('t1')
    expect(usage.get('c1')?.count).toBe(2)
    expect(usage.get('c1')?.averageRate).toBeCloseTo(118 / 4000, 8)
    expect(usage.get('c2')).toEqual({ count: 2, averageRate: null })
  })
})
