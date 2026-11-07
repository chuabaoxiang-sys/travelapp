import type { Expense, ExpenseSplit } from '../types'

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

// 旅程回顾「靠优惠省了」：优惠归谁省的就算谁的（2026-11-07）。选了「分给代购的人」
// （proxyDiscountShared）的账，代购那部分的优惠按原价比例是朋友省的，扣掉不算；
// 默认「不分给」时朋友按原价还，优惠落在付款人手里，照全额算
export function discountSummary(expenses: Expense[], splits: Pick<ExpenseSplit, 'expenseId' | 'proxyName' | 'proxyAmount' | 'deletedAt'>[] = []): { total: number; count: number } {
  const withDiscount = expenses.filter((e) => !e.deletedAt && (e.discountAmount ?? 0) > 0)
  const proxyOriginal = new Map<string, number>()
  for (const s of splits) {
    if (s.deletedAt || !s.proxyName) continue
    proxyOriginal.set(s.expenseId, (proxyOriginal.get(s.expenseId) ?? 0) + (s.proxyAmount ?? 0))
  }
  let total = 0
  for (const e of withDiscount) {
    const full = discountInHome(e)
    const listPrice = e.expenseAmount + (e.discountAmount ?? 0)
    const friendsShare = e.proxyDiscountShared && listPrice > 0 ? Math.min(1, (proxyOriginal.get(e.id) ?? 0) / listPrice) : 0
    total += full * (1 - friendsShare)
  }
  return { total: round2(total), count: withDiscount.length }
}
