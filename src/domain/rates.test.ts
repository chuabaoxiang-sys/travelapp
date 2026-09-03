import { describe, it, expect, beforeEach, vi } from 'vitest'
import { deriveRateFromExchangeAmounts, usageByEntry, createRateBookEntry, updateRateBookEntry, tripBlendedRates } from './rates'
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

describe('tripBlendedRates（真实走Dexie）', () => {
  beforeEach(async () => {
    await db.rateBookEntries.clear()
    await db.expenses.clear()
    await db.expenseRateAllocations.clear()
  })

  it('按实际花掉的外币金额加权，不是按换汇金额——同一个例子：机场换的贵但没花完，银行换的便宜且全部花掉', async () => {
    const airport = await createRateBookEntry({
      tripId: 't1', foreignCurrency: 'JPY', label: '机场换的', rate: 0.05, source: 'manual', createdBy: 'papa',
      exchangedHomeAmount: 1000, exchangedForeignAmount: 20000,
    })
    const bank = await createRateBookEntry({
      tripId: 't1', foreignCurrency: 'JPY', label: '银行换的', rate: 0.025, source: 'manual', createdBy: 'papa',
      exchangedHomeAmount: 1000, exchangedForeignAmount: 40000,
    })
    // 机场那笔20000只花了5000，银行那笔40000全花完——按花费加权应该更贴近银行的便宜汇率，
    // 不是简单平均两个rate，也不是按换汇总额(20000+40000)加权
    await db.expenses.bulkAdd([expense('e1', airport.id, 5000), expense('e2', bank.id, 40000)])

    const result = await tripBlendedRates('t1')
    expect(result).toHaveLength(1)
    expect(result[0].foreignCurrency).toBe('JPY')
    // (5000*0.05 + 40000*0.025) / 45000 = 1250/45000
    expect(result[0].blendedRate).toBeCloseTo(1250 / 45000, 6)
  })

  it('完全没被任何开销用过的币种不出现在结果里，哪怕汇率簿里有条目', async () => {
    await createRateBookEntry({
      tripId: 't1', foreignCurrency: 'KRW', label: '换了但没花', rate: 0.003, source: 'manual', createdBy: 'papa',
    })
    const result = await tripBlendedRates('t1')
    expect(result).toHaveLength(0)
  })

  it('多币种各自独立加权，互不影响', async () => {
    const jpy = await createRateBookEntry({
      tripId: 't1', foreignCurrency: 'JPY', label: '日元', rate: 0.03, source: 'manual', createdBy: 'papa',
    })
    const krw = await createRateBookEntry({
      tripId: 't1', foreignCurrency: 'KRW', label: '韩元', rate: 0.0032, source: 'manual', createdBy: 'papa',
    })
    await db.expenses.bulkAdd([expense('e1', jpy.id, 10000), expense('e2', krw.id, 50000)])

    const result = await tripBlendedRates('t1')
    const byCurrency = Object.fromEntries(result.map((r) => [r.foreignCurrency, r.blendedRate]))
    expect(byCurrency.JPY).toBeCloseTo(0.03, 6)
    expect(byCurrency.KRW).toBeCloseTo(0.0032, 6)
  })

  it('拆多笔汇率的开销（走expenseRateAllocations）也计入加权', async () => {
    const entryA = await createRateBookEntry({
      tripId: 't1', foreignCurrency: 'JPY', label: 'A', rate: 0.04, source: 'manual', createdBy: 'papa',
    })
    const entryB = await createRateBookEntry({
      tripId: 't1', foreignCurrency: 'JPY', label: 'B', rate: 0.02, source: 'manual', createdBy: 'papa',
    })
    await db.expenses.bulkAdd([expense('e1', null, 3000, true)])
    await db.expenseRateAllocations.bulkAdd([
      allocation('a1', 'e1', entryA.id, 1000),
      allocation('a2', 'e1', entryB.id, 2000),
    ])
    const result = await tripBlendedRates('t1')
    // (1000*0.04 + 2000*0.02) / 3000 = 80/3000
    expect(result[0].blendedRate).toBeCloseTo(80 / 3000, 6)
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
