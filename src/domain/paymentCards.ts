import { db } from '../db/dexie'
import { getCurrentHouseholdId } from './household'
import type { Expense, PaymentCard, RateBookEntry } from '../types'

// 刷卡记账用的卡（2026-10-20，见0045迁移）。卡按团队存、所有行程通用，
// 本身没有汇率——每一笔刷卡开销的汇率各自存在 Expense.rateUsed 上

// 这笔是不是"刷卡"的开销。rateBookEntryId/rateSpread 优先：老版本APP编辑一笔
// 刷卡开销时不认识卡，可能把它改成用某批现金汇率，那时候 paymentCardId 还留着，
// 但用户最后一次明确选的是现金，就按现金算
export function isCardExpense(e: Pick<Expense, 'paymentCardId' | 'rateBookEntryId' | 'rateSpread'>): boolean {
  return !!e.paymentCardId && !e.rateBookEntryId && !e.rateSpread
}

// 卡汇率是"RM / 外币"除出来的，日元这类小汇率要多留几位才看得出差别——
// 跟汇率簿综合汇率一样最多7位，去掉尾零
export function formatCardRate(rate: number): string {
  return String(Math.round(rate * 1e7) / 1e7)
}

export async function getPaymentCards(): Promise<PaymentCard[]> {
  const all = await db.paymentCards.toArray()
  return all.sort((a, b) => a.createdAt - b.createdAt)
}

export async function createPaymentCard(name: string, createdBy: string | null): Promise<PaymentCard> {
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('No household found')
  const now = Date.now()
  const card: PaymentCard = {
    id: crypto.randomUUID(),
    householdId,
    name: name.trim(),
    archivedAt: null,
    createdBy,
    createdAt: now,
    updatedAt: now,
  }
  await db.paymentCards.add(card)
  return card
}

export async function renamePaymentCard(id: string, name: string) {
  await db.paymentCards.update(id, { name: name.trim(), updatedAt: Date.now() })
}

export async function archivePaymentCard(id: string) {
  await db.paymentCards.update(id, { archivedAt: Date.now(), updatedAt: Date.now() })
}

export async function unarchivePaymentCard(id: string) {
  await db.paymentCards.update(id, { archivedAt: null, updatedAt: Date.now() })
}

// 这张卡挂了多少笔开销——所有行程一起算，连已删除的开销也算：数据库那边
// 已删除（软删）的开销照样占着外键，硬删卡会被拒绝，这里的判断要跟数据库一致
export async function cardExpenseCount(cardId: string): Promise<number> {
  return db.expenses.filter((e) => e.paymentCardId === cardId).count()
}

// 真正删除——只有一笔开销都没挂过的卡才允许，用过的一律只能停用
export async function deletePaymentCard(id: string) {
  if ((await cardExpenseCount(id)) > 0) throw new Error('Card is used by expenses')
  await db.paymentCards.delete(id)
}

// 刷卡当下还不知道银行扣了多少时，先用哪个汇率估：
//   1. 这张卡上次真实扣款的汇率（同币种、已补好真实扣款的，跨行程都算）
//   2. 这趟这个币种最近用的现金汇率
//   3. 都没有 → null，调用方要求用户填 RM
export function pickEstimateRate(params: {
  cardId: string
  currency: string
  tripId: string
  expenses: Expense[]
  rateEntries: RateBookEntry[]
  excludeExpenseId?: string
}): number | null {
  const { cardId, currency, tripId, expenses, rateEntries, excludeExpenseId } = params
  const lastReal = expenses
    .filter(
      (e) =>
        e.id !== excludeExpenseId &&
        !e.deletedAt &&
        e.paymentCardId === cardId &&
        isCardExpense(e) &&
        !e.cardChargePending &&
        e.expenseCurrency === currency &&
        e.rateUsed > 0,
    )
    .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || b.updatedAt - a.updatedAt)[0]
  if (lastReal) return lastReal.rateUsed
  const cash = rateEntries
    .filter((r) => r.tripId === tripId && r.foreignCurrency === currency && !r.archived && r.rate > 0)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0]
  return cash?.rate ?? null
}

export async function estimateCardRate(cardId: string, currency: string, tripId: string, excludeExpenseId?: string): Promise<number | null> {
  const [expenses, rateEntries] = await Promise.all([
    db.expenses.filter((e) => e.paymentCardId === cardId).toArray(),
    db.rateBookEntries.where('tripId').equals(tripId).toArray(),
  ])
  return pickEstimateRate({ cardId, currency, tripId, expenses, rateEntries, excludeExpenseId })
}

export interface CardTripUsage {
  count: number
  // 这趟只用一个外币时才有意义的平均汇率（总 RM / 总外币）；多个币种就不给
  averageRate: number | null
}

// 汇率簿里每张卡下面那行"这趟刷了 N 笔 · 平均 x"
export async function cardUsageForTrip(tripId: string): Promise<Map<string, CardTripUsage>> {
  const expenses = (await db.expenses.where('tripId').equals(tripId).toArray()).filter((e) => !e.deletedAt && isCardExpense(e))
  const acc = new Map<string, { count: number; home: number; foreign: number; currencies: Set<string> }>()
  for (const e of expenses) {
    const a = acc.get(e.paymentCardId!) ?? { count: 0, home: 0, foreign: 0, currencies: new Set<string>() }
    a.count += 1
    a.home += e.homeAmount
    a.foreign += e.expenseAmount
    a.currencies.add(e.expenseCurrency)
    acc.set(e.paymentCardId!, a)
  }
  const out = new Map<string, CardTripUsage>()
  for (const [id, a] of acc) {
    out.set(id, { count: a.count, averageRate: a.currencies.size === 1 && a.foreign > 0 ? a.home / a.foreign : null })
  }
  return out
}
