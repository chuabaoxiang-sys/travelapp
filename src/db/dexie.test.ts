import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db, withoutOutboxTracking, deleteTripCascade } from './dexie'

vi.mock('../domain/household', () => ({ getCurrentHouseholdId: async () => 'h1' }))

function deferred<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

function trip(id: string) {
  return {
    id, householdId: 'h1', name: 'x', homeCurrency: 'MYR', startDate: null, endDate: null,
    status: 'planning' as const, publicShareScope: 'none' as const, publicShareToken: null,
    publicShareTemplate: null, deletedAt: null, createdAt: 0, updatedAt: 0,
  }
}

// 2026-08-23的真实bug：suppressOutboxTracking曾经是个布尔值，网络不好时两轮
// runSync()重叠执行，先结束的那一轮会把还在进行中的另一轮也一起"解除屏蔽"，
// 导致pullAll()写回本地的远端数据被误记成本地新写入。这里直接模拟两个重叠的
// withoutOutboxTracking调用，证明先结束的那个不会影响还在进行中的另一个
describe('withoutOutboxTracking 重入计数', () => {
  beforeEach(async () => {
    await db.trips.clear()
    await db.outbox.clear()
  })

  it('两个调用重叠时，先结束的那个不会提前解除屏蔽', async () => {
    const gateA = deferred()
    const gateB = deferred()

    const callA = withoutOutboxTracking(() => gateA.promise)
    const callB = withoutOutboxTracking(async () => {
      await gateB.promise
      await db.trips.add(trip('t-race'))
    })

    gateA.resolve()
    await callA

    gateB.resolve()
    await callB

    expect(await db.outbox.where('status').equals('pending').count()).toBe(0)
  })

  it('没有重叠时，屏蔽结束后新写入照常记进outbox', async () => {
    await withoutOutboxTracking(async () => {
      await db.trips.add(trip('t-suppressed'))
    })
    expect(await db.outbox.where('status').equals('pending').count()).toBe(0)

    await db.trips.add(trip('t-normal'))
    expect(await db.outbox.where('status').equals('pending').count()).toBe(1)
  })
})

