import { describe, it, expect } from 'vitest'
import { isRouteCacheUsable } from './routeLegs'
import type { RouteLegCacheEntry } from '../types'

const HOUR = 60 * 60 * 1000
const from = { lat: 1, lng: 1 }
const to = { lat: 2, lng: 2 }

function entry(legs: RouteLegCacheEntry['legs'], fetchedAt: number, signature = 'sig'): RouteLegCacheEntry {
  return { dayId: 'd1', signature, legs, fetchedAt }
}

// 以前查失败的结果也永久缓存：某天碰上一次没网，只要行程不改就永远没有步行时间
describe('isRouteCacheUsable', () => {
  const now = 10 * HOUR

  it('全部查成功的缓存：签名对得上就一直用', () => {
    const ok = entry([{ kind: 'ok', distanceMeters: 500, durationSeconds: 400, from, to }], 0)
    expect(isRouteCacheUsable(ok, 'sig', now)).toBe(true)
  })

  it('有查失败的：一小时内照用，满一小时就重新查', () => {
    const failed = entry([{ kind: 'unavailable', from, to }], now - HOUR + 1)
    expect(isRouteCacheUsable(failed, 'sig', now)).toBe(true)
    const stale = entry([{ kind: 'unavailable', from, to }], now - HOUR)
    expect(isRouteCacheUsable(stale, 'sig', now)).toBe(false)
  })

  it('"缺坐标"不是查失败，不触发重查', () => {
    const missing = entry([{ kind: 'missing-coords' }], 0)
    expect(isRouteCacheUsable(missing, 'sig', now)).toBe(true)
  })

  it('签名对不上（行程改过）或者没有缓存，都要重新查', () => {
    expect(isRouteCacheUsable(entry([], 0, 'old'), 'sig', now)).toBe(false)
    expect(isRouteCacheUsable(undefined, 'sig', now)).toBe(false)
  })
})
