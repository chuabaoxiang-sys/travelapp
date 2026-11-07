import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../db/dexie'
import { buildSplitShares, resolveProxyShares, computeBalances, openExpenseDebts } from './splits'
import { groupProxyItems, proxySummary, setProxyRepaid, toProxyItems } from './proxies'
import { fillCardCharge } from './cardCharges'
import type { Expense, ExpenseSplit } from '../types'

vi.mock('./household', () => ({ getCurrentHouseholdId: async () => 'h1', getCachedHouseholdIdSync: () => 'h1' }))

// 例子用的是这趟真实的 Mega Donki：¥13,298、刷卡 RM350.55，帮妈妈 ¥4,600、小王 ¥3,000
const LINES = [{ name: '妈妈', amount: 4600 }, { name: '小王', amount: 3000 }]

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: 'e1', householdId: 'h1', tripId: 't1', categoryId: 'cat-shop', phase: 'during_trip', description: 'Mega Donki',
    expenseCurrency: 'JPY', expenseAmount: 13298, rateBookEntryId: null, rateUsed: 350.55 / 13298, homeAmount: 350.55,
    paidBy: 'bx', recordedBy: 'bx', expenseDate: '2026-10-31', itineraryDayId: null, itineraryItemId: null,
    splitType: 'equal', deletedAt: null, createdAt: 0, updatedAt: 0, ...over,
  } as Expense
}

function rows(expenseId: string, shares: ReturnType<typeof buildSplitShares>): ExpenseSplit[] {
  return shares.map((s, i) => ({
    id: `${expenseId}-s${i}`, householdId: 'h1', expenseId, memberId: s.memberId, shareAmount: s.shareAmount, deletedAt: null,
    proxyName: s.proxyName ?? null, proxyAmount: s.proxyAmount ?? null, proxyRepaidAt: s.proxyRepaidAt ?? null,
  }))
}

describe('resolveProxyShares / buildSplitShares', () => {
  it('代购按外币占比折成本位币，剩下的同行者平均分，整笔合计等于总额', () => {
    const shares = buildSplitShares(350.55, 'equal', ['bx', 'kn'], 'bx', undefined, { expenseAmount: 13298, lines: LINES })
    const proxy = shares.filter((s) => s.proxyName)
    expect(proxy.map((s) => [s.proxyName, s.shareAmount, s.memberId])).toEqual([['妈妈', 121.26, 'bx'], ['小王', 79.08, 'bx']])
    const travelers = shares.filter((s) => !s.proxyName)
    expect(travelers.reduce((a, s) => a + s.shareAmount, 0)).toBeCloseTo(150.21, 10)
    expect(shares.reduce((a, s) => a + s.shareAmount, 0)).toBeCloseTo(350.55, 10)
  })

  it('整张收据都是帮人买的：零头补给第一行，剩下刚好是 0，不会出现负数', () => {
    const p = resolveProxyShares(100, 3, [{ name: 'A', amount: 1 }, { name: 'B', amount: 1 }, { name: 'C', amount: 1 }])
    expect(p.reduce((a, x) => a + x.shareAmount, 0)).toBeCloseTo(100, 10)
    const shares = buildSplitShares(100, 'equal', ['bx', 'kn'], 'bx', undefined, { expenseAmount: 3, lines: [{ name: 'A', amount: 1 }, { name: 'B', amount: 1 }, { name: 'C', amount: 1 }] })
    expect(shares.filter((s) => !s.proxyName).every((s) => s.shareAmount === 0)).toBe(true)
  })

  it('没填名字或金额的空行忽略；没有代购时跟以前完全一样', () => {
    expect(resolveProxyShares(100, 100, [{ name: '', amount: 0 }])).toEqual([])
    expect(buildSplitShares(100, 'equal', ['a', 'b'], 'a')).toEqual([{ memberId: 'a', shareAmount: 50 }, { memberId: 'b', shareAmount: 50 }])
  })

  it('已还的状态原样带回去，编辑一下账不会把"已还"弄丢', () => {
    const shares = buildSplitShares(350.55, 'equal', ['bx', 'kn'], 'bx', undefined, { expenseAmount: 13298, lines: [{ name: '妈妈', amount: 4600, repaidAt: 123 }] })
    expect(shares.find((s) => s.proxyName === '妈妈')?.proxyRepaidAt).toBe(123)
  })
})

