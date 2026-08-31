import type { Expense, ExpenseDayAllocation } from '../types'

export interface CategorySpend {
  categoryId: string
  total: number
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

// 按分类汇总花了多少。"今天"要跟SpendHero/spentOnDate用同一套口径（按
// expenseDate归日，跨天开销按分摊入账）——不能自己另外发明一套"今天"算法，
// 不然这张图表的"今天"跟大数字卡的"今天"对不上，APP会显得自相矛盾
export function categoryBreakdown(
  expenses: Expense[],
  allocations: ExpenseDayAllocation[],
  mode: 'trip' | 'today',
  todayISO: string,
): CategorySpend[] {
  const totals = new Map<string, number>()
  const add = (categoryId: string, amount: number) => {
    totals.set(categoryId, round2((totals.get(categoryId) ?? 0) + amount))
  }
  const categoryOfExpense = new Map(expenses.map((e) => [e.id, e.categoryId]))

  if (mode === 'trip') {
    for (const e of expenses) add(e.categoryId, e.homeAmount)
  } else {
    for (const e of expenses) {
      if (e.daySpreadMode) continue // 由下面的allocations负责，避免重复计——跟spentOnDate同一个理由
      if (e.expenseDate === todayISO) add(e.categoryId, e.homeAmount)
    }
    for (const a of allocations) {
      if (a.date !== todayISO) continue
      const categoryId = categoryOfExpense.get(a.expenseId)
      if (categoryId) add(categoryId, a.amount)
    }
  }

  return Array.from(totals.entries())
    .map(([categoryId, total]) => ({ categoryId, total }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
}
