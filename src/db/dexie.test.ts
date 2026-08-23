import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db, withoutOutboxTracking } from './dexie'

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
    publicShareTemplate: null, createdAt: 0, updatedAt: 0,
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
