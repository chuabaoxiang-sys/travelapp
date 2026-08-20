import { describe, it, expect, beforeEach, vi } from 'vitest'
import { deriveRateFromExchangeAmounts, usedForeignAmountByEntry, createRateBookEntry } from './rates'
import { db } from '../db/dexie'
import type { Expense } from '../types'

vi.mock('./household', () => ({ getCurrentHouseholdId: async () => 'h1' }))

describe('deriveRateFromExchangeAmounts', () => {
  it('两个金额都有效时算出汇率（本位币/外币）', () => {
    expect(deriveRateFromExchangeAmounts('500', '16500')).toBeCloseTo(0.030303, 5)
  })

  it('任一为空、0、非数字时返回 null，不强行算出一个假汇率', () => {
    expect(deriveRateFromExchangeAmounts('', '16500')).toBeNull()
    expect(deriveRateFromExchangeAmounts('500', '')).toBeNull()
    expect(deriveRateFromExchangeAmounts('0', '16500')).toBeNull()
    expect(deriveRateFromExchangeAmounts('500', 'abc')).toBeNull()
  })
})

function expense(id: string, rateBookEntryId: string | null, expenseAmount: number): Expense {
  return {
    id, householdId: 'h1', tripId: 't1', categoryId: 'cat-food', phase: 'during_trip', description: null,
    expenseCurrency: 'JPY', expenseAmount, rateBookEntryId, rateUsed: 0.03, homeAmount: expenseAmount * 0.03,
    paidBy: 'papa', recordedBy: 'papa', expenseDate: '2026-08-21', itineraryDayId: null, itineraryItemId: null,
    splitType: 'equal', createdAt: 0, updatedAt: 0,
  }
}

describe('usedForeignAmountByEntry（真实走Dexie）', () => {
  beforeEach(async () => {
    await db.expenses.clear()
  })

  it('按 rateBookEntryId 把 expenseAmount 加总，不同条目分开算', async () => {
    await db.expenses.bulkAdd([
      expense('e1', 'entry-a', 3000),
      expense('e2', 'entry-a', 1000),
      expense('e3', 'entry-b', 500),
    ])
    const used = await usedForeignAmountByEntry('t1')
    expect(used.get('entry-a')).toBe(4000)
    expect(used.get('entry-b')).toBe(500)
  })

  it('没有 rateBookEntryId 的开销（本位币记账）不计入任何条目', async () => {
    await db.expenses.bulkAdd([expense('e1', null, 300)])
    const used = await usedForeignAmountByEntry('t1')
    expect(used.size).toBe(0)
  })

  it('没有任何开销引用过的条目，压根不会出现在返回的 Map 里', async () => {
    const used = await usedForeignAmountByEntry('t1')
    expect(used.has('entry-never-used')).toBe(false)
  })
})

describe('createRateBookEntry', () => {
  beforeEach(async () => {
    await db.rateBookEntries.clear()
  })

  it('传了换汇金额时原样存下', async () => {
    const entry = await createRateBookEntry({
      tripId: 't1', foreignCurrency: 'JPY', label: '机场换的', rate: 0.0303,
      source: 'manual', createdBy: 'papa', exchangedHomeAmount: 500, exchangedForeignAmount: 16500,
    })
    expect(entry.exchangedHomeAmount).toBe(500)
    expect(entry.exchangedForeignAmount).toBe(16500)
  })

  it('不传换汇金额时是 null，不是 undefined（老用法：纯手动估一个汇率）', async () => {
    const entry = await createRateBookEntry({
      tripId: 't1', foreignCurrency: 'JPY', label: '随手估的', rate: 0.03, source: 'manual', createdBy: 'papa',
    })
    expect(entry.exchangedHomeAmount).toBeNull()
    expect(entry.exchangedForeignAmount).toBeNull()
  })
})
