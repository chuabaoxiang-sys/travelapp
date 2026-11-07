import type { Expense } from '../types'

// 优惠（2026-11-07）：只记"省了多少"，不参与花费、预算、分摊。优惠按这笔账自己的
// 币种记，折成本位币用"本位币金额 / 外币金额"这个比例现算——刷卡补了实际扣款后
// 自动按实际汇率，不另存一份快照

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export function discountInHome(e: Pick<Expense, 'discountAmount' | 'homeAmount' | 'expenseAmount'>): number {
  const d = e.discountAmount ?? 0
  if (!(d > 0) || !(e.expenseAmount > 0)) return 0
  return round2((d * e.homeAmount) / e.expenseAmount)
}

export function discountSummary(expenses: Expense[]): { total: number; count: number } {
  const withDiscount = expenses.filter((e) => !e.deletedAt && (e.discountAmount ?? 0) > 0)
  return {
    total: round2(withDiscount.reduce((s, e) => s + discountInHome(e), 0)),
    count: withDiscount.length,
  }
}
