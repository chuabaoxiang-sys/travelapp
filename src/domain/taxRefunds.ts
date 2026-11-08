import { db } from '../db/dexie'
import { getCurrentHouseholdId } from './household'
import { usageByEntry } from './rates'
import type { RateBookEntry, TaxRefund, TaxRefundMethod } from '../types'

// 退税（2026-11-08，0053）。规则（用户逐条定的）：
// - 单独记一条，不挂在某一笔购物上
// - 外币现金退税同时进汇率簿：自动建一条汇率（标签 = 备注），"已换"记成
//   这次退回来的外币，算进这种外币现金的"还剩"，之后记现金账能选它
// - 汇率默认带这趟这种外币现金的汇率（最近换的那批），可以改
// - 退到卡还没到账：外币金额 × 汇率 先估着算（pending），到账后填实际本位币
// - 算谁的（memberIds）平分，进结算；钱在 receivedBy（记这条的人）手上
// - 不改"这趟已花"和预算，只从"实际花费"里扣

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export async function listTripRefunds(tripId: string): Promise<TaxRefund[]> {
  return (await db.taxRefunds.where('tripId').equals(tripId).toArray()).filter((r) => !r.deletedAt)
}

// 一条退税每人分多少：平分，零头给第一个人（跟送礼、代购分法一样，合计刚好）
export function refundShares(r: Pick<TaxRefund, 'homeAmount' | 'memberIds'>): { memberId: string; amount: number }[] {
  const ids = [...new Set(r.memberIds)]
  if (!ids.length) return []
  const each = Math.floor((r.homeAmount / ids.length) * 100) / 100
  const remainder = round2(r.homeAmount - each * ids.length)
  return ids.map((memberId, i) => ({ memberId, amount: i === 0 ? round2(each + remainder) : each }))
}

export interface RefundSummary {
  total: number // 全部退税（本位币，含估算）
  pendingTotal: number // 其中还没到账的估算部分
  shareByMember: Map<string, number> // 每人分到的退税（扣"我的花费"、进结算）
  heldByMember: Map<string, number> // 钱在谁手上（他要把别人那份还给别人）
}

export function refundSummary(refunds: TaxRefund[]): RefundSummary {
  const shareByMember = new Map<string, number>()
  const heldByMember = new Map<string, number>()
  let total = 0
  let pendingTotal = 0
  for (const r of refunds) {
    if (r.deletedAt) continue
    total += r.homeAmount
    if (r.pending) pendingTotal += r.homeAmount
    for (const s of refundShares(r)) shareByMember.set(s.memberId, round2((shareByMember.get(s.memberId) ?? 0) + s.amount))
    if (r.receivedBy) heldByMember.set(r.receivedBy, round2((heldByMember.get(r.receivedBy) ?? 0) + r.homeAmount))
  }
  return { total: round2(total), pendingTotal: round2(pendingTotal), shareByMember, heldByMember }
}

// 这一条是不是"外币现金"，要进汇率簿
export function refundGoesToRateBook(method: TaxRefundMethod, currency: string, homeCurrency: string): boolean {
  return method === 'cash' && currency !== homeCurrency
}

// 汇率默认值：这趟这种外币现金的汇率。优先"真的换过钱"的那几批（记了换汇金额），
// 取最近建的那批；没有就取最近用过的；退税自己建的那几条不算（不然会自己参考自己）
export function pickDefaultRefundRate(
  entries: RateBookEntry[],
  currency: string,
  refundRateEntryIds: Set<string>,
): RateBookEntry | null {
  const candidates = entries.filter((e) => e.foreignCurrency === currency && !e.archived && !refundRateEntryIds.has(e.id) && e.rate > 0)
  const exchanged = candidates.filter((e) => e.exchangedForeignAmount != null).sort((a, b) => b.createdAt - a.createdAt)
  if (exchanged.length) return exchanged[0]
  return candidates.sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0] ?? null
}

export interface TaxRefundInput {
  tripId: string
  homeCurrency: string
  method: TaxRefundMethod
  currency: string
  foreignAmount: number
  rate: number // 本位币时传 1
  pending: boolean // 只对退到卡有意义
  actualHomeAmount: number | null // 退到卡已到账时填的实际本位币；null = 按汇率算
  memberIds: string[]
  receivedBy: string | null
  refundDate: string
  note: string | null
  rateBookLabel: string // 汇率簿那条的标签（备注为空时用的默认名）
  createdBy: string | null
}

