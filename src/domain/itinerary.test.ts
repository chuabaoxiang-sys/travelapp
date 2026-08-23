import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sortItineraryItems, hasLinkedDaySpreadExpense, resolveDayForItemMove } from './itinerary'
import { db } from '../db/dexie'
import type { ItineraryItem, Expense } from '../types'

vi.mock('./household', () => ({ getCurrentHouseholdId: async () => 'h1' }))

function item(id: string, time: string | null, orderIndex: number): ItineraryItem {
  return {
    id, householdId: 'h1', dayId: 'day-1', tripId: 't1', orderIndex, time, title: id,
    locationName: null, lat: null, lng: null, notes: null, createdBy: null, sourceWishlistId: null,
    createdAt: 0, updatedAt: 0,
  }
}

describe('sortItineraryItems', () => {
  it('按时间排序，没设时间的排在最后（按orderIndex）', () => {
    const items = [item('c', null, 1), item('a', '09:00', 0), item('b', '08:00', 0), item('d', null, 0)]
    expect(sortItineraryItems(items).map((i) => i.id)).toEqual(['b', 'a', 'd', 'c'])
  })
})

function expense(id: string, itineraryItemId: string | null, daySpreadMode?: 'equal' | 'exact' | null): Expense {
  return {
    id, householdId: 'h1', tripId: 't1', categoryId: 'cat-food', phase: 'during_trip', description: null,
    expenseCurrency: 'MYR', expenseAmount: 100, rateBookEntryId: null, rateUsed: 1, homeAmount: 100,
    paidBy: 'papa', recordedBy: 'papa', expenseDate: '2026-08-26', itineraryDayId: 'day-1', itineraryItemId,
    splitType: 'equal', daySpreadMode: daySpreadMode ?? null, createdAt: 0, updatedAt: 0,
  }
}

describe('hasLinkedDaySpreadExpense / resolveDayForItemMove（真实走Dexie）', () => {
  beforeEach(async () => {
    await db.itineraryDays.clear()
    await db.itineraryItems.clear()
    await db.expenses.clear()
    await db.itineraryDays.add({ id: 'day-1', householdId: 'h1', tripId: 't1', date: '2026-08-26', title: null, notes: null, createdAt: 0, updatedAt: 0 })
  })

  it('没有关联账目时返回false', async () => {
    expect(await hasLinkedDaySpreadExpense('item-1')).toBe(false)
  })

  it('关联的是普通单日账目时返回false', async () => {
    await db.expenses.add(expense('e1', 'item-1'))
    expect(await hasLinkedDaySpreadExpense('item-1')).toBe(false)
  })

  it('关联的账目用了跨天分摊时返回true', async () => {
    await db.expenses.add(expense('e1', 'item-1', 'equal'))
    expect(await hasLinkedDaySpreadExpense('item-1')).toBe(true)
  })

  it('换日期：目标日期还没有itineraryDay记录时会自动建一条', async () => {
    const dayId = await resolveDayForItemMove('t1', '2026-08-27', 'item-1')
    const day = await db.itineraryDays.get(dayId)
    expect(day?.date).toBe('2026-08-27')
  })

  it('换日期：关联的普通单日账目会跟着把日期/dayId一起更新', async () => {
    await db.expenses.add(expense('e1', 'item-1'))
    const newDayId = await resolveDayForItemMove('t1', '2026-08-27', 'item-1')
    const updated = await db.expenses.get('e1')
    expect(updated?.itineraryDayId).toBe(newDayId)
    expect(updated?.expenseDate).toBe('2026-08-27')
  })

  it('换日期：关联的跨天分摊账目不会被自动改动（调用方应该已经弹过确认框）', async () => {
    await db.expenses.add(expense('e1', 'item-1', 'equal'))
    await resolveDayForItemMove('t1', '2026-08-27', 'item-1')
    const untouched = await db.expenses.get('e1')
    expect(untouched?.itineraryDayId).toBe('day-1')
    expect(untouched?.expenseDate).toBe('2026-08-26')
  })
})
