import { isCardExpense } from './paymentCards'
import { isPendingCardExpense } from './cardCharges'
import type { Expense } from '../types'

// 账目页筛选（2026-11-07）：按分类、按付款方式。同一组里是"或"（餐饮或交通），
// 两组之间是"且"（并且是这张卡刷的）；某一组一个都没选 = 这一组不筛
export const PAY_CASH = 'cash' // 所有不是刷卡的（含直接记本位币的）
export const PAY_PENDING = 'pending' // 刷卡、还没补实际扣款的

export interface LedgerFilter {
  categoryIds: string[]
  payments: string[] // PAY_CASH / PAY_PENDING / 卡的 id
}

export const EMPTY_LEDGER_FILTER: LedgerFilter = { categoryIds: [], payments: [] }

export function isFilterActive(f: LedgerFilter): boolean {
  return f.categoryIds.length > 0 || f.payments.length > 0
}

export function filterCount(f: LedgerFilter): number {
  return f.categoryIds.length + f.payments.length
}

function matchesPayment(e: Expense, payments: string[]): boolean {
  if (!payments.length) return true
  return payments.some((p) => {
    if (p === PAY_CASH) return !isCardExpense(e)
    if (p === PAY_PENDING) return isPendingCardExpense(e)
    return isCardExpense(e) && e.paymentCardId === p
  })
}

export function matchesLedgerFilter(e: Expense, f: LedgerFilter): boolean {
  if (f.categoryIds.length && !f.categoryIds.includes(e.categoryId)) return false
  return matchesPayment(e, f.payments)
}
