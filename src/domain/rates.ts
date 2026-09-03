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
  if (!householdId) throw new Error('No household found')
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

// 真正删除——只有从没被任何账目用过的标签才允许走这条路，调用方必须自己先用
// usageByEntry 确认过 count===0。用过的标签一律只能归档：硬删会让历史账目
// 找不到自己引用的那条汇率来源，归档则完全不影响已经记好的账
export async function deleteRateBookEntry(id: string) {
  await db.rateBookEntries.delete(id)
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
// 统计两种来源：单一汇率直接引用（e.rateBookEntryId），以及拆成多笔汇率时
// expenseRateAllocations 里分到它头上的那部分（e.rateSpread 为真的开销，
// rateBookEntryId 本身是空的，不会在下面第一段被重复计入）。只有真的记录过
// 换汇金额（exchangedForeignAmount 有值）的条目，"进度"这件事才有意义，但这个
// 函数对所有条目都算，有没有意义由调用方决定要不要显示
export async function usageByEntry(tripId: string): Promise<Map<string, RateEntryUsage>> {
  const [expenses, allocations] = await Promise.all([
    db.expenses.where('tripId').equals(tripId).toArray(),
    db.expenseRateAllocations.where('tripId').equals(tripId).toArray(),
  ])
  const usage = new Map<string, RateEntryUsage>()
  function add(entryId: string, amount: number) {
    const cur = usage.get(entryId) ?? { count: 0, foreignAmount: 0 }
    cur.count += 1
    cur.foreignAmount = Math.round((cur.foreignAmount + amount) * 100) / 100
    usage.set(entryId, cur)
  }
  for (const e of expenses) {
    if (e.rateSpread) continue // 拆分的开销不走这条单选路径，由下面的 allocations 统计
    if (!e.rateBookEntryId) continue
    add(e.rateBookEntryId, e.expenseAmount)
  }
  for (const a of allocations) {
    add(a.rateBookEntryId, a.foreignAmount)
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

export interface TripBlendedRate {
  foreignCurrency: string
  blendedRate: number
}

// "这趟换汇换得怎么样"——按每个币种真正被开销用掉的外币金额，加权这些开销
// 各自来源的汇率簿条目的rate，算出这趟"实际花出去的钱"对应的综合汇率。
// 故意不要求条目填过exchangedHomeAmount/exchangedForeignAmount（那是给单条
// 目"进度条"用的，跟这里的用途不一样）——这里只关心真花出去的钱用的是哪个
// 汇率，一个币种但凡有任何开销用过任何一条汇率就能算，没被用过的币种不返回。
//
// 之所以按"实际花费"而不是"实际换了多少钱"加权：换了但没花完的钱不该拉低/
// 拉高这个数字——例子：机场换的汇率差但没花完，银行换的汇率好且全部花掉，
// 按花费加权算出来的数字会更贴近"我这趟花的钱平均成本"这个用户真正关心的问题
export async function tripBlendedRates(tripId: string): Promise<TripBlendedRate[]> {
  const [entries, usage] = await Promise.all([getAllRateBookEntries(tripId), usageByEntry(tripId)])
  const byCurrency = new Map<string, { weightedSum: number; totalForeign: number }>()
  for (const e of entries) {
    const u = usage.get(e.id)
    if (!u || u.foreignAmount <= 0) continue
    const acc = byCurrency.get(e.foreignCurrency) ?? { weightedSum: 0, totalForeign: 0 }
    acc.weightedSum += u.foreignAmount * e.rate
    acc.totalForeign += u.foreignAmount
    byCurrency.set(e.foreignCurrency, acc)
  }
  return [...byCurrency.entries()]
    .map(([foreignCurrency, { weightedSum, totalForeign }]) => ({
      foreignCurrency,
      blendedRate: weightedSum / totalForeign,
    }))
    .sort((a, b) => a.foreignCurrency.localeCompare(b.foreignCurrency))
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
