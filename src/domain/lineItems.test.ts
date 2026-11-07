import { describe, it, expect } from 'vitest'
import { resolveLineItemShares } from './lineItems'
import { round2 } from './splits'
describe('resolveLineItemShares 按这笔的币种填，再按比例分本位币（2026-11-07）', () => {
  it('原价 ¥16,000（手表 ¥10,000 归 BX、零食 ¥6,000 两人分）、实付 RM374.59：优惠按比例摊，合计刚好', () => {
    const shares = resolveLineItemShares([
      { name: '手表', amount: 10000, memberIds: ['bx'] },
      { name: '零食', amount: 6000, memberIds: ['bx', 'kn'] },
    ], 0, 374.59)
    const by = Object.fromEntries(shares.map((s) => [s.memberId, s.shareAmount]))
    expect(by.bx).toBe(304.35)
    expect(by.kn).toBe(70.24)
    expect(round2(by.bx + by.kn)).toBe(374.59)
  })
  it('没传 homeAmount 时还是原来的算法', () => {
    expect(resolveLineItemShares([{ name: 'a', amount: 10, memberIds: ['x'] }], 10)).toEqual([{ memberId: 'x', shareAmount: 11 }])
  })
})
