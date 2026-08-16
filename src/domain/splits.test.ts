import { describe, it, expect, beforeEach } from 'vitest'
import { resolveSplitShares, computeBalances, simplifyDebts, type PersonBalance } from './splits'
import { db } from '../db/dexie'

describe('resolveSplitShares', () => {
  it('不分摊时全额算付款人自己的', () => {
    const shares = resolveSplitShares(300, 'none', ['a', 'b', 'c'], 'a')
    expect(shares).toEqual([{ memberId: 'a', shareAmount: 300 }])
  })

  it('没勾任何人时也是全额算付款人自己的，即使splitType传了equal', () => {
    const shares = resolveSplitShares(300, 'equal', [], 'a')
    expect(shares).toEqual([{ memberId: 'a', shareAmount: 300 }])
  })

  it('只勾了1个非付款人时，全额记成那个人欠的，不能被静默改记回付款人名下（真实bug回归用例：BX垫付、只勾KN）', () => {
    const shares = resolveSplitShares(100, 'none', ['kn'], 'bx')
    expect(shares).toEqual([{ memberId: 'kn', shareAmount: 100 }])
  })

  it('只勾了1个人、且那个人就是付款人本人时，等价于算他自己的', () => {
    const shares = resolveSplitShares(100, 'none', ['bx'], 'bx')
    expect(shares).toEqual([{ memberId: 'bx', shareAmount: 100 }])
  })

  it('能整除时均分，加总等于原金额', () => {
    const shares = resolveSplitShares(300, 'equal', ['a', 'b', 'c'], 'a')
    expect(shares).toEqual([
      { memberId: 'a', shareAmount: 100 },
      { memberId: 'b', shareAmount: 100 },
      { memberId: 'c', shareAmount: 100 },
    ])
  })

  it('不能整除时，余数进第一个人，加总仍然精确等于原金额（不会凭空丢失几分钱）', () => {
    const shares = resolveSplitShares(100, 'equal', ['a', 'b', 'c'], 'a')
    const total = shares.reduce((sum, s) => sum + s.shareAmount, 0)
    expect(Math.round(total * 100) / 100).toBe(100)
    expect(shares[0].shareAmount).toBeCloseTo(33.34, 2)
    expect(shares[1].shareAmount).toBeCloseTo(33.33, 2)
    expect(shares[2].shareAmount).toBeCloseTo(33.33, 2)
  })

  it('2人分摊奇数分（如10.01）也精确加总', () => {
    const shares = resolveSplitShares(10.01, 'equal', ['a', 'b'], 'a')
    const total = shares.reduce((sum, s) => sum + s.shareAmount, 0)
    expect(Math.round(total * 100) / 100).toBe(10.01)
  })

  it('exact自定义金额：按customAmounts原样落地，不强制平分', () => {
    const shares = resolveSplitShares(100, 'exact', ['a', 'b', 'c'], 'a', { a: 50, b: 30, c: 20 })
    expect(shares).toEqual([
      { memberId: 'a', shareAmount: 50 },
      { memberId: 'b', shareAmount: 30 },
      { memberId: 'c', shareAmount: 20 },
    ])
  })

  it('exact但只勾了1个人时，跟其他splitType一样全额算那个人的，不看customAmounts', () => {
    const shares = resolveSplitShares(100, 'exact', ['kn'], 'bx', { kn: 999 })
    expect(shares).toEqual([{ memberId: 'kn', shareAmount: 100 }])
  })
})

