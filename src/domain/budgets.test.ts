import { describe, it, expect, beforeEach } from 'vitest'
import { sumSpend, upsertBudget, getOverallBudget, getCategoryBudgets, deleteBudget } from './budgets'
import type { Expense } from '../types'
import { db } from '../db/dexie'

function makeExpense(overrides: Partial<Expense>): Expense {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    tripId: 't1',
    categoryId: 'cat-food',
    phase: 'during_trip',
    description: null,
    expenseCurrency: 'MYR',
    expenseAmount: 100,
    rateBookEntryId: null,
    rateUsed: 1,
    homeAmount: 100,
    paidBy: 'papa',
    recordedBy: 'papa',
    expenseDate: '2026-09-02',
    itineraryDayId: null,
    itineraryItemId: null,
    splitType: 'none',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('sumSpend', () => {
  it('categoryId为null时汇总全部账目', () => {
    const expenses = [makeExpense({ homeAmount: 100 }), makeExpense({ homeAmount: 50, categoryId: 'cat-shop' })]
    expect(sumSpend(expenses, null)).toBe(150)
  })

  it('指定categoryId时只汇总对应分类', () => {
    const expenses = [
      makeExpense({ homeAmount: 100, categoryId: 'cat-food' }),
      makeExpense({ homeAmount: 50, categoryId: 'cat-shop' }),
      makeExpense({ homeAmount: 30, categoryId: 'cat-food' }),
    ]
    expect(sumSpend(expenses, 'cat-food')).toBe(130)
  })

  it('浮点数加总保留两位小数不产生误差', () => {
    const expenses = [makeExpense({ homeAmount: 0.1 }), makeExpense({ homeAmount: 0.2 })]
    expect(sumSpend(expenses, null)).toBe(0.3)
  })

  it('空数组返回0', () => {
    expect(sumSpend([], null)).toBe(0)
  })
})

describe('预算的增删查（真实走Dexie）', () => {
  const tripId = 'trip-budget-test'

  beforeEach(async () => {
    await db.budgets.where('tripId').equals(tripId).delete()
  })

  it('upsertBudget首次调用创建，第二次调用更新同一条而不是新增', async () => {
    const id1 = await upsertBudget({ tripId, categoryId: null, amount: 1000 })
    const overall1 = await getOverallBudget(tripId)
    expect(overall1?.amount).toBe(1000)

    const id2 = await upsertBudget({ tripId, categoryId: null, amount: 1500 })
    expect(id2).toBe(id1) // 同一条记录被更新，不是新增了一条

    const overall2 = await getOverallBudget(tripId)
    expect(overall2?.amount).toBe(1500)
    expect(await db.budgets.where('tripId').equals(tripId).count()).toBe(1)
  })

  it('分类预算和总预算分开查询，互不干扰', async () => {
    await upsertBudget({ tripId, categoryId: null, amount: 2000 })
    await upsertBudget({ tripId, categoryId: 'cat-food', amount: 500 })
    await upsertBudget({ tripId, categoryId: 'cat-shop', amount: 300 })

    const overall = await getOverallBudget(tripId)
    const categoryBudgets = await getCategoryBudgets(tripId)
    expect(overall?.amount).toBe(2000)
    expect(categoryBudgets).toHaveLength(2)
    expect(categoryBudgets.map((b) => b.categoryId).sort()).toEqual(['cat-food', 'cat-shop'])
  })

  it('deleteBudget后查不到该条，其余预算不受影响', async () => {
    const foodId = await upsertBudget({ tripId, categoryId: 'cat-food', amount: 500 })
    await upsertBudget({ tripId, categoryId: 'cat-shop', amount: 300 })

    await deleteBudget(foodId)

    const remaining = await getCategoryBudgets(tripId)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].categoryId).toBe('cat-shop')
  })
})
