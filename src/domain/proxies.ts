import { db, enqueueOutbox } from '../db/dexie'
import { isProxySplit, round2 } from './splits'
import type { Expense, ExpenseSplit } from '../types'

// 代购清单（2026-11-07）：帮没来旅行的人买的东西，按人汇总、结束后一次标已还。
// 代购行本身存在 expenseSplits 里（见 domain/splits.ts 的 isProxySplit 和
// 0046_expense_split_proxy.sql），这里只负责"按人怎么列、怎么标已还"

export interface ProxyItem {
  splitId: string
  name: string
  expenseId: string
  expenseDate: string
  description: string | null
  currency: string
  amount: number // 按这笔账的币种
  shareAmount: number // 本位币
  creditorId: string // 这笔的付款人，钱还给他
  repaidAt: number | null
}

export interface ProxyGroup {
  key: string
  name: string
  creditorId: string
  items: ProxyItem[]
  total: number
  repaidAt: number | null // 已还的那组才有
}

export function toProxyItems(expenses: Expense[], splits: ExpenseSplit[]): ProxyItem[] {
  const byId = new Map(expenses.filter((e) => !e.deletedAt).map((e) => [e.id, e]))
  const items: ProxyItem[] = []
  for (const s of splits) {
    const e = byId.get(s.expenseId)
    if (!e || !isProxySplit(s)) continue
    items.push({
      splitId: s.id,
      name: (s.proxyName ?? '').trim(),
      expenseId: e.id,
      expenseDate: e.expenseDate,
      description: e.description,
      currency: e.expenseCurrency,
      amount: s.proxyAmount ?? 0,
      shareAmount: s.shareAmount,
      creditorId: e.paidBy,
      repaidAt: s.proxyRepaidAt ?? null,
    })
  }
  return items
}

// 没还的按"名字 + 还给谁"汇总（同一个人的东西有几笔是 KN 付的，钱要还给 KN，
// 分开列）；已还的再按"哪一次标的已还"分组，撤销时一整批撤回
export function groupProxyItems(items: ProxyItem[]): { unpaid: ProxyGroup[]; repaid: ProxyGroup[] } {
  const unpaid = new Map<string, ProxyGroup>()
  const repaid = new Map<string, ProxyGroup>()
  for (const it of [...items].sort((a, b) => a.expenseDate.localeCompare(b.expenseDate))) {
    const target = it.repaidAt ? repaid : unpaid
    const key = it.repaidAt ? `${it.name}|${it.creditorId}|${it.repaidAt}` : `${it.name}|${it.creditorId}`
    const g = target.get(key) ?? { key, name: it.name, creditorId: it.creditorId, items: [], total: 0, repaidAt: it.repaidAt }
    g.items.push(it)
    g.total = round2(g.total + it.shareAmount)
    target.set(key, g)
  }
  return {
    unpaid: [...unpaid.values()].sort((a, b) => b.total - a.total),
    repaid: [...repaid.values()].sort((a, b) => (b.repaidAt ?? 0) - (a.repaidAt ?? 0)),
  }
}

// 这趟代购一共多少、还有多少没还（账目页黑卡那一行用）
export function proxySummary(items: ProxyItem[]): { total: number; unpaid: number } {
  return {
    total: round2(items.reduce((s, it) => s + it.shareAmount, 0)),
    unpaid: round2(items.filter((it) => !it.repaidAt).reduce((s, it) => s + it.shareAmount, 0)),
  }
}

// 标已还 / 改回未还：直接改这几行的 proxyRepaidAt（id 不变），每笔账入队一次整笔
// 分摊的原子推送——跟改分摊走同一条同步路径
export async function setProxyRepaid(splitIds: string[], repaidAt: number | null) {
  await db.transaction('rw', db.expenseSplits, db.outbox, async () => {
    const rows = (await db.expenseSplits.bulkGet(splitIds)).filter((r): r is ExpenseSplit => !!r && isProxySplit(r))
    for (const r of rows) await db.expenseSplits.update(r.id, { proxyRepaidAt: repaidAt })
    for (const expenseId of new Set(rows.map((r) => r.expenseId))) {
      await enqueueOutbox('expenseSplits', expenseId, 'upsert', { expenseId })
    }
  })
}

// 记账时"以前填过的名字"：团队里所有代购行按用过的次数排，最常用的在前
export async function recentProxyNames(limit = 8): Promise<string[]> {
  const counts = new Map<string, number>()
  await db.expenseSplits.each((s) => {
    if (!isProxySplit(s) || s.deletedAt) return
    const name = (s.proxyName ?? '').trim()
    counts.set(name, (counts.get(name) ?? 0) + 1)
  })
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([n]) => n)
}
