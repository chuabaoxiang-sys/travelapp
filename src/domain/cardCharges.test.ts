import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../db/dexie'
import { scaleAmounts, fillCardCharge, isPendingCardExpense, ExpenseSettledError } from './cardCharges'
import type { Expense } from '../types'

vi.mock('./household', () => ({ getCurrentHouseholdId: async () => 'h1', getCachedHouseholdIdSync: () => 'h1' }))

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: 'e1', householdId: 'h1', tripId: 't1', categoryId: 'cat-food', phase: 'during_trip', description: null,
    expenseCurrency: 'JPY', expenseAmount: 12000, rateBookEntryId: null, rateUsed: 0.0294, homeAmount: 352.8,
    paidBy: 'a', recordedBy: 'a', expenseDate: '2026-10-23', itineraryDayId: null, itineraryItemId: null,
    splitType: 'equal', paymentCardId: 'c1', cardChargePending: true, deletedAt: null, createdAt: 0, updatedAt: 0, ...over,
  }
}

async function addSplits(rows: [string, number][]) {
  await db.expenseSplits.bulkAdd(rows.map(([memberId, shareAmount], i) => ({ id: `s${i}`, householdId: 'h1', expenseId: 'e1', memberId, shareAmount, deletedAt: null })))
}

async function sharesOf(expenseId = 'e1') {
  const rows = await db.expenseSplits.where('expenseId').equals(expenseId).toArray()
  return Object.fromEntries(rows.map((r) => [r.memberId, r.shareAmount]))
}

describe('scaleAmounts', () => {
  it('按比例缩放，零头补给第一项，加起来刚好等于新总额', () => {
    const out = scaleAmounts([100, 100, 100], 100)
    expect(out).toEqual([33.34, 33.33, 33.33])
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10)
  })
  it('不均匀的金额保持原来的比例', () => {
    expect(scaleAmounts([200, 100], 33)).toEqual([22, 11])
  })
  it('旧总额是0时退成平均分', () => {
    expect(scaleAmounts([0, 0], 10)).toEqual([5, 5])
  })
})

describe('isPendingCardExpense', () => {
  it('只认没删除、标了待补、而且还是刷卡的', () => {
    expect(isPendingCardExpense(expense())).toBe(true)
    expect(isPendingCardExpense(expense({ cardChargePending: false }))).toBe(false)
    expect(isPendingCardExpense(expense({ deletedAt: 1 }))).toBe(false)
    expect(isPendingCardExpense(expense({ rateBookEntryId: 'r1' }))).toBe(false)
  })
})

describe('fillCardCharge（真实走 Dexie）', () => {
  beforeEach(async () => {
    await Promise.all([
      db.expenses.clear(), db.expenseSplits.clear(), db.expenseLineItems.clear(),
      db.expenseDayAllocations.clear(), db.settlements.clear(), db.outbox.clear(),
    ])
  })

  it('平均分：更新金额/汇率/待补，按原来那几个人重新平均分', async () => {
    await db.expenses.add(expense())
    await addSplits([['a', 117.6], ['b', 117.6], ['c', 117.6]])
    await fillCardCharge('e1', 356.11)
    const e = await db.expenses.get('e1')
    expect(e?.homeAmount).toBe(356.11)
    expect(e?.rateUsed).toBeCloseTo(356.11 / 12000, 10)
    expect(e?.cardChargePending).toBe(false)
    const shares = await sharesOf()
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBeCloseTo(356.11, 10)
    expect(Object.keys(shares).sort()).toEqual(['a', 'b', 'c'])
  })

  it('不分摊：整笔还是付款人的', async () => {
    await db.expenses.add(expense({ splitType: 'none' }))
    await addSplits([['a', 352.8]])
    await fillCardCharge('e1', 360)
    expect(await sharesOf()).toEqual({ a: 360 })
  })

  it('自定义金额：按比例缩放，合计等于新金额', async () => {
    await db.expenses.add(expense({ splitType: 'exact', homeAmount: 300 }))
    await addSplits([['a', 200], ['b', 100]])
    await fillCardCharge('e1', 330)
    expect(await sharesOf()).toEqual({ a: 220, b: 110 })
  })

  it('逐项拆账：份额和子项金额都按比例缩放', async () => {
    await db.expenses.add(expense({ splitType: 'itemized', homeAmount: 300 }))
    await addSplits([['a', 200], ['b', 100]])
    await db.expenseLineItems.bulkAdd([
      { id: 'i1', householdId: 'h1', expenseId: 'e1', name: 'x', amount: 200, orderIndex: 0, deletedAt: null },
      { id: 'i2', householdId: 'h1', expenseId: 'e1', name: 'y', amount: 100, orderIndex: 1, deletedAt: null },
    ])
    await fillCardCharge('e1', 270)
    expect(await sharesOf()).toEqual({ a: 180, b: 90 })
    expect((await db.expenseLineItems.get('i1'))?.amount).toBe(180)
    expect((await db.expenseLineItems.get('i2'))?.amount).toBe(90)
  })

  it('跨天开销：平均分的重新平均，自定义的按比例', async () => {
    await db.expenses.add(expense({ daySpreadMode: 'exact', homeAmount: 300, splitType: 'none' }))
    await addSplits([['a', 300]])
    await db.expenseDayAllocations.bulkAdd([
      { id: 'd1', householdId: 'h1', expenseId: 'e1', tripId: 't1', date: '2026-10-23', amount: 100, deletedAt: null },
      { id: 'd2', householdId: 'h1', expenseId: 'e1', tripId: 't1', date: '2026-10-24', amount: 200, deletedAt: null },
    ])
    await fillCardCharge('e1', 330)
    const days = await db.expenseDayAllocations.where('expenseId').equals('e1').toArray()
    expect(Object.fromEntries(days.map((d) => [d.date, d.amount]))).toEqual({ '2026-10-23': 110, '2026-10-24': 220 })
  })

  it('已经按笔结算过的不能补，什么都不改', async () => {
    await db.expenses.add(expense())
    await addSplits([['a', 352.8]])
    await db.settlements.add({
      id: 'st1', householdId: 'h1', tripId: 't1', fromMemberId: 'b', toMemberId: 'a', amount: 100,
      settledDate: '2026-10-24', note: null, createdBy: null, expenseId: 'e1', isPrepayment: false, deletedAt: null,
    } as never)
    await expect(fillCardCharge('e1', 400)).rejects.toBeInstanceOf(ExpenseSettledError)
    expect((await db.expenses.get('e1'))?.homeAmount).toBe(352.8)
    expect((await db.expenses.get('e1'))?.cardChargePending).toBe(true)
  })
})
