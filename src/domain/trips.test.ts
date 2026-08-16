import { describe, it, expect } from 'vitest'
import { computeTripStatus } from './trips'

const today = new Date('2026-08-16T12:00:00')

describe('computeTripStatus', () => {
  it('returns planning when no start date is set', () => {
    expect(computeTripStatus({ status: 'planning', startDate: null, endDate: null }, today)).toBe('planning')
  })

  it('returns planning when the start date is still in the future', () => {
    expect(computeTripStatus({ status: 'active', startDate: '2026-09-01', endDate: '2026-09-05' }, today)).toBe('planning')
  })

  it('returns active when today falls within the date range', () => {
    expect(computeTripStatus({ status: 'planning', startDate: '2026-08-10', endDate: '2026-08-20' }, today)).toBe('active')
  })

  it('returns active on the exact start and end date boundaries', () => {
    expect(computeTripStatus({ status: 'planning', startDate: '2026-08-16', endDate: '2026-08-16' }, today)).toBe('active')
  })

  it('returns active when there is a start date but no end date (open-ended trip)', () => {
    expect(computeTripStatus({ status: 'planning', startDate: '2026-08-01', endDate: null }, today)).toBe('active')
  })

  it('returns completed once the end date has passed', () => {
    expect(computeTripStatus({ status: 'active', startDate: '2026-07-01', endDate: '2026-07-10' }, today)).toBe('completed')
  })

  it('leaves an already-archived trip archived regardless of dates', () => {
    expect(computeTripStatus({ status: 'archived', startDate: '2026-07-01', endDate: '2026-07-10' }, today)).toBe('archived')
  })
})
