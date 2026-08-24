import { db } from '../db/dexie'
import { getCurrentHouseholdId } from './household'
import type { DaySpreadMode, Expense, ExpenseDayAllocation } from '../types'

function round2(n: number) {
  return Math.round(n * 100) / 100
}

// 把一笔跨天开销的总额拆到选中的每一天。刻意跟 resolveSplitShares（按人分摊）
// 保持同样的形状和取舍：平均分时"取整+余数给第一天"，避免几分钱凭空消失；
// 'exact' 时每天多少完全由 customAmounts 决定，调用方负责保证加总等于总额
// （界面上有实时校验，跟自定义分摊给成员那处是同一套提示）。
//
// 日期不要求连续也不要求有序——传进来什么顺序就按什么顺序算，余数给第一项。
// 调用方（AddExpensePage）传的是按日历排好序的日期，所以"第一天"就是最早那天
export function resolveDayShares(
  homeAmount: number,
  mode: DaySpreadMode,
  dates: string[],
  customAmounts?: Record<string, number>,
): { date: string; amount: number }[] {
  if (!dates.length) return []
  if (mode === 'exact' && customAmounts) {
    return dates.map((d) => ({ date: d, amount: round2(customAmounts[d] ?? 0) }))
  }
  const n = dates.length
  const base = Math.floor((homeAmount / n) * 100) / 100
  const remainder = round2(homeAmount - base * n)
  return dates.map((date, i) => ({ date, amount: i === 0 ? round2(base + remainder) : base }))
}

// 保存一笔开销的每日分摊：先清掉旧的（编辑场景），再按新的方式重新写入。
// 跟 saveExpenseSplits 不同，这里不用手动打包 outbox——expenseDayAllocations
// 走 db/dexie.ts 里通用的逐行同步 hook 就够了（没有"总额必须相等"的延迟约束
// 会卡住中间状态），删掉的行也会被 deleting hook 自然带上
export async function saveDayAllocations(
  expenseId: string,
  tripId: string,
  homeAmount: number,
  mode: DaySpreadMode,
  dates: string[],
  customAmounts?: Record<string, number>,
) {
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('未找到所属团队')
  await db.expenseDayAllocations.where('expenseId').equals(expenseId).delete()
  const shares = resolveDayShares(homeAmount, mode, dates, customAmounts)
  if (!shares.length) return
  await db.expenseDayAllocations.bulkAdd(
    shares.map((s) => ({ id: crypto.randomUUID(), householdId, expenseId, tripId, date: s.date, amount: s.amount })),
  )
}

// 一笔开销从"跨多天"改回"单日"、或者整笔被删掉时，把它的每日分摊一起清掉，
// 不然那几天的"当日花费"会一直算着一笔已经不存在的钱
export async function deleteDayAllocations(expenseId: string) {
  await db.expenseDayAllocations.where('expenseId').equals(expenseId).delete()
}

// 每一天实际花了多少：单日开销按 itineraryDayId 归属那一天整笔算，跨天开销
// 按它在这一天分到的金额算。两条路径互斥——有 daySpreadMode 的开销一律不再
// 走 itineraryDayId 那条，否则同一笔钱会被数两次
export function spendByDate(
  expenses: Expense[],
  allocations: ExpenseDayAllocation[],
  itineraryDays: { id: string; date: string }[],
): Map<string, number> {
  const dateOfDay = new Map(itineraryDays.map((d) => [d.id, d.date]))
  const totals = new Map<string, number>()
  const add = (date: string, amount: number) => {
    totals.set(date, round2((totals.get(date) ?? 0) + amount))
  }

  for (const e of expenses) {
    if (e.daySpreadMode) continue
    if (!e.itineraryDayId) continue
    const date = dateOfDay.get(e.itineraryDayId)
    if (date) add(date, e.homeAmount)
  }
  for (const a of allocations) {
    add(a.date, a.amount)
  }
  return totals
}

// 「某一天实际花出去多少钱」——注意这和上面的 spendByDate 是**两个不同的问题**，
// 不能互相替用：
//
//   spendByDate  按 itineraryDayId 归日，回答的是"这一天安排的那些事花了多少"，
//                所以只算显式关联到某个行程日的开销，是行程页那个"当日花费"要的口径。
//   spentOnDate  按 expenseDate 归日，回答的是"这一天从口袋里出去多少钱"，
//                所有开销都算，不管有没有关联行程。
//
// 「今天还能花」要的是后者。用错口径会有一个很隐蔽的后果：关联行程是可选的、
// 大多数账目都没关联，于是"今天已花"几乎永远是 0，额度一整天都显示满的。
// 跨天开销两边都走 allocations，因为那笔钱确实是分几天消耗掉的。
export function spentOnDate(
  expenses: Expense[],
  allocations: ExpenseDayAllocation[],
  dateISO: string,
): number {
  let sum = 0
  for (const e of expenses) {
    if (e.daySpreadMode) continue // 由下面的 allocations 负责，避免重复计
    if (e.expenseDate === dateISO) sum += e.homeAmount
  }
  for (const a of allocations) {
    if (a.date === dateISO) sum += a.amount
  }
  return round2(sum)
}