describe('simplifyDebts', () => {
  function balance(memberId: string, net: number): PersonBalance {
    return { memberId, paid: 0, owed: 0, settledOut: 0, settledIn: 0, net, expenseCount: 0 }
  }

  it('净额刚好抵消时不产生任何转账', () => {
    const transfers = simplifyDebts([balance('a', 0.2), balance('b', -0.2)])
    expect(transfers).toEqual([])
  })

  it('一收一付，转账金额等于净额', () => {
    const transfers = simplifyDebts([balance('a', 100), balance('b', -100)])
    expect(transfers).toEqual([{ from: 'b', to: 'a', amount: 100 }])
  })

  it('多债权人多债务人时，转账总数不超过 人数-1（贪心最简结算）', () => {
    const balances = [balance('a', 170), balance('b', -40), balance('c', -130)]
    const transfers = simplifyDebts(balances)
    expect(transfers.length).toBeLessThanOrEqual(balances.length - 1)
    const totalToA = transfers.filter((t) => t.to === 'a').reduce((s, t) => s + t.amount, 0)
    expect(totalToA).toBeCloseTo(170, 2)
  })
})

describe('computeBalances（真实走一遍Dexie，用fake-indexeddb）', () => {
  const tripId = 'trip-test-1'

  beforeEach(async () => {
    await db.expenses.where('tripId').equals(tripId).delete()
    await db.expenseSplits.where('expenseId').startsWith('exp-test').delete()
    await db.settlements.where('tripId').equals(tripId).delete()
  })

  it('3人均摊两笔账目，净额与手工核算一致；再叠加部分结算记录后净额相应调整', async () => {
    const now = Date.now()
    await db.expenses.bulkAdd([
      {
        id: 'exp-test-1', householdId: 'h1', tripId, categoryId: 'cat-food', phase: 'during_trip', description: null,
        expenseCurrency: 'MYR', expenseAmount: 300, rateBookEntryId: null, rateUsed: 1, homeAmount: 300,
        paidBy: 'papa', recordedBy: 'papa', expenseDate: '2026-09-02', itineraryDayId: null, itineraryItemId: null,
        splitType: 'equal', createdAt: now, updatedAt: now,
      },
      {
        id: 'exp-test-2', householdId: 'h1', tripId, categoryId: 'cat-shop', phase: 'during_trip', description: null,
        expenseCurrency: 'MYR', expenseAmount: 90, rateBookEntryId: null, rateUsed: 1, homeAmount: 90,
        paidBy: 'mama', recordedBy: 'mama', expenseDate: '2026-09-02', itineraryDayId: null, itineraryItemId: null,
        splitType: 'equal', createdAt: now, updatedAt: now,
      },
    ])
    await db.expenseSplits.bulkAdd([
      { id: 'split-1', householdId: 'h1', expenseId: 'exp-test-1', memberId: 'papa', shareAmount: 100 },
      { id: 'split-2', householdId: 'h1', expenseId: 'exp-test-1', memberId: 'mama', shareAmount: 100 },
      { id: 'split-3', householdId: 'h1', expenseId: 'exp-test-1', memberId: 'aming', shareAmount: 100 },
      { id: 'split-4', householdId: 'h1', expenseId: 'exp-test-2', memberId: 'papa', shareAmount: 30 },
      { id: 'split-5', householdId: 'h1', expenseId: 'exp-test-2', memberId: 'mama', shareAmount: 30 },
      { id: 'split-6', householdId: 'h1', expenseId: 'exp-test-2', memberId: 'aming', shareAmount: 30 },
    ])

    let balances = await computeBalances(tripId)
    const byId = (id: string) => balances.find((b) => b.memberId === id)!

    expect(byId('papa').net).toBe(170) // 垫付300，应分摊130
    expect(byId('mama').net).toBe(-40) // 垫付90，应分摊130
    expect(byId('aming').net).toBe(-130) // 垫付0，应分摊130

    // 阿明先还50给爸爸
    await db.settlements.add({
      id: 'settle-1', householdId: 'h1', tripId, fromMemberId: 'aming', toMemberId: 'papa', amount: 50,
      settledDate: '2026-09-04', note: '转账', createdAt: now, updatedAt: now,
    })

    balances = await computeBalances(tripId)
    const byId2 = (id: string) => balances.find((b) => b.memberId === id)!
    expect(byId2('papa').net).toBe(120) // 170 - 50(收到)
    expect(byId2('aming').net).toBe(-80) // -130 + 50(还出去)
  })
})
