import { describe, it, expect } from 'vitest'
import { categoryBreakdown } from './spendBreakdown'
import type { Expense, ExpenseDayAllocation } from '../types'

function expense(id: string, categoryId: string, homeAmount: number, expenseDate: string, daySpreadMode: Expense['daySpreadMode'] = null): Expense {
  return {
    id, householdId: 'h1', tripId: 't1', categoryId, phase: 'during_trip', description: null,
    expenseCurrency: 'MYR', expenseAmount: homeAmount, rateBookEntryId: null, rateUsed: 1, homeAmount,
    paidBy: 'papa', recordedBy: 'papa', expenseDate, itineraryDayId: null, itineraryItemId: null,
    splitType: 'equal', daySpreadMode, createdAt: 0, updatedAt: 0,
  }
}

function allocation(expenseId: string, date: string, amount: number): ExpenseDayAllocation {
  return { id: `${expenseId}-${date}`, householdId: 'h1', expenseId, tripId: 't1', date, amount }
}

describe('categoryBreakdown', () => {
  it('trip模式：按分类直接加总所有账目，不管日期', () => {
    const expenses = [
      expense('e1', 'cat-food', 100, '2026-09-01'),
      expense('e2', 'cat-food', 50, '2026-09-03'),
      expense('e3', 'cat-transport', 80, '2026-09-02'),
    ]
    const result = categoryBreakdown(expenses, [], 'trip', '2026-09-02')
    expect(result).toEqual([
      { categoryId: 'cat-food', total: 150 },
      { categoryId: 'cat-transport', total: 80 },
    ])
  })

  it('today模式：只算expenseDate等于今天的普通账目', () => {
    const expenses = [
      expense('e1', 'cat-food', 100, '2026-09-02'),
      expense('e2', 'cat-food', 999, '2026-09-01'), // 不是今天，不算
    ]
    const result = categoryBreakdown(expenses, [], 'today', '2026-09-02')
    expect(result).toEqual([{ categoryId: 'cat-food', total: 100 }])
  })

  it('today模式：跨天开销跳过expenseDate判断，只按allocations里今天分到的金额算——不能两边都算，会重复计', () => {
    const expenses = [expense('e1', 'cat-stay', 300, '2026-09-01', 'equal')]
    const allocations = [
      allocation('e1', '2026-09-01', 100),
      allocation('e1', '2026-09-02', 100),
      allocation('e1', '2026-09-03', 100),
    ]
    const result = categoryBreakdown(expenses, allocations, 'today', '2026-09-02')
    expect(result).toEqual([{ categoryId: 'cat-stay', total: 100 }])
  })

  it('结果按金额从大到小排序', () => {
    const expenses = [
      expense('e1', 'cat-misc', 10, '2026-09-02'),
      expense('e2', 'cat-food', 500, '2026-09-02'),
      expense('e3', 'cat-transport', 200, '2026-09-02'),
    ]
    const result = categoryBreakdown(expenses, [], 'trip', '2026-09-02')
    expect(result.map((r) => r.categoryId)).toEqual(['cat-food', 'cat-transport', 'cat-misc'])
  })

  it('金额为0或没有任何账目的分类不出现在结果里', () => {
    const expenses = [expense('e1', 'cat-food', 0, '2026-09-02')]
    expect(categoryBreakdown(expenses, [], 'trip', '2026-09-02')).toEqual([])
  })

  it('today模式没有任何今天的账目时返回空数组', () => {
    const expenses = [expense('e1', 'cat-food', 100, '2026-09-01')]
    expect(categoryBreakdown(expenses, [], 'today', '2026-09-02')).toEqual([])
  })
})
