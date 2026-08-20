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

// 记一笔账时点了某个已有汇率chip——更新它的"最近使用"和"使用次数"，
// 但不改 rate 本身，保证以后排序会把它推到更前面
export async function recordRateUsage(id: string) {
  const entry = await db.rateBookEntries.get(id)
  if (!entry) return
  await db.rateBookEntries.update(id, { lastUsedAt: Date.now(), useCount: entry.useCount + 1 })
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
  // 只有"记账时顺手新建汇率"这个场景，创建的同一刻就真的拿去记了一笔账，
  // 才该传1；汇率簿里"+新增"和"另存为新标签"都是纯粹的记录/管理动作，
  // 跟有没有真的记过账无关，不传时默认0——不然会出现"用过1次"但其实
  // 一笔账都没记过的假象
  useCount?: number
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
    useCount: params.useCount ?? 0,
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

// 这条汇率簿条目已经被花掉多少外币——目前只统计"直接用单一汇率选中它"的开销；
// 等一笔账可以拆成多笔汇率之后，这里再补上"拆分"里分到它头上的那部分。只有真的
// 记录过换汇金额（exchangedForeignAmount 有值）的条目，"进度"这件事才有意义，
// 但这个函数对所有条目都算，有没有意义由调用方（看 exchangedForeignAmount 是否
// 非空）决定要不要显示
export async function usedForeignAmountByEntry(tripId: string): Promise<Map<string, number>> {
  const expenses = await db.expenses.where('tripId').equals(tripId).toArray()
  const used = new Map<string, number>()
  for (const e of expenses) {
    if (!e.rateBookEntryId) continue
    used.set(e.rateBookEntryId, Math.round(((used.get(e.rateBookEntryId) ?? 0) + e.expenseAmount) * 100) / 100)
  }
  return used
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
