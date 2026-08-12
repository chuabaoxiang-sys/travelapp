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
    useCount: 1,
    archived: false,
    createdAt: now,
  }
  await db.rateBookEntries.add(entry)
  return entry
}

// 编辑汇率簿里的某条：只影响以后新记的账，历史账目已经把 rateUsed/homeAmount
// 快照在 expense 表里了，不会被这次编辑追溯改变
export async function updateRateBookEntry(id: string, rate: number) {
  await db.rateBookEntries.update(id, { rate })
}

export async function archiveRateBookEntry(id: string) {
  await db.rateBookEntries.update(id, { archived: true })
}

export async function unarchiveRateBookEntry(id: string) {
  await db.rateBookEntries.update(id, { archived: false })
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