describe('代购不进同行者之间的账（真实走 Dexie）', () => {
  beforeEach(async () => {
    await Promise.all([db.expenses.clear(), db.expenseSplits.clear(), db.settlements.clear(), db.outbox.clear(), db.expenseLineItems.clear(), db.expenseDayAllocations.clear()])
  })

  it('computeBalances：BX 的垫付扣掉代购，KN 只欠剩下那部分的一半；按笔结算里也没有代购', async () => {
    await db.expenses.add(expense())
    await db.expenseSplits.bulkAdd(rows('e1', buildSplitShares(350.55, 'equal', ['bx', 'kn'], 'bx', undefined, { expenseAmount: 13298, lines: LINES })))
    const balances = await computeBalances('t1')
    const bx = balances.find((b) => b.memberId === 'bx')!
    const kn = balances.find((b) => b.memberId === 'kn')!
    expect(bx.paid).toBeCloseTo(150.21, 10)
    expect(bx.owed).toBeCloseTo(75.11, 10)
    expect(kn.owed).toBeCloseTo(75.1, 10)
    expect(kn.net).toBeCloseTo(-75.1, 10)
    const debts = await openExpenseDebts('t1')
    expect(debts.map((d) => [d.debtorId, d.remaining])).toEqual([['kn', 75.1]])
  })

  it('补刷卡实际扣款：代购按实际汇率重算，"已还"保留，剩下的重新平均分，合计等于新金额', async () => {
    await db.expenses.add(expense({ paymentCardId: 'c1', cardChargePending: true }))
    const initial = rows('e1', buildSplitShares(350.55, 'equal', ['bx', 'kn'], 'bx', undefined, {
      expenseAmount: 13298, lines: [{ name: '妈妈', amount: 4600, repaidAt: 999 }, { name: '小王', amount: 3000 }],
    }))
    await db.expenseSplits.bulkAdd(initial)
    await fillCardCharge('e1', 344.2)
    const after = await db.expenseSplits.where('expenseId').equals('e1').toArray()
    expect(after.reduce((a, s) => a + s.shareAmount, 0)).toBeCloseTo(344.2, 10)
    const mama = after.find((s) => s.proxyName === '妈妈')!
    expect(mama.shareAmount).toBeCloseTo(Math.round((344.2 * 4600 / 13298) * 100) / 100, 10)
    expect(mama.proxyRepaidAt).toBe(999)
    expect(after.filter((s) => !s.proxyName).map((s) => s.memberId).sort()).toEqual(['bx', 'kn'])
  })

  it('标已还 / 改回未还：只改这几行，每笔账入队一次整笔分摊推送', async () => {
    await db.expenses.add(expense())
    const r = rows('e1', buildSplitShares(350.55, 'equal', ['bx', 'kn'], 'bx', undefined, { expenseAmount: 13298, lines: LINES }))
    await db.expenseSplits.bulkAdd(r)
    const mamaId = r.find((x) => x.proxyName === '妈妈')!.id
    await setProxyRepaid([mamaId], 555)
    expect((await db.expenseSplits.get(mamaId))?.proxyRepaidAt).toBe(555)
    expect((await db.expenseSplits.get(r.find((x) => x.proxyName === '小王')!.id))?.proxyRepaidAt).toBeNull()
    const pending = (await db.outbox.where('status').equals('pending').toArray()).filter((e) => e.tableName === 'expenseSplits')
    expect(pending.map((e) => e.recordId)).toEqual(['e1'])
    await setProxyRepaid([mamaId], null)
    expect((await db.expenseSplits.get(mamaId))?.proxyRepaidAt).toBeNull()
  })
})

describe('groupProxyItems：按人汇总', () => {
  const e1 = expense({ id: 'e1', expenseDate: '2026-10-23' })
  const e2 = expense({ id: 'e2', expenseDate: '2026-11-02', paidBy: 'kn' })
  const e3 = expense({ id: 'e3', expenseDate: '2026-10-31' })
  const split = (id: string, expenseId: string, name: string, share: number, repaidAt: number | null = null): ExpenseSplit => ({
    id, householdId: 'h1', expenseId, memberId: 'x', shareAmount: share, deletedAt: null, proxyName: name, proxyAmount: 1, proxyRepaidAt: repaidAt,
  })

  it('同一个人跨几天的代购合成一组；钱要还给不同的人时分开；已还的按"哪次标的"分组', () => {
    const items = toProxyItems([e1, e2, e3], [
      split('a', 'e1', '妈妈', 100),
      split('b', 'e3', '妈妈', 50),
      split('c', 'e2', '妈妈', 30),
      split('d', 'e1', '小李', 80, 777),
    ])
    const { unpaid, repaid } = groupProxyItems(items)
    expect(unpaid.map((g) => [g.name, g.creditorId, g.total, g.items.map((i) => i.expenseDate)])).toEqual([
      ['妈妈', 'bx', 150, ['2026-10-23', '2026-10-31']],
      ['妈妈', 'kn', 30, ['2026-11-02']],
    ])
    expect(repaid.map((g) => [g.name, g.total, g.repaidAt])).toEqual([['小李', 80, 777]])
    expect(proxySummary(items)).toEqual({ total: 260, unpaid: 180 })
  })

  it('删掉的账不算', () => {
    const items = toProxyItems([{ ...e1, deletedAt: 1 }], [split('a', 'e1', '妈妈', 100)])
    expect(items).toEqual([])
  })
})
