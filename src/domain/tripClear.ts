import { db } from '../db/dexie'
import { computeBalances, simplifyDebts, round2 } from './splits'
import { isPendingCardExpense } from './cardCharges'
import { toProxyItems } from './proxies'
import { categoryBreakdown } from './spendBreakdown'
import { daysInclusive } from '../lib/dates'
import type { Expense, ExpenseSplit, TaxRefund } from '../types'

// 旅程通关（2026-11-12，用户定的）：回家后的收尾分四关，全部由 App 自动判断，不用手动打勾：
//   补完刷卡扣款 → 退税到账 → 代购收齐 → 结算两清
// - 没有刷卡 / 退税 / 代购的行程，那几关直接算过；一个人的行程没有「结算两清」这一关
// - 不锁账：通关状态永远跟着实际数据走，改账后不再两清就自动收回
// - 翻卡盖章不算条件，全部盖完是通关卡上的加分标记
// - 通关卡上不写任何金额（发出去不暴露花了多少）

export type ClearCheckKey = 'cards' | 'refunds' | 'proxies' | 'settle'

export interface ClearCheck {
  key: ClearCheckKey
  done: boolean
  count: number // 还差几笔 / 几个人 / 几次转账
  amount: number // 还差的本位币合计（卡扣款没有金额，记 0）
}

export interface TripClearState {
  checks: ClearCheck[]
  cleared: boolean
  doneCount: number
}

// 纯函数，方便测：拿到这趟的账、分摊、退税、结算建议，判断四关
export function evaluateTripClear(input: {
  expenses: Expense[]
  splits: ExpenseSplit[]
  refunds: TaxRefund[]
  transfers: { amount: number }[]
  memberCount: number
}): TripClearState {
  const pendingCards = input.expenses.filter((e) => !e.deletedAt && isPendingCardExpense(e))
  const pendingRefunds = input.refunds.filter((r) => !r.deletedAt && r.pending)
  const unpaidProxies = toProxyItems(input.expenses, input.splits).filter((it) => !it.repaidAt && !it.giftMemberIds?.length)
  const unpaidNames = new Set(unpaidProxies.map((it) => it.name))

  const checks: ClearCheck[] = [
    { key: 'cards', done: pendingCards.length === 0, count: pendingCards.length, amount: 0 },
    {
      key: 'refunds', done: pendingRefunds.length === 0, count: pendingRefunds.length,
      amount: round2(pendingRefunds.reduce((s, r) => s + r.homeAmount, 0)),
    },
    {
      key: 'proxies', done: unpaidNames.size === 0, count: unpaidNames.size,
      amount: round2(unpaidProxies.reduce((s, it) => s + it.shareAmount, 0)),
    },
  ]
  if (input.memberCount > 1) {
    checks.push({
      key: 'settle', done: input.transfers.length === 0, count: input.transfers.length,
      amount: round2(input.transfers.reduce((s, x) => s + x.amount, 0)),
    })
  }
  const doneCount = checks.filter((c) => c.done).length
  return { checks, cleared: doneCount === checks.length, doneCount }
}

export async function tripClearState(tripId: string): Promise<TripClearState> {
  const expenses = (await db.expenses.where('tripId').equals(tripId).toArray()).filter((e) => !e.deletedAt)
  const splits = expenses.length
    ? (await db.expenseSplits.where('expenseId').anyOf(expenses.map((e) => e.id)).toArray()).filter((s) => !s.deletedAt)
    : []
  const refunds = (await db.taxRefunds.where('tripId').equals(tripId).toArray()).filter((r) => !r.deletedAt)
  const balances = await computeBalances(tripId)
  const memberCount = balances.filter((b) => b.paid > 0 || b.owed > 0).length
  return evaluateTripClear({ expenses, splits, refunds, transfers: simplifyDebts(balances), memberCount })
}

// 通关卡上的内容：天数、人数、笔数、去了几个地方、花最多的一类（只给比例）、最值的一笔、
// 有没有每一天都翻卡盖了章。都不带金额
export interface ClearCardData {
  dayCount: number
  memberCount: number
  expenseCount: number
  placeCount: number
  topCategoryId: string | null
  topCategoryPct: number
  mostWorth: string | null // 最值的一笔：标「值」的人最多的那笔（同票取金额大的）的备注
  allDaysStamped: boolean
}

export async function clearCardData(tripId: string): Promise<ClearCardData> {
  const trip = await db.trips.get(tripId)
  const expenses = (await db.expenses.where('tripId').equals(tripId).toArray()).filter((e) => !e.deletedAt)
  const items = (await db.itineraryItems.where('tripId').equals(tripId).toArray()).filter((i) => !i.deletedAt)
  const balances = await computeBalances(tripId)
  const members = balances.filter((b) => b.paid > 0 || b.owed > 0).map((b) => b.memberId)

  const rows = categoryBreakdown(expenses, [], 'trip', '')
  const total = rows.reduce((s, r) => s + r.total, 0)

  const worthVotes = new Map<string, number>()
  for (const s of await db.expenseSatisfactions.where('tripId').equals(tripId).toArray()) {
    if (s.deletedAt || s.rating !== 'worth') continue
    worthVotes.set(s.expenseId, (worthVotes.get(s.expenseId) ?? 0) + 1)
  }
  let mostWorth: Expense | null = null
  for (const e of expenses) {
    const v = worthVotes.get(e.id) ?? 0
    if (!v) continue
    const best = mostWorth ? worthVotes.get(mostWorth.id) ?? 0 : 0
    if (!mostWorth || v > best || (v === best && e.homeAmount > mostWorth.homeAmount)) mostWorth = e
  }

  // 每一天都翻卡盖了章：行程里每一天，每个一起去的人都给了评价（跳过不算）
  const days = (await db.itineraryDays.where('tripId').equals(tripId).toArray()).filter(
    (d) => !d.deletedAt && (!trip?.startDate || d.date >= trip.startDate) && (!trip?.endDate || d.date <= trip.endDate),
  )
  const rated = new Set(
    (await db.daySatisfactions.where('tripId').equals(tripId).toArray())
      .filter((s) => !s.deletedAt && s.rating)
      .map((s) => `${s.dayId}:${s.memberId}`),
  )
  const allDaysStamped = days.length > 0 && members.length > 0 && days.every((d) => members.every((m) => rated.has(`${d.id}:${m}`)))

  return {
    dayCount: trip?.startDate && trip?.endDate ? daysInclusive(trip.startDate, trip.endDate) : new Set(expenses.map((e) => e.expenseDate)).size,
    memberCount: members.length,
    expenseCount: expenses.length,
    placeCount: items.filter((i) => !!i.locationName).length,
    topCategoryId: rows[0]?.categoryId ?? null,
    topCategoryPct: total > 0 && rows[0] ? (rows[0].total / total) * 100 : 0,
    mostWorth: mostWorth ? mostWorth.description ?? null : null,
    allDaysStamped,
  }
}
