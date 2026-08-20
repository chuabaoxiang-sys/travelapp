import { db } from '../db/dexie'
import { getCurrentHouseholdId } from './household'
import type { RateBookEntry } from '../types'

// 汇率簿推荐排序：最近用过的排前面，用得越勤的在同等新近度下也更靠前。
// 简单起见直接按 lastUsedAt 倒序——新增的标签第一次用完就会跳到最前面，
// 正好符合"最近用的最方便点"的直觉，不需要更复杂的加权算法。
export async function getRateBookEntries(tripId: string, currency: string): Promise<RateBookEntry[]> {
  const all = await db.rateBookEntries.where({ tripId, foreignCurrency: currency }).toArray()
  return all.filter((r) => !r.archived).sort((a, b) => b.lastUsedAt - a.lastUsedAt)
}

export async function getAllRateBookEntries(tripId: string): Promise<RateBookEntry[]> {
  const all = await db.rateBookEntries.where('tripId').equals(tripId).toArray()
  return all.sort((a, b) => b.lastUsedAt - a.lastUsedAt)
}

// 记一笔账时点了某个已有汇率chip——更新它的"最近使用"，保证以后排序会把它推到更前面。
// "用过几次"不再靠这里累加的计数器记（那种计数器只会涨不会跌，开销被删掉/改掉之后
// 计数依然停在原来的高水位，跟真实情况对不上——见 usageByEntry 的说明），改成现查
export async function recordRateUsage(id: string) {
  await db.rateBookEntries.update(id, { lastUsedAt: Date.now() })
}

export async function createRateBookEntry(params: {
  tripId: string
  foreignCurrency: string
  label: string
  rate: number
  source: RateBookEntry['source']
  createdBy: string | null
  exchangedHomeAmount?: number | null
  exchangedForeignAmount?: number | null
}): Promise<RateBookEntry> {
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('未找到所属团队')
  const id = crypto.randomUUID()
  const now = Date.now()
  const entry: RateBookEntry = {
    id,
    householdId,
    tripId: params.tripId,
    foreignCurrency: params.foreignCurrency,
    label: params.label,
    rate: params.rate,
    source: params.source,
    createdBy: params.createdBy,
    lastUsedAt: now,
    archived: false,
    createdAt: now,
    exchangedHomeAmount: params.exchangedHomeAmount ?? null,
    exchangedForeignAmount: params.exchangedForeignAmount ?? null,
  }
  await db.rateBookEntries.add(entry)
  return entry
}

// 编辑汇率簿里的某条：只影响以后新记的账，历史账目已经把 rateUsed/homeAmount
// 快照在 expense 表里了，不会被这次编辑追溯改变
export async function updateRateBookEntry(
  id: string,
  updates: { rate: number; label: string; exchangedHomeAmount?: number | null; exchangedForeignAmount?: number | null },
) {
  await db.rateBookEntries.update(id, updates)
}

export async function archiveRateBookEntry(id: string) {
  await db.rateBookEntries.update(id, { archived: true })
}

export async function unarchiveRateBookEntry(id: string) {
  await db.rateBookEntries.update(id, { archived: false })
}

export interface RateEntryUsage {
  count: number
  foreignAmount: number
}

// 这条汇率簿条目实际被多少笔开销用过、加起来花了多少外币——现查现算，不依赖任何
// 存起来的计数器。之前"用过N次"是存了个只会涨不会跌的 useCount，开销被删掉或者
// 改成别的汇率之后，这个数字不会跟着往下修正，用户拿真实数据一对就会发现完全对不上
// （真实反馈过："这些汇率我很确定没用过，为什么还显示用过N次"）。现查就没有这个问题：
// 开销删了，这里自然就不再算它。
//
// 目前只统计"直接用单一汇率选中它"的开销；等一笔账可以拆成多笔汇率之后，这里再补上
// "拆分"里分到它头上的那部分。只有真的记录过换汇金额（exchangedForeignAmount 有值）
// 的条目，"进度"这件事才有意义，但这个函数对所有条目都算，有没有意义由调用方决定要不要显示
export async function usageByEntry(tripId: string): Promise<Map<string, RateEntryUsage>> {
  const expenses = await db.expenses.where('tripId').equals(tripId).toArray()
  const usage = new Map<string, RateEntryUsage>()
  for (const e of expenses) {
    if (!e.rateBookEntryId) continue
    const cur = usage.get(e.rateBookEntryId) ?? { count: 0, foreignAmount: 0 }
    cur.count += 1
    cur.foreignAmount = Math.round((cur.foreignAmount + e.expenseAmount) * 100) / 100
    usage.set(e.rateBookEntryId, cur)
  }
  return usage
}

// 从"给出/换到"两个金额反推汇率，任一无效时返回 null——调用方拿到非 null
// 就顺手回填汇率输入框，用户之后仍可手动覆盖
export function deriveRateFromExchangeAmounts(homeAmount: string, foreignAmount: string): number | null {
  const home = parseFloat(homeAmount)
  const foreign = parseFloat(foreignAmount)
  if (!(home > 0) || !(foreign > 0)) return null
  return home / foreign
}

// 输入新标签时的自动补全候选——取这趟行程里这个币种曾经用过的所有标签
// （含已归档的，方便用户沿用命名习惯），按最近使用排序去重
export async function suggestLabels(tripId: string, currency: string): Promise<string[]> {
  const all = await db.rateBookEntries.where({ tripId, foreignCurrency: currency }).toArray()
  const sorted = all.sort((a, b) => b.lastUsedAt - a.lastUsedAt)
  const seen = new Set<string>()
  const labels: string[] = []
  for (const r of sorted) {
    if (!seen.has(r.label)) {
      seen.add(r.label)
      labels.push(r.label)
    }
  }
  return labels
}
