import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from './dexie'
import type { OutboxEntry } from '../types'

function makeLocalStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', makeLocalStorage())

const { pruneSyncedOutbox } = await import('./sync')

const DAY = 24 * 60 * 60 * 1000

function entry(id: string, status: OutboxEntry['status'], createdAt: number): OutboxEntry {
  return { id, tableName: 'expenses', recordId: `rec-${id}`, operation: 'upsert', payload: null, status, attempts: 0, lastError: null, createdAt }
}

describe('pruneSyncedOutbox', () => {
  beforeEach(async () => {
    await db.outbox.clear()
    localStorage.clear()
  })

  it('清掉超过7天的synced记录，不碰pending的和没过期的', async () => {
    const now = Date.now()
    await db.outbox.bulkAdd([
      entry('old-synced', 'synced', now - 8 * DAY),
      entry('recent-synced', 'synced', now - 1 * DAY),
      entry('old-pending', 'pending', now - 30 * DAY),
    ])

    await pruneSyncedOutbox()

    const remainingIds = (await db.outbox.toArray()).map((e) => e.id).sort()
    expect(remainingIds).toEqual(['old-pending', 'recent-synced'])
  })

  it('24小时内已经跑过一次，直接跳过不重复清理', async () => {
    localStorage.setItem('outboxPruneLastRunAt', String(Date.now()))
    await db.outbox.add(entry('old-synced', 'synced', Date.now() - 8 * DAY))

    await pruneSyncedOutbox()

    expect(await db.outbox.count()).toBe(1)
  })
})
