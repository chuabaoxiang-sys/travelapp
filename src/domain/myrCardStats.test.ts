import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db/dexie'
import { tripBlendedRates } from './rates'
import { cardUsageForTrip } from './paymentCards'
import type { Expense, Trip } from '../types'

// 马币账也能刷卡（2026-11-08）：马币刷卡只为了记卡和返现，没有换汇，
// 不能混进「这趟换汇怎么样」和卡的平均汇率
function exp(id: string, currency: string, amount: number, home: number): Expense {
  return {
    id, householdId: 'h1', tripId: 't1', categoryId: 'c', expenseDate: '2026-10-26', phase: 'during_trip',
    expenseCurrency: currency, expenseAmount: amount, rateBookEntryId: null, rateUsed: home / amount, homeAmount: home,
    paidBy: 'bx', recordedBy: 'bx', splitType: 'equal', itineraryDayId: null, itineraryItemId: null, description: id,
    deletedAt: null, createdAt: 0, updatedAt: 0, paymentCardId: 'tng', cardChargePending: false,
  } as Expense
}

beforeEach(async () => {
  await Promise.all([db.trips.clear(), db.expenses.clear(), db.rateBookEntries.clear()])
  await db.trips.add({ id: 't1', householdId: 'h1', name: '东京北海道 2026', homeCurrency: 'MYR' } as Trip)
  await db.expenses.bulkAdd([
    exp('jpy', 'JPY', 49210, 1295.55),
    exp('hotel', 'MYR', 547.02, 547.02),
  ])
})

describe('马币刷卡不进换汇统计', () => {
  it('「这趟换汇怎么样」只有 JPY，没有 MYR', async () => {
    const rates = await tripBlendedRates('t1')
    expect(rates.map((r) => r.foreignCurrency)).toEqual(['JPY'])
    expect(rates[0].card?.count).toBe(1)
  })

  it('卡的平均汇率只算外币那几笔，笔数照样算马币那笔', async () => {
    const usage = (await cardUsageForTrip('t1')).get('tng')!
    expect(usage.count).toBe(2)
    expect(usage.averageRate).toBeCloseTo(1295.55 / 49210, 8)
  })
})
