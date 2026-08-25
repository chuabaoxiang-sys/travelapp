import { describe, it, expect } from 'vitest'
import { easeOutCubic } from './easing'

describe('easeOutCubic', () => {
  it('起点是0、终点精确是1', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
  })

  it('先快后慢——前一半时间走的路比后一半多，不是匀速也不是先慢后快', () => {
    const half = easeOutCubic(0.5)
    expect(half).toBeGreaterThan(0.5)
  })

  it('全程单调递增，不会中途回退', () => {
    const samples = [0, 0.2, 0.4, 0.6, 0.8, 1].map(easeOutCubic)
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1])
    }
  })
})
