import { describe, it, expect } from 'vitest'
import { buildItemizedSplitShares, resolveLineItemShares } from './lineItems'
import { proxyReceivable, round2 } from './splits'
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

describe('逐项拆账 + 代购（0051）', () => {
  // 原价 ¥16,000、实付 RM374.59：手表 ¥10,000 全给妈妈（代购），零食 ¥6,000 BX、KN、妈妈三人均分
  const items = [
    { name: '手表', amount: 10000, memberIds: [], proxyNames: ['妈妈'] },
    { name: '零食', amount: 6000, memberIds: ['bx', 'kn'], proxyNames: ['妈妈'] },
  ]
  it('代购的人变成代购行（记在付款人名下），proxyAmount 是他占的原价；合计刚好等于实付', () => {
    const shares = buildItemizedSplitShares(items, 0, 374.59, 'bx', new Map([['妈妈', 123]]))
    const mama = shares.find((s) => s.proxyName === '妈妈')!
    expect(mama.memberId).toBe('bx')
    expect(mama.proxyAmount).toBe(12000)
    expect(mama.proxyRepaidAt).toBe(123)
    expect(round2(shares.reduce((a, s) => a + s.shareAmount, 0))).toBe(374.59)
    expect(shares.filter((s) => !s.proxyName).map((s) => s.shareAmount)).toEqual([46.82, 46.82])
  })
  it('优惠不分给代购的人时，妈妈按原价还', () => {
    const mama = buildItemizedSplitShares(items, 0, 374.59, 'bx').find((s) => s.proxyName === '妈妈')!
    expect(proxyReceivable(mama, { homeAmount: 374.59, expenseAmount: 14000, discountAmount: 2000 })).toBe(321.08)
  })
})
