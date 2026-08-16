import { describe, it, expect } from 'vitest'
import { myRelatedExpenseIds, myShareOf } from './expenses'
import type { Expense, ExpenseSplit } from '../types'

function expense(id: string, paidBy: string): Expense {
  return {
    id, householdId: 'h1', tripId: 't1', categoryId: 'cat-food', phase: 'during_trip', description: null,
    expenseCurrency: 'MYR', expenseAmount: 100, rateBookEntryId: null, rateUsed: 1, homeAmount: 100,
    paidBy, recordedBy: paidBy, expenseDate: '2026-09-02', itineraryDayId: null, itineraryItemId: null,
    splitType: 'equal', createdAt: 0, updatedAt: 0,
  }
}

function split(expenseId: string, memberId: string, shareAmount: number): ExpenseSplit {
  return { id: `${expenseId}-${memberId}`, householdId: 'h1', expenseId, memberId, shareAmount }
}

describe('myRelatedExpenseIds', () => {
  it('付款人本人算相关，即使分摊名单里没有他（比如全额记给别人的那种）', () => {
    const expenses = [expense('e1', 'papa')]
    const splits = [split('e1', 'kn', 100)]
    expect(myRelatedExpenseIds(expenses, splits, 'papa')).toEqual(new Set(['e1']))
  })

  it('分摊名单里有他，即使他不是付款人，也算相关', () => {
    const expenses = [expense('e1', 'papa')]
    const splits = [split('e1', 'papa', 50), split('e1', 'mama', 50)]
    expect(myRelatedExpenseIds(expenses, splits, 'mama')).toEqual(new Set(['e1']))
  })

  it('自己的个人开销（splitType=none也会生成一条全额split）同样算相关', () => {
    const expenses = [expense('e1', 'aming')]
    const splits = [split('e1', 'aming', 100)]
    expect(myRelatedExpenseIds(expenses, splits, 'aming')).toEqual(new Set(['e1']))
  })

  it('跟他完全无关的账目（既不是付款人也不在分摊名单）不算', () => {
    const expenses = [expense('e1', 'papa')]
    const splits = [split('e1', 'mama', 100)]
    expect(myRelatedExpenseIds(expenses, splits, 'aming')).toEqual(new Set())
  })

  it('多笔账目混合场景，只挑出跟他相关的那些', () => {
    const expenses = [expense('e1', 'papa'), expense('e2', 'mama'), expense('e3', 'aming')]
    const splits = [split('e1', 'mama', 50), split('e2', 'aming', 90)]
    expect(myRelatedExpenseIds(expenses, splits, 'aming')).toEqual(new Set(['e2', 'e3']))
  })
})

describe('myShareOf', () => {
  it('付款人不分摊给自己时，返回undefined（跟"分摊为0"要区分开）', () => {
    const splits = [split('e1', 'kn', 100)]
    expect(myShareOf('e1', splits, 'papa')).toBeUndefined()
  })

  it('分摊名单里有对应记录时，返回真实的分摊金额，哪怕是0', () => {
    const splits = [split('e1', 'kn', 0)]
    expect(myShareOf('e1', splits, 'kn')).toBe(0)
  })

  it('分摊金额是正常数值时正确返回', () => {
    const splits = [split('e1', 'papa', 50), split('e1', 'mama', 50)]
    expect(myShareOf('e1', splits, 'mama')).toBe(50)
  })
})