// 2026-09-10：删除行程从硬删除改成软删除——之前一键删除会级联真删十张表，
// 没有任何找回余地；现在改成打deletedAt时间戳，行数据本身还在。这个测试
// 摆一份完整的"一趟行程该有的东西"（含之前从没被cascade碰过、会变成孤儿
// 数据的daySatisfactions/expenseLineItems那四张表），删完逐张核实：所有行
// 都还在（count不变），且deletedAt都被打上了同一个时间戳，不是被真的清空
describe('deleteTripCascade（软删除，真实走Dexie）', () => {
  const tripId = 't-cascade'
  const dayId = 'day-cascade'
  const expenseId = 'exp-cascade'
  const lineItemId = 'li-cascade'

  beforeEach(async () => {
    for (const name of [
      'trips', 'tripMembers', 'itineraryDays', 'itineraryItems', 'expenses', 'expenseSplits',
      'expenseDayAllocations', 'expenseRateAllocations', 'budgets', 'settlements',
      'daySatisfactions', 'expenseSatisfactions', 'expenseLineItems', 'expenseLineItemMembers',
    ] as const) {
      await db.table(name).clear()
    }

    await db.trips.add(trip(tripId))
    await db.tripMembers.add({ id: 'tm-cascade', tripId, memberId: 'm1', deletedAt: null })
    await db.itineraryDays.add({ id: dayId, householdId: 'h1', tripId, date: '2026-09-10', title: null, notes: null, deletedAt: null, createdAt: 0, updatedAt: 0 })
    await db.itineraryItems.add({
      id: 'item-cascade', householdId: 'h1', dayId, tripId, orderIndex: 0, time: null, title: '测试项',
      locationName: null, lat: null, lng: null, notes: null, createdBy: null, sourceWishlistId: null,
      deletedAt: null, createdAt: 0, updatedAt: 0,
    })
    await db.expenses.add({
      id: expenseId, householdId: 'h1', tripId, categoryId: 'cat-food', phase: 'during_trip', description: null,
      expenseCurrency: 'MYR', expenseAmount: 100, rateBookEntryId: null, rateUsed: 1, homeAmount: 100,
      paidBy: 'm1', recordedBy: 'm1', expenseDate: '2026-09-10', itineraryDayId: dayId, itineraryItemId: null,
      splitType: 'itemized', deletedAt: null, createdAt: 0, updatedAt: 0,
    })
    await db.expenseSplits.add({ id: 'split-cascade', householdId: 'h1', expenseId, memberId: 'm1', shareAmount: 100, deletedAt: null })
    await db.expenseDayAllocations.add({ id: 'alloc-cascade', householdId: 'h1', expenseId, tripId, date: '2026-09-10', amount: 100, deletedAt: null })
    await db.expenseRateAllocations.add({ id: 'ralloc-cascade', householdId: 'h1', expenseId, tripId, rateBookEntryId: 'rate-1', foreignAmount: 100, rateUsed: 1, homeAmount: 100, deletedAt: null })
    await db.budgets.add({ id: 'budget-cascade', householdId: 'h1', tripId, categoryId: null, phase: null, amount: 1000, alertThresholdPct: 90, deletedAt: null })
    await db.settlements.add({
      id: 'settle-cascade', householdId: 'h1', tripId, fromMemberId: 'm1', toMemberId: 'm2', amount: 10,
      settledDate: '2026-09-10', note: null, createdBy: 'm1', expenseId: null, isPrepayment: false, deletedAt: null, createdAt: 0, updatedAt: 0,
    })
    await db.daySatisfactions.add({ id: 'ds-cascade', householdId: 'h1', tripId, dayId, memberId: 'm1', rating: 'worth', deletedAt: null, createdAt: 0, updatedAt: 0 })
    await db.expenseSatisfactions.add({ id: 'es-cascade', householdId: 'h1', tripId, expenseId, memberId: 'm1', rating: 'worth', deletedAt: null, createdAt: 0, updatedAt: 0 })
    await db.expenseLineItems.add({ id: lineItemId, householdId: 'h1', expenseId, name: '子项', amount: 100, orderIndex: 0, deletedAt: null })
    await db.expenseLineItemMembers.add({ id: 'lim-cascade', householdId: 'h1', lineItemId, memberId: 'm1', deletedAt: null })
  })

  it('删除后，十四张关联表的行都还在（不是被真的清掉），且都打上了deletedAt', async () => {
    await deleteTripCascade(tripId)

    const tables = [
      ['trips', tripId], ['tripMembers', 'tm-cascade'], ['itineraryDays', dayId], ['itineraryItems', 'item-cascade'],
      ['expenses', expenseId], ['expenseSplits', 'split-cascade'], ['expenseDayAllocations', 'alloc-cascade'],
      ['expenseRateAllocations', 'ralloc-cascade'], ['budgets', 'budget-cascade'], ['settlements', 'settle-cascade'],
      ['daySatisfactions', 'ds-cascade'], ['expenseSatisfactions', 'es-cascade'], ['expenseLineItems', lineItemId],
      ['expenseLineItemMembers', 'lim-cascade'],
    ] as const

    for (const [tableName, id] of tables) {
      const row = await db.table(tableName).get(id)
      expect(row, `${tableName} 的行不应该被真的删掉`).toBeDefined()
      expect(row.deletedAt, `${tableName} 应该打上deletedAt`).not.toBeNull()
    }
  })

  it('删除后行程从"我的行程"该走的查询路径里消失——用trips表自己的deletedAt过滤能排掉它', async () => {
    await deleteTripCascade(tripId)
    const visibleTrips = (await db.trips.toArray()).filter((t) => !t.deletedAt)
    expect(visibleTrips.find((t) => t.id === tripId)).toBeUndefined()
  })
})
