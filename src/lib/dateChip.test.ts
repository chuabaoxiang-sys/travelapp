import { describe, it, expect } from 'vitest'
import { formatDateChipDow, formatDateChipDate } from './dateChip'

describe('formatDateChipDow', () => {
  it('中文用"周X"', () => {
    // 2026-09-04 是周五
    expect(formatDateChipDow('2026-09-04', 'zh')).toBe('周五')
  })

  it('英文用三字母缩写', () => {
    expect(formatDateChipDow('2026-09-04', 'en')).toBe('Fri')
  })
})

describe('formatDateChipDate', () => {
  it('中文用"M/D"，不补零', () => {
    expect(formatDateChipDate('2026-09-04', 'zh')).toBe('9/4')
    expect(formatDateChipDate('2026-01-09', 'zh')).toBe('1/9')
  })

  it('英文用"Mon D"', () => {
    expect(formatDateChipDate('2026-09-04', 'en')).toBe('Sep 4')
  })
})
