import { db } from '../db/dexie'
import { getCurrentHouseholdId } from './household'
import { isCardExpense } from './paymentCards'
import type { CardCashback, Expense } from '../types'

// 刷卡返现（2026-11-07，0048）。用户定下的规则：
// - 返现算"归谁"那个人的（卡主），不影响同行者之间的结算，只让他这趟的
//   "我的花费"少这么多
// - "这趟已花"和预算照账面算，旁边另列"Cashback · 实际"
// - 按卡记一笔返现（可以好几笔）；卡设了返现比例就按这趟刷卡总额帮忙估一个数

function round2(n: number) {
  return Math.round(n * 100) / 100
}

// 这趟用这张卡付了多少本位币（含还没补实际扣款、按估算记的）
export function cardTripSpend(expenses: Expense[], cardId: string): number {
  return round2(expenses.filter((e) => !e.deletedAt && isCardExpense(e) && e.paymentCardId === cardId).reduce((s, e) => s + e.homeAmount, 0))
}

export function estimateCashback(spend: number, percent: number | null | undefined): number | null {
  if (!percent || !(percent > 0) || !(spend > 0)) return null
  return round2((spend * percent) / 100)
}

// "归谁"的默认值：这趟用这张卡付钱（按金额）最多的人；没用过就是当前成员
export function defaultCashbackOwner(expenses: Expense[], cardId: string, fallback: string): string {
  const byPayer = new Map<string, number>()
  for (const e of expenses) {
    if (e.deletedAt || !isCardExpense(e) || e.paymentCardId !== cardId) continue
    byPayer.set(e.paidBy, (byPayer.get(e.paidBy) ?? 0) + e.homeAmount)
  }
  let best = fallback
  let bestAmount = -1
  for (const [payer, amount] of byPayer) {
    if (amount > bestAmount) { best = payer; bestAmount = amount }
  }
  return best
}

export function cashbackSummary(cashbacks: CardCashback[]): { total: number; byMember: Map<string, number> } {
  const live = cashbacks.filter((c) => !c.deletedAt)
  const byMember = new Map<string, number>()
  for (const c of live) byMember.set(c.memberId, round2((byMember.get(c.memberId) ?? 0) + c.amount))
  return { total: round2(live.reduce((s, c) => s + c.amount, 0)), byMember }
}

// 实际花费（2026-11-07 口径统一）：这趟已花 − 代购（朋友会还） − 全部返现。
// 黑卡「实际花费」那一行和展开的算式都用这一个数，不再各算各的
export function actualSpend(total: number, proxyTotal: number, cashbackTotal: number): number {
  return round2(Math.max(0, total - proxyTotal - cashbackTotal))
}

export async function listTripCashbacks(tripId: string): Promise<CardCashback[]> {
  return (await db.cardCashbacks.where('tripId').equals(tripId).toArray()).filter((c) => !c.deletedAt)
}

export async function addCashback(input: { tripId: string; paymentCardId: string; memberId: string; amount: number; note: string | null; createdBy: string | null }) {
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('No household found')
  const now = Date.now()
  await db.cardCashbacks.add({
    id: crypto.randomUUID(),
    householdId,
    tripId: input.tripId,
    paymentCardId: input.paymentCardId,
    memberId: input.memberId,
    amount: round2(input.amount),
    note: input.note?.trim() || null,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
}

export async function updateCashback(id: string, patch: { memberId: string; amount: number; note: string | null }) {
  await db.cardCashbacks.update(id, { memberId: patch.memberId, amount: round2(patch.amount), note: patch.note?.trim() || null, updatedAt: Date.now() })
}

// 返现记录没有别的数据挂在它下面，删就是真删（hook 会把删除同步上去）
export async function deleteCashback(id: string) {
  await db.cardCashbacks.delete(id)
}

export async function setCardCashbackPercent(cardId: string, percent: number | null) {
  await db.paymentCards.update(cardId, { cashbackPercent: percent && percent > 0 ? round2(percent) : null, updatedAt: Date.now() })
}
