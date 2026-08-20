import { describe, it, expect, beforeEach, vi } from 'vitest'
import { deriveRateFromExchangeAmounts, usageByEntry, createRateBookEntry, updateRateBookEntry } from './rates'
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

function expense(id: string, rateBookEntryId: string | null, expenseAmount: number, rateSpread?: boolean): Expense {
  return {
    id, householdId: 'h1', tripId: 't1', categoryId: 'cat-food', phase: 'during_trip', description: null,
    expenseCurrency: 'JPY', expenseAmount, rateBookEntryId, rateUsed: 0.03, homeAmount: expenseAmount * 0.03,
    paidBy: 'papa', recordedBy: 'papa', expenseDate: '2026-08-21', itineraryDayId: null, itineraryItemId: null,
    splitType: 'equal', rateSpread: rateSpread ?? null, createdAt: 0, updatedAt: 0,
  }
}

function allocation(id: string, expenseId: string, rateBookEntryId: string, foreignAmount: number) {
  return { id, householdId: 'h1', expenseId, tripId: 't1', rateBookEntryId, foreignAmount, rateUsed: 0.03, homeAmount: foreignAmount * 0.03 }
}

describe('usageByEntry（真实走Dexie）', () => {
  beforeEach(async () => {
    await db.expenses.clear()
    await db.expenseRateAllocations.clear()
  })

  it('按 rateBookEntryId 把笔数和 expenseAmount 都加总，不同条目分开算', async () => {
    await db.expenses.bulkAdd([
      expense('e1', 'entry-a', 3000),
      expense('e2', 'entry-a', 1000),
      expense('e3', 'entry-b', 500),
    ])
    const usage = await usageByEntry('t1')
    expect(usage.get('entry-a')).toEqual({ count: 2, foreignAmount: 4000 })
    expect(usage.get('entry-b')).toEqual({ count: 1, foreignAmount: 500 })
  })

  it('没有 rateBookEntryId 的开销（本位币记账）不计入任何条目', async () => {
    await db.expenses.bulkAdd([expense('e1', null, 300)])
    const usage = await usageByEntry('t1')
    expect(usage.size).toBe(0)
  })

  it('没有任何开销引用过的条目，压根不会出现在返回的 Map 里', async () => {
    const usage = await usageByEntry('t1')
    expect(usage.has('entry-never-used')).toBe(false)
  })

  it('现查现算——引用这个条目的开销被删掉之后，count/foreignAmount 会跟着降，不会停在历史高点', async () => {
    await db.expenses.bulkAdd([expense('e1', 'entry-a', 3000), expense('e2', 'entry-a', 1000)])
    expect((await usageByEntry('t1')).get('entry-a')).toEqual({ count: 2, foreignAmount: 4000 })
    await db.expenses.delete('e2')
    expect((await usageByEntry('t1')).get('entry-a')).toEqual({ count: 1, foreignAmount: 3000 })
  })

  it('拆多笔汇率的开销：rateBookEntryId 本身是空的，不直接计入；改由 expenseRateAllocations 里分到的那部分计入，和单选的开销混在一起累加不重不漏', async () => {
    await db.expenses.bulkAdd([
      expense('e1', 'entry-a', 500), // 单选，直接引用 entry-a
      expense('e2', null, 3200, true), // 拆分开销本身 rateBookEntryId 为空
    ])
    await db.expenseRateAllocations.bulkAdd([
      allocation('a1', 'e2', 'entry-a', 2000),
      allocation('a2', 'e2', 'entry-b', 1200),
    ])
    const usage = await usageByEntry('t1')
    // entry-a：单选的500 + 拆分里分到的2000 = 2500，两笔账各算一次，count是2
    expect(usage.get('entry-a')).toEqual({ count: 2, foreignAmount: 2500 })
    expect(usage.get('entry-b')).toEqual({ count: 1, foreignAmount: 1200 })
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

describe('updateRateBookEntry', () => {
  beforeEach(async () => {
    await db.rateBookEntries.clear()
  })

  it('能同时改标签、汇率、换汇金额三样', async () => {
    const entry = await createRateBookEntry({
      tripId: 't1', foreignCurrency: 'JPY', label: '旧标签', rate: 0.03, source: 'manual', createdBy: 'papa',
    })
    await updateRateBookEntry(entry.id, {
      rate: 0.0296296, label: '新标签', exchangedHomeAmount: 200, exchangedForeignAmount: 6750,
    })
    const updated = await db.rateBookEntries.get(entry.id)
    expect(updated?.label).toBe('新标签')
    expect(updated?.rate).toBe(0.0296296)
    expect(updated?.exchangedHomeAmount).toBe(200)
    expect(updated?.exchangedForeignAmount).toBe(6750)
  })

  it('换汇金额传 null 时能把已有的清掉（比如编辑时把两个金额都删空）', async () => {
    const entry = await createRateBookEntry({
      tripId: 't1', foreignCurrency: 'JPY', label: '有换汇记录', rate: 0.03, source: 'manual', createdBy: 'papa',
      exchangedHomeAmount: 500, exchangedForeignAmount: 16500,
    })
    await updateRateBookEntry(entry.id, {
      rate: 0.03, label: '有换汇记录', exchangedHomeAmount: null, exchangedForeignAmount: null,
    })
    const updated = await db.rateBookEntries.get(entry.id)
    expect(updated?.exchangedHomeAmount).toBeNull()
    expect(updated?.exchangedForeignAmount).toBeNull()
  })
})
