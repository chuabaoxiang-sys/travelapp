import { describe, it, expect } from 'vitest'
import { formatMoney, round2 } from './money'

describe('formatMoney', () => {
  it('整数金额不显示小数', () => {
    expect(formatMoney(500)).toBe('RM500')
    expect(formatMoney(1234)).toBe('RM1,234')
  })

  it('有小数的金额，照实显示两位小数，不再四舍五入成整数', () => {
    expect(formatMoney(509.6)).toBe('RM509.60')
    expect(formatMoney(509.05)).toBe('RM509.05')
  })

  it('浮点数计算噪音（汇率相乘常见）不会暴露给用户，按分四舍五入干净显示', () => {
    expect(formatMoney(509.60000000000002)).toBe('RM509.60')
    expect(formatMoney(509.59999999999997)).toBe('RM509.60')
  })

  it('可以传自定义币种符号', () => {
    expect(formatMoney(100, 'JPY')).toBe('JPY100')
  })
})

describe('round2', () => {
  it('清理浮点误差到两位小数', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round2(509.60000000000002)).toBe(509.6)
  })
})
