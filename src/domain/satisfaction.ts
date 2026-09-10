import { db } from '../db/dexie'
import { getCurrentHouseholdId } from './household'
import type { SatisfactionRating, ItineraryDay } from '../types'

// "值/一般/后悔"标记——每个成员对同一天/同一笔账目各自独立打一份，互不覆盖。
// day 和 expense 的"跳过"语义不一样（真机测试才发现两者不能共用同一套null
// 处理逻辑，见 types/index.ts 里 DaySatisfaction.rating 上的详细说明）：
// day 的"跳过"要在数据库里留一行 rating=null，用来把这天从"待翻"队列里
// 移出去，不然一张从没打过分的卡片点"跳过"会原地卡住、翻不过去；expense
// 没有"待翻队列"这种东西，随时可以点"+"重新标，"跳过"（清除我的标记）
// 就是删掉那一行，回到"从没标记过"的样子最直接。两张表形状一样却各自
// 写一遍，也是因为这层null语义不同，硬抽象成一个共用函数反而会把这个
// 关键差异藏起来

async function upsertDaySatisfaction(tripId: string, dayId: string, memberId: string, rating: SatisfactionRating | null) {
  const existing = await db.daySatisfactions.where('[dayId+memberId]').equals([dayId, memberId]).first()
  if (existing) {
    await db.daySatisfactions.update(existing.id, { rating, updatedAt: Date.now() })
    return
  }
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('No household found')
  await db.daySatisfactions.add({
    id: crypto.randomUUID(),
    householdId,
    tripId,
    dayId,
    memberId,
    rating,
    deletedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
}

async function upsertExpenseSatisfaction(tripId: string, expenseId: string, memberId: string, rating: SatisfactionRating | null) {
  const existing = await db.expenseSatisfactions.where('[expenseId+memberId]').equals([expenseId, memberId]).first()
  if (rating === null) {
    if (existing) await db.expenseSatisfactions.delete(existing.id)
    return
  }
  if (existing) {
    await db.expenseSatisfactions.update(existing.id, { rating, updatedAt: Date.now() })
    return
  }
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('No household found')
  await db.expenseSatisfactions.add({
    id: crypto.randomUUID(),
    householdId,
    tripId,
    expenseId,
    memberId,
    rating,
    deletedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
}

export const setDaySatisfaction = upsertDaySatisfaction
export const setExpenseSatisfaction = upsertExpenseSatisfaction

// 翻卡片用：这个成员还没打过分、日期已经过去（含今天）的那些天，按日期从早到晚排。
// 未来的天直接不在这个列表里——不是"锁住但看得到"，是压根不出现，翻完就是翻完了
export async function pendingDaysForMember(tripId: string, memberId: string, todayISO: string): Promise<ItineraryDay[]> {
  const days = await db.itineraryDays.where('tripId').equals(tripId).filter((d) => d.date <= todayISO && !d.deletedAt).sortBy('date')
  const rated = await db.daySatisfactions.where('tripId').equals(tripId).filter((s) => s.memberId === memberId && !s.deletedAt).toArray()
  const ratedDayIds = new Set(rated.map((r) => r.dayId))
  return days.filter((d) => !ratedDayIds.has(d.id))
}

// 多数决：这天选"值"的人多就算"值"。平票时按 worth > regret > neutral 的优先级
// 兜底——一般本来就是最没有信息量的选项，平票时优先展示更有态度的那个结果
export function majorityRating(ratings: SatisfactionRating[]): SatisfactionRating | null {
  if (ratings.length === 0) return null
  const counts: Record<SatisfactionRating, number> = { worth: 0, neutral: 0, regret: 0 }
  for (const r of ratings) counts[r]++
  const max = Math.max(counts.worth, counts.neutral, counts.regret)
  if (counts.worth === max) return 'worth'
  if (counts.regret === max) return 'regret'
  return 'neutral'
}

export interface DayMoodPoint {
  date: string
  title: string | null
  rating: SatisfactionRating | null
}

// 回顾页心情曲线的数据源。view='me' 只看当前成员自己的打分，view='all'
// 每天用多数决合并所有人的打分。没人打过分的那天 rating 是 null，UI 只连接
// 有值的点，不会为了凑一条完整的线瞎编数据
export async function dayMoodCurve(tripId: string, view: { kind: 'me'; memberId: string } | { kind: 'all' }): Promise<DayMoodPoint[]> {
  const days = (await db.itineraryDays.where('tripId').equals(tripId).sortBy('date')).filter((d) => !d.deletedAt)
  const allRatings = (await db.daySatisfactions.where('tripId').equals(tripId).toArray()).filter((r) => !r.deletedAt)
  const byDay = new Map<string, SatisfactionRating[]>()
  for (const r of allRatings) {
    if (r.rating === null) continue // 跳过=这行只用来退出待翻队列，不算一次表态，不进曲线/多数决
    if (view.kind === 'me' && r.memberId !== view.memberId) continue
    const list = byDay.get(r.dayId) ?? []
    list.push(r.rating)
    byDay.set(r.dayId, list)
  }
  return days.map((d) => {
    const ratings = byDay.get(d.id) ?? []
    const rating = view.kind === 'me' ? (ratings[0] ?? null) : majorityRating(ratings)
    return { date: d.date, title: d.title, rating }
  })
}

export interface ExpenseSatisfactionStat {
  taggedCount: number
  worthCount: number
}

// 回顾页账目那句文字统计。view='me' 只数当前成员自己标过的那些，view='all'
// 数全家所有人标过的次数（同一笔账目被2个人标，算2次——这是"大家的态度"的
// 汇总，不是"这笔账目最终算不算值"的裁决，跟"天"的多数决是两种不同的呈现）
export async function expenseSatisfactionStat(tripId: string, view: { kind: 'me'; memberId: string } | { kind: 'all' }): Promise<ExpenseSatisfactionStat> {
  const all = (await db.expenseSatisfactions.where('tripId').equals(tripId).toArray()).filter((s) => !s.deletedAt)
  const filtered = view.kind === 'me' ? all.filter((s) => s.memberId === view.memberId) : all
  return {
    taggedCount: filtered.length,
    worthCount: filtered.filter((s) => s.rating === 'worth').length,
  }
}

// 一笔账目上，谁标了什么——账目卡片盖章要用，按创建时间从早到晚排（先标的章在下面）
export async function expenseSatisfactionsFor(expenseId: string) {
  return (await db.expenseSatisfactions.where('expenseId').equals(expenseId).sortBy('createdAt')).filter((s) => !s.deletedAt)
}

// 我自己有没有标过这天/这笔账目——翻卡片界面判断"这张卡是不是已经翻过了"用不上
// （pendingDaysForMember 已经把翻过的排除掉了），但账目盖章的"我的+号"要不要显示
// 需要单独查一次
export async function myExpenseSatisfaction(expenseId: string, memberId: string) {
  return db.expenseSatisfactions.where('[expenseId+memberId]').equals([expenseId, memberId]).first()
}
