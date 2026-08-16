import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../db/dexie'
import type { Trip } from '../types'

const pushOutboxMock = vi.fn().mockResolvedValue({ pushed: 0, failed: 0 })
vi.mock('../db/sync', () => ({ pushOutbox: (...args: unknown[]) => pushOutboxMock(...args) }))

// 这几个函数改本地Dexie之后，会立刻尝试推一次远端同步——这是这次改动本身要
// 修的race condition（首次分享/切换模板后，预览页因为还没同步到远端而显示
// 旧数据或"链接打不开"）。这里直接回归测这个修复：每次改动之后pushOutbox
// 有没有被调用，而不是重新验证Dexie写入本身（那部分splits.test.ts等已经覆盖过）
const { setShareScope, setShareTemplate, regenerateShareToken } = await import('./share')

describe('分享设置改动后会立刻推送同步（真机复现过的race condition回归测试）', () => {
  const tripId = 'trip-share-test'

  function baseTrip(): Trip {
    return {
      id: tripId, householdId: 'h1', name: '测试行程', homeCurrency: 'MYR',
      startDate: null, endDate: null, status: 'planning',
      publicShareScope: 'none', publicShareToken: null, publicShareTemplate: null,
      createdAt: 0, updatedAt: 0,
    }
  }

  beforeEach(async () => {
    pushOutboxMock.mockClear()
    await db.trips.put(baseTrip())
  })

  it('setShareScope 改完范围后会调用 pushOutbox', async () => {
    await setShareScope(tripId, 'itinerary')
    expect(pushOutboxMock).toHaveBeenCalledTimes(1)
  })

  it('setShareTemplate 切换模板后会调用 pushOutbox', async () => {
    await setShareTemplate(tripId, 'ticket')
    expect(pushOutboxMock).toHaveBeenCalledTimes(1)
  })

  it('regenerateShareToken 重新生成链接后会调用 pushOutbox', async () => {
    await regenerateShareToken(tripId)
    expect(pushOutboxMock).toHaveBeenCalledTimes(1)
  })

  it('setShareScope 首次开启分享时会生成 publicShareToken', async () => {
    await setShareScope(tripId, 'expenses')
    const trip = await db.trips.get(tripId)
    expect(trip?.publicShareToken).toBeTruthy()
  })
})
