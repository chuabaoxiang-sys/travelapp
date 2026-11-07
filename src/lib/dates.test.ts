import { describe, it, expect } from 'vitest'
import { defaultTripDate } from './dates'

describe('defaultTripDate：打开行程页 / 记新账默认停在哪一天', () => {
  const trip = { startDate: '2026-10-21', endDate: '2026-11-06' }

  it('行程进行中：今天', () => {
    expect(defaultTripDate(trip, '2026-11-03')).toBe('2026-11-03')
  })

  it('出发日、结束日当天也算进行中', () => {
    expect(defaultTripDate(trip, '2026-10-21')).toBe('2026-10-21')
    expect(defaultTripDate(trip, '2026-11-06')).toBe('2026-11-06')
  })

  it('还没出发：第一天', () => {
    expect(defaultTripDate(trip, '2026-09-15')).toBe('2026-10-21')
  })

  it('已经结束：最后一天', () => {
    expect(defaultTripDate(trip, '2026-11-07')).toBe('2026-11-06')
  })

  it('行程没设日期：今天', () => {
    expect(defaultTripDate({ startDate: null, endDate: null }, '2026-11-07')).toBe('2026-11-07')
  })
})
