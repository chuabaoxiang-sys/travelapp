import { describe, it, expect } from 'vitest'
import { resolveTripPhase, daysUntil, currentDayIndex } from './tripPhase'

describe('resolveTripPhase', () => {
  it('今天早于出发日 → before', () => {
    expect(resolveTripPhase('2026-08-20', '2026-08-27', '2026-08-31')).toBe('before')
  })
  it('今天在起止范围内（含边界） → during', () => {
    expect(resolveTripPhase('2026-08-27', '2026-08-27', '2026-08-31')).toBe('during')
    expect(resolveTripPhase('2026-08-31', '2026-08-27', '2026-08-31')).toBe('during')
    expect(resolveTripPhase('2026-08-29', '2026-08-27', '2026-08-31')).toBe('during')
  })
  it('今天晚于结束日 → after', () => {
    expect(resolveTripPhase('2026-09-01', '2026-08-27', '2026-08-31')).toBe('after')
  })
  it('没设日期时退回 before，不是 after 或 during', () => {
    expect(resolveTripPhase('2026-08-29', null, null)).toBe('before')
    expect(resolveTripPhase('2026-08-29', '2026-08-27', null)).toBe('before')
  })
})

describe('daysUntil', () => {
  it('算出发日还有几天', () => {
    expect(daysUntil('2026-08-24', '2026-08-27')).toBe(3)
  })
  it('就是今天出发时是0', () => {
    expect(daysUntil('2026-08-27', '2026-08-27')).toBe(0)
  })
})

describe('currentDayIndex', () => {
  it('出发当天是第1天', () => {
    expect(currentDayIndex('2026-08-27', '2026-08-27')).toBe(1)
  })
  it('出发后第3天是第3天', () => {
    expect(currentDayIndex('2026-08-29', '2026-08-27')).toBe(3)
  })
})
