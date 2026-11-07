import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../db/dexie'
import { buildSplitShares, resolveProxyShares, computeBalances, openExpenseDebts, expenseListPrice, proxyReceivable, round2 } from './splits'
import { groupProxyItems, proxyGainBreakdown, proxyGainByMember, proxySummary, setProxyGift, setProxyRepaid, toProxyItems } from './proxies'
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
    const shares = buildSplitShares(350.55, 'equal', ['bx', 'kn'], 'bx', undefined, { listPrice: 13298, lines: LINES })
    const proxy = shares.filter((s) => s.proxyName)
    expect(proxy.map((s) => [s.proxyName, s.shareAmount, s.memberId])).toEqual([['妈妈', 121.26, 'bx'], ['小王', 79.08, 'bx']])
    const travelers = shares.filter((s) => !s.proxyName)
    expect(travelers.reduce((a, s) => a + s.shareAmount, 0)).toBeCloseTo(150.21, 10)
    expect(shares.reduce((a, s) => a + s.shareAmount, 0)).toBeCloseTo(350.55, 10)
  })

  it('整张收据都是帮人买的：零头补给第一行，剩下刚好是 0，不会出现负数', () => {
    const p = resolveProxyShares(100, 3, [{ name: 'A', amount: 1 }, { name: 'B', amount: 1 }, { name: 'C', amount: 1 }])
    expect(p.reduce((a, x) => a + x.shareAmount, 0)).toBeCloseTo(100, 10)
    const shares = buildSplitShares(100, 'equal', ['bx', 'kn'], 'bx', undefined, { listPrice: 3, lines: [{ name: 'A', amount: 1 }, { name: 'B', amount: 1 }, { name: 'C', amount: 1 }] })
    expect(shares.filter((s) => !s.proxyName).every((s) => s.shareAmount === 0)).toBe(true)
  })

  it('没填名字或金额的空行忽略；没有代购时跟以前完全一样', () => {
    expect(resolveProxyShares(100, 100, [{ name: '', amount: 0 }])).toEqual([])
    expect(buildSplitShares(100, 'equal', ['a', 'b'], 'a')).toEqual([{ memberId: 'a', shareAmount: 50 }, { memberId: 'b', shareAmount: 50 }])
  })

  it('已还的状态原样带回去，编辑一下账不会把"已还"弄丢', () => {
    const shares = buildSplitShares(350.55, 'equal', ['bx', 'kn'], 'bx', undefined, { listPrice: 13298, lines: [{ name: '妈妈', amount: 4600, repaidAt: 123 }] })
    expect(shares.find((s) => s.proxyName === '妈妈')?.proxyRepaidAt).toBe(123)
  })
})

