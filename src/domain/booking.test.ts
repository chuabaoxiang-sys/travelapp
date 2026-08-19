import { describe, it, expect } from 'vitest'
import { toggleBookingStatus } from './booking'

describe('toggleBookingStatus', () => {
  it('needed 切换成 booked', () => {
    expect(toggleBookingStatus('needed')).toBe('booked')
  })

  it('booked 切换回 needed', () => {
    expect(toggleBookingStatus('booked')).toBe('needed')
  })

  it('连续切换两次回到原状态，不会跑出 needed/booked 之外', () => {
    const once = toggleBookingStatus('needed')
    const twice = toggleBookingStatus(once)
    expect(twice).toBe('needed')
  })
})
