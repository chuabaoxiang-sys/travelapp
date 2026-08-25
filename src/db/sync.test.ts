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

const { pruneSyncedOutbox, computeIdsToDelete } = await import('./sync')

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

describe('computeIdsToDelete', () => {
  it('普通表：本地有、远端没有、也没有待推送记录——判定为别的设备删的，清掉', () => {
    const ids = computeIdsToDelete('expenses', [{ id: 'exp-1' }], new Set(), new Set())
    expect(ids).toEqual(['exp-1'])
  })

  it('普通表：本地有、远端没有，但这一行自己的id在待推送里——还没推上去，不能当成远端删除', () => {
    const ids = computeIdsToDelete('expenses', [{ id: 'exp-1' }], new Set(), new Set(['exp-1']))
    expect(ids).toEqual([])
  })

  it('真实bug回归用例：expenseSplits刚记完、还没推上去时不能被pull误删——outbox记的是' +
    'expenseId不是分摊行自己的id，得按expenseId去查，不是按行id', () => {
    const rows = [
      { id: 'split-row-1', expenseId: 'exp-99' },
      { id: 'split-row-2', expenseId: 'exp-99' },
    ]
    // pendingIds里存的是expenseId（'exp-99'），不是split-row-1/2这两个行自己的id——
    // 如果实现退化成直接比对行id，这两行都查不到会被判定成"远端删除"，回归这个bug
    const ids = computeIdsToDelete('expenseSplits', rows, new Set(), new Set(['exp-99']))
    expect(ids).toEqual([])
  })

  it('expenseSplits：这个expenseId确实不在待推送里了（真的是别的设备删掉这笔账目），照常清掉', () => {
    const rows = [{ id: 'split-row-1', expenseId: 'exp-99' }]
    const ids = computeIdsToDelete('expenseSplits', rows, new Set(), new Set(['exp-other']))
    expect(ids).toEqual(['split-row-1'])
  })

  it('远端还有这一行的，不管待推送状态如何都不删', () => {
    const ids = computeIdsToDelete('expenses', [{ id: 'exp-1' }], new Set(['exp-1']), new Set())
    expect(ids).toEqual([])
  })
})
