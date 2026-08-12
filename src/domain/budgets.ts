import { db } from '../db/dexie'
import { getCurrentHouseholdId } from './household'
import type { Budget, Expense, ExpensePhase } from '../types'

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export async function getOverallBudget(tripId: string): Promise<Budget | undefined> {
  return db.budgets.where({ tripId }).filter((b) => b.categoryId === null).first()
}

export async function getCategoryBudgets(tripId: string): Promise<Budget[]> {
  const all = await db.budgets.where('tripId').equals(tripId).toArray()
  return all.filter((b) => b.categoryId !== null)
}

export async function upsertBudget(params: {
  tripId: string
  categoryId: string | null
  phase?: ExpensePhase | null
  amount: number
  alertThresholdPct?: number
}) {
  const existing = await db.budgets
    .where('tripId')
    .equals(params.tripId)
    .filter((b) => b.categoryId === params.categoryId)
    .first()
  if (existing) {
    await db.budgets.update(existing.id, { amount: params.amount, alertThresholdPct: params.alertThresholdPct ?? existing.alertThresholdPct })
    return existing.id
  }
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('未找到所属团队')
  const id = crypto.randomUUID()
  const budget: Budget = {
    id,
    householdId,
    tripId: params.tripId,
    categoryId: params.categoryId,
    phase: params.phase ?? null,
    amount: params.amount,
    alertThresholdPct: params.alertThresholdPct ?? 90,
  }
  await db.budgets.add(budget)
  return id
}

export async function deleteBudget(id: string) {
  await db.budgets.delete(id)
}

// 超支判断：这个函数只做纯计算，不查库——调用方（BudgetTab）已经把 expenses 查出来了，
// 不需要每算一次都重新打一次 Dexie
export function sumSpend(expenses: Expense[], categoryId: string | null) {
  const filtered = categoryId === null ? expenses : expenses.filter((e) => e.categoryId === categoryId)
  return round2(filtered.reduce((a, e) => a + e.homeAmount, 0))
}