describe('代购不进同行者之间的账（真实走 Dexie）', () => {
  beforeEach(async () => {
    await Promise.all([db.expenses.clear(), db.expenseSplits.clear(), db.settlements.clear(), db.outbox.clear(), db.expenseLineItems.clear(), db.expenseDayAllocations.clear()])
  })

  it('computeBalances：BX 的垫付扣掉代购，KN 只欠剩下那部分的一半；按笔结算里也没有代购', async () => {
    await db.expenses.add(expense())
    await db.expenseSplits.bulkAdd(rows('e1', buildSplitShares(350.55, 'equal', ['bx', 'kn'], 'bx', undefined, { listPrice: 13298, lines: LINES })))
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
      listPrice: 13298, lines: [{ name: '妈妈', amount: 4600, repaidAt: 999 }, { name: '小王', amount: 3000 }],
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
    const r = rows('e1', buildSplitShares(350.55, 'equal', ['bx', 'kn'], 'bx', undefined, { listPrice: 13298, lines: LINES }))
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

describe('代购遇到优惠（0050）', () => {
  // 原价 ¥16,000、优惠 ¥2,000、实付 ¥14,000 = RM374.59；妈妈的东西原价 ¥15,000
  const e = { id: 'x', homeAmount: 374.59, expenseAmount: 14000, discountAmount: 2000, proxyDiscountShared: false }
  const shares = buildSplitShares(374.59, 'equal', ['bx', 'kn'], 'bx', undefined, { listPrice: expenseListPrice(e), lines: [{ name: '妈妈', amount: 15000 }] })
  const proxyRow = shares.find((s) => s.proxyName)!

  it('cost is pro-rata on the list price, travelers split their own part at the discounted price', () => {
    expect(proxyRow.shareAmount).toBe(351.18)
    expect(round2(shares.filter((s) => !s.proxyName).reduce((a, s) => a + s.shareAmount, 0))).toBe(23.41)
  })
  it('not shared: the friend repays the list price; shared: the discounted cost', () => {
    expect(proxyReceivable(proxyRow, e)).toBe(401.35)
    expect(proxyReceivable(proxyRow, { ...e, proxyDiscountShared: true })).toBe(351.18)
    expect(proxyReceivable(proxyRow, { ...e, discountAmount: null })).toBe(351.18)
  })
  it('payer keeps the difference', () => {
    const items = toProxyItems([{ ...e, paidBy: 'bx', deletedAt: null, expenseDate: '2026-11-04', description: null, expenseCurrency: 'JPY' } as unknown as Expense],
      [{ id: 's1', expenseId: 'x', memberId: 'bx', shareAmount: proxyRow.shareAmount, proxyName: '妈妈', proxyAmount: 15000 } as ExpenseSplit])
    expect(proxyGainByMember(items).get('bx')).toBe(50.17)
    expect(proxySummary(items).total).toBe(401.35)
  })
})

describe('proxyGainBreakdown', () => {
  const mk = (id: string, expenseId: string, date: string, name: string, receivable: number, cost: number, creditorId = 'bx') => ({
    splitId: id, name, expenseId, expenseDate: date, description: expenseId, currency: 'JPY', amount: 1000,
    shareAmount: receivable, costAmount: cost, creditorId, repaidAt: null, repaidAmount: null, giftMemberIds: null, received: receivable,
  })
  it('按账目分组、按日期排，只列多收 > 0、只列这个付款人的', () => {
    const groups = proxyGainBreakdown([
      mk('1', 'b', '2026-10-30', '妈妈', 82.16, 74.31),
      mk('2', 'a', '2026-10-25', 'Chi En', 195.33, 170.44),
      mk('3', 'a', '2026-10-25', 'Michelle', 149.84, 130.75),
      mk('4', 'c', '2026-10-26', '小王', 50, 50),
      mk('5', 'd', '2026-10-27', '阿姨', 60, 50, 'kn'),
    ], 'bx')
    expect(groups.map((g) => g.expenseId)).toEqual(['a', 'b'])
    expect(groups[0].total).toBe(43.98)
    expect(groups[0].rows.map((r) => r.gain)).toEqual([24.89, 19.09])
  })
})

describe('代购结算选项（0052，真实走 Dexie）', () => {
  beforeEach(async () => {
    await Promise.all([db.expenses.clear(), db.expenseSplits.clear(), db.settlements.clear(), db.outbox.clear()])
  })
  // Mega Donki ¥13,298 = RM350.55；妈妈 ¥4,600 → RM121.26、小王 ¥3,000 → RM79.08，剩下 RM150.21 两人平分
  async function seed() {
    await db.expenses.add(expense())
    await db.expenseSplits.bulkAdd(rows('e1', buildSplitShares(350.55, 'equal', ['bx', 'kn'], 'bx', undefined, { listPrice: 13298, lines: LINES })))
  }
  const proxyIds = async () => (await db.expenseSplits.toArray()).filter((s) => s.proxyName).map((s) => s.id)

  it('实际还得多：多出来的算付款人多收；少还：算付款人少收（负数）', async () => {
    await seed()
    const [mama] = (await db.expenseSplits.toArray()).filter((s) => s.proxyName === '妈妈')
    await setProxyRepaid([mama.id], 1, 130)
    let items = toProxyItems(await db.expenses.toArray(), await db.expenseSplits.toArray())
    expect(items.find((i) => i.name === '妈妈')!.received).toBe(130)
    expect(proxyGainByMember(items).get('bx')).toBe(round2(130 - mama.shareAmount))
    await setProxyRepaid([mama.id], 1, 100)
    items = toProxyItems(await db.expenses.toArray(), await db.expenseSplits.toArray())
    expect(proxyGainByMember(items).get('bx')).toBe(round2(100 - mama.shareAmount))
    // 撤销：实际金额一起清掉
    await setProxyRepaid([mama.id], null)
    expect((await db.expenseSplits.get(mama.id))!.proxyRepaidAmount).toBeNull()
  })

  it('一个人好几行一起标已还：实际总额按该还比例摊，合计刚好', async () => {
    await seed()
    const ids = await proxyIds()
    await setProxyRepaid(ids, 1, 200)
    const amounts = (await db.expenseSplits.toArray()).filter((s) => s.proxyName).map((s) => s.proxyRepaidAmount ?? 0)
    expect(round2(amounts.reduce((a, b) => a + b, 0))).toBe(200)
  })

  it('送给妈妈：成本由 BX、KN 平分，进结算；不再算"收回"', async () => {
    await seed()
    const [mama] = (await db.expenseSplits.toArray()).filter((s) => s.proxyName === '妈妈')
    const before = await computeBalances('t1')
    await setProxyGift([mama.id], ['bx', 'kn'])
    const after = await computeBalances('t1')
    const kn0 = before.find((b) => b.memberId === 'kn')!
    const kn1 = after.find((b) => b.memberId === 'kn')!
    expect(round2(kn1.owed - kn0.owed)).toBe(round2(mama.shareAmount / 2))
    const bx1 = after.find((b) => b.memberId === 'bx')!
    expect(round2(bx1.paid - before.find((b) => b.memberId === 'bx')!.paid)).toBe(mama.shareAmount)
    const items = toProxyItems(await db.expenses.toArray(), await db.expenseSplits.toArray())
    expect(groupProxyItems(items).gifted.map((g) => g.name)).toEqual(['妈妈'])
    expect(proxySummary(items).total).toBe(items.find((i) => i.name === '小王')!.shareAmount)
    const debts = await openExpenseDebts('t1')
    expect(debts.find((d) => d.debtorId === 'kn')!.totalShare).toBe(round2(75.1 + mama.shareAmount / 2))
    await setProxyGift([mama.id], null)
    expect((await computeBalances('t1')).find((b) => b.memberId === 'kn')!.owed).toBe(kn0.owed)
  })
})
