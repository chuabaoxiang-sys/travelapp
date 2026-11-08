import type { Expense, ExpenseSplit } from '../types'
import { memberSharesOfExpense } from './splits'

// "跟我相关"的账目：我是付款人，或者分摊名单里有我——个人开销也算在内，因为
// resolveSplitShares 对个人开销同样会给付款人自己记一条全额的expense_split，
// 不是只有"大家分摊"才会出现在这个集合里
export function myRelatedExpenseIds(expenses: Expense[], splits: ExpenseSplit[], memberId: string): Set<string> {
  return new Set([
    ...expenses.filter((e) => e.paidBy === memberId).map((e) => e.id),
    ...splits.filter((s) => s.memberId === memberId).map((s) => s.expenseId),
  ])
}

// 这笔账里我自己分摊到多少——找不到时返回undefined，跟"确实分摊为0"区分开，
// 调用方要用这个区分显示"—（你垫付，不分摊给自己）"这种情况
// 代购行（proxyName 非空）的 memberId 也是付款人，但那是帮别人买的，不算"我分摊到的"
// 送礼的代购（0052）分到我头上的也算我的份额
export function myShareOf(
  expenseId: string, splits: ExpenseSplit[], memberId: string,
  expense?: { homeAmount: number; expenseAmount: number; discountAmount?: number | null; proxyDiscountShared?: boolean },
): number | undefined {
  return memberSharesOfExpense(splits.filter((s) => s.expenseId === expenseId), expense).get(memberId)
}