export function computeRefundHomeAmount(input: Pick<TaxRefundInput, 'method' | 'foreignAmount' | 'rate' | 'pending' | 'actualHomeAmount'>): number {
  if (input.method === 'card' && !input.pending && input.actualHomeAmount != null) return round2(input.actualHomeAmount)
  return round2(input.foreignAmount * input.rate)
}

// 新增或修改一条退税。外币现金：同一次保存里建/改汇率簿那条；改成不是外币现金了
// （改成退到卡、或改成本位币）：那条汇率没用过就删、用过就停用
export async function saveTaxRefund(input: TaxRefundInput, existingId?: string): Promise<string> {
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('No household found')
  const now = Date.now()
  const pending = input.method === 'card' ? input.pending : false
  const homeAmount = computeRefundHomeAmount({ ...input, pending })
  const toRateBook = refundGoesToRateBook(input.method, input.currency, input.homeCurrency)
  const existing = existingId ? await db.taxRefunds.get(existingId) : undefined
  const usage = existing?.rateBookEntryId ? await usageByEntry(input.tripId) : null

  let rateBookEntryId: string | null = existing?.rateBookEntryId ?? null
  await db.transaction('rw', db.taxRefunds, db.rateBookEntries, async () => {
    const label = input.note?.trim() || input.rateBookLabel
    if (toRateBook) {
      const linked = rateBookEntryId ? await db.rateBookEntries.get(rateBookEntryId) : undefined
      if (linked) {
        await db.rateBookEntries.update(linked.id, {
          label, rate: input.rate, foreignCurrency: input.currency,
          exchangedHomeAmount: homeAmount, exchangedForeignAmount: input.foreignAmount, archived: false,
        })
      } else {
        rateBookEntryId = crypto.randomUUID()
        await db.rateBookEntries.add({
          id: rateBookEntryId, householdId, tripId: input.tripId, foreignCurrency: input.currency, label,
          rate: input.rate, source: 'manual', createdBy: input.createdBy, lastUsedAt: now, archived: false, createdAt: now,
          exchangedHomeAmount: homeAmount, exchangedForeignAmount: input.foreignAmount,
        })
      }
    } else if (rateBookEntryId) {
      if ((usage?.get(rateBookEntryId)?.count ?? 0) > 0) await db.rateBookEntries.update(rateBookEntryId, { archived: true })
      else await db.rateBookEntries.delete(rateBookEntryId)
      rateBookEntryId = null
    }

    const row: TaxRefund = {
      id: existing?.id ?? crypto.randomUUID(),
      householdId,
      tripId: input.tripId,
      method: input.method,
      currency: input.currency,
      foreignAmount: round2(input.foreignAmount),
      rate: input.rate,
      homeAmount,
      pending,
      memberIds: [...new Set(input.memberIds)],
      receivedBy: input.receivedBy,
      rateBookEntryId,
      refundDate: input.refundDate,
      note: input.note?.trim() || null,
      createdBy: existing?.createdBy ?? input.createdBy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
    }
    await db.taxRefunds.put(row)
    existingId = row.id
  })
  return existingId!
}

// 退到卡的那条到账了：填实际本位币金额，不再是估算
export async function markRefundArrived(id: string, actualHomeAmount: number) {
  await db.taxRefunds.update(id, { pending: false, homeAmount: round2(actualHomeAmount), updatedAt: Date.now() })
}

// 删一条退税（软删）。外币现金那条汇率：没被任何账用过就一起删；已经拿退税的钱记过账了
// 就只停用（那几笔账还要用它），返回 'archived' 让界面告诉用户
export async function deleteTaxRefund(id: string): Promise<'deleted' | 'archived' | 'none'> {
  const r = await db.taxRefunds.get(id)
  if (!r) return 'none'
  const usage = r.rateBookEntryId ? await usageByEntry(r.tripId) : null
  let rateOutcome: 'deleted' | 'archived' | 'none' = 'none'
  await db.transaction('rw', db.taxRefunds, db.rateBookEntries, async () => {
    if (r.rateBookEntryId && (await db.rateBookEntries.get(r.rateBookEntryId))) {
      if ((usage?.get(r.rateBookEntryId)?.count ?? 0) > 0) {
        await db.rateBookEntries.update(r.rateBookEntryId, { archived: true })
        rateOutcome = 'archived'
      } else {
        await db.rateBookEntries.delete(r.rateBookEntryId)
        rateOutcome = 'deleted'
      }
    }
    const now = Date.now()
    await db.taxRefunds.update(id, { deletedAt: now, updatedAt: now })
  })
  return rateOutcome
}
