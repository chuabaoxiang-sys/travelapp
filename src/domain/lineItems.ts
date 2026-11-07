import { db } from '../db/dexie'
import { getCurrentHouseholdId } from './household'
import { isProxySplit, persistExpenseSplitShares, round2, type SplitShare } from './splits'
import type { ExpenseLineItem } from '../types'

export interface LineItemInput {
  name: string
  amount: number
  memberIds: string[]
  // 逐项拆账 + 代购（0051，2026-11-08）：这一项还勾了哪些代购的人（名字），
  // 跟勾的同行成员一起均分这一项
  proxyNames?: string[]
}

export interface LineItemShare {
  memberId: string
  shareAmount: number
}

// 逐项拆账的份额计算：每个子项先按(1+服务费%)算出含服务费的实际金额，
// 再均分给这个子项勾选的成员（分不尽的零头给子项名单里的第一个人，
// 跟resolveSplitShares的取整规则保持一致，同一个概念只定义一次取整方式）。
// 同一个人可能出现在好几个子项里（比如两道菜都点了），各子项算出来的
// 份额要累加，不是覆盖——用Map按memberId汇总
//
// 2026-11-07 起子项金额按这笔账自己的币种填（外币账照收据填外币；有优惠时照原价填）。
// 传了 homeAmount 时，先按上面的规则在"这笔的币种"里算出每人占多少，再按比例把
// homeAmount 分下去——优惠、汇率都自然按比例摊进每个人，合计刚好等于 homeAmount
// （四舍五入的零头给份额最大的人）
export function resolveLineItemShares(items: LineItemInput[], feePercent: number, homeAmount?: number): LineItemShare[] {
  return resolveItemizedParts(items, feePercent, homeAmount)
    .filter((p) => p.kind === 'member')
    .map((p) => ({ memberId: p.key, shareAmount: p.share }))
}

// 每个参与者（同行成员 / 代购的人）在"这笔的币种"里占多少（weight），以及按比例分到的本位币（share）
export interface ItemizedPart {
  kind: 'member' | 'proxy'
  key: string // 成员 id，或代购的人的名字
  weight: number
  share: number
}

export function resolveItemizedParts(items: LineItemInput[], feePercent: number, homeAmount?: number): ItemizedPart[] {
  const weights = new Map<string, { kind: 'member' | 'proxy'; key: string; weight: number }>()
  for (const item of items) {
    const participants = [
      ...item.memberIds.map((id) => ({ kind: 'member' as const, key: id })),
      ...(item.proxyNames ?? []).map((n) => n.trim()).filter(Boolean).map((n) => ({ kind: 'proxy' as const, key: n })),
    ]
    if (!participants.length) continue
    const withFee = round2(item.amount * (1 + feePercent / 100))
    const n = participants.length
    const base = Math.floor((withFee / n) * 100) / 100
    const remainder = round2(withFee - base * n)
    participants.forEach((p, i) => {
      const id = `${p.kind}:${p.key}`
      const cur = weights.get(id) ?? { ...p, weight: 0 }
      cur.weight = round2(cur.weight + (i === 0 ? round2(base + remainder) : base))
      weights.set(id, cur)
    })
  }
  const parts = [...weights.values()].map((w) => ({ ...w, share: w.weight }))
  if (homeAmount == null) return parts
  const weightTotal = parts.reduce((s, r) => s + r.weight, 0)
  if (!(weightTotal > 0)) return parts.map((r) => ({ ...r, share: 0 }))
  for (const p of parts) p.share = round2((homeAmount * p.weight) / weightTotal)
  const diff = round2(homeAmount - parts.reduce((s, r) => s + r.share, 0))
  if (diff !== 0 && parts.length) {
    const biggest = parts.reduce((a, b) => (b.share > a.share ? b : a))
    biggest.share = round2(biggest.share + diff)
  }
  return parts
}

// 逐项拆账的全部分摊行：同行成员按份额；代购的人变成代购行（memberId = 付款人，
// proxyAmount = 他在这笔币种里占的原价，跟单独记代购时同一套口径）。repaidByName 用来
// 保留重新保存前已经标了"已还"的状态
export function buildItemizedSplitShares(
  items: LineItemInput[],
  feePercent: number,
  homeAmount: number,
  payerId: string,
  repaidByName: Map<string, number | null> = new Map(),
): SplitShare[] {
  return resolveItemizedParts(items, feePercent, homeAmount).map((p) =>
    p.kind === 'member'
      ? { memberId: p.key, shareAmount: p.share }
      : { memberId: payerId, shareAmount: p.share, proxyName: p.key, proxyAmount: p.weight, proxyRepaidAt: repaidByName.get(p.key) ?? null },
  )
}

// 保存一笔逐项拆账：子项+成员关联永远整份替换（先清掉这笔账目旧的两张表的行，
// 再重新写入），这两张表没有"编辑单个字段"的路径，逻辑更简单也不会留孤儿行。
// 算出来的最终每人份额复用 persistExpenseSplitShares 落地进 expenseSplits——
// 结算/按笔结算这些下游逻辑完全不用知道这笔账目是不是逐项拆的
export async function saveItemizedExpense(expenseId: string, items: LineItemInput[], feePercent: number, homeAmount: number, payerId: string) {
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('No household found')

  const oldItemIds = await db.expenseLineItems.where('expenseId').equals(expenseId).primaryKeys()
  if (oldItemIds.length) {
    await db.expenseLineItemMembers.where('lineItemId').anyOf(oldItemIds).delete()
    await db.expenseLineItems.where('expenseId').equals(expenseId).delete()
  }

  const itemRows: ExpenseLineItem[] = items.map((item, i) => ({
    id: crypto.randomUUID(),
    householdId,
    expenseId,
    name: item.name,
    amount: item.amount,
    orderIndex: i,
    proxyNames: (item.proxyNames ?? []).map((n) => n.trim()).filter(Boolean),
    deletedAt: null,
  }))
  await db.expenseLineItems.bulkAdd(itemRows)

  const memberRows = itemRows.flatMap((row, i) =>
    items[i].memberIds.map((memberId) => ({ id: crypto.randomUUID(), householdId, lineItemId: row.id, memberId, deletedAt: null })),
  )
  if (memberRows.length) await db.expenseLineItemMembers.bulkAdd(memberRows)

  // 已经标了"已还"的代购，按名字保留下来
  const oldSplits = (await db.expenseSplits.where('expenseId').equals(expenseId).toArray()).filter((s) => !s.deletedAt && isProxySplit(s))
  const repaidByName = new Map(oldSplits.map((s) => [(s.proxyName ?? '').trim(), s.proxyRepaidAt ?? null]))
  await persistExpenseSplitShares(expenseId, buildItemizedSplitShares(items, feePercent, homeAmount, payerId, repaidByName))
}

// 从"逐项拆账"改回其他分摊方式时，把旧的子项+成员关联清掉——跟"从跨多天
// 改回单日"要清掉旧的每日分摊（deleteDayAllocations）是同一个道理，不清
// 的话残留的子项数据不会被任何界面用到，但会在原地占着，下次万一又切回
// 逐项拆账容易被误认成"上次的数据还在"
export async function deleteLineItems(expenseId: string) {
  const oldItemIds = await db.expenseLineItems.where('expenseId').equals(expenseId).primaryKeys()
  if (!oldItemIds.length) return
  await db.expenseLineItemMembers.where('lineItemId').anyOf(oldItemIds).delete()
  await db.expenseLineItems.where('expenseId').equals(expenseId).delete()
}

export interface LoadedLineItem {
  id: string
  name: string
  amount: number
  memberIds: string[]
  proxyNames: string[]
}

// 编辑一笔已有的逐项拆账账目时，回显原来的子项+每项勾选的成员
export async function getLineItemsForExpense(expenseId: string): Promise<LoadedLineItem[]> {
  const items = (await db.expenseLineItems.where('expenseId').equals(expenseId).sortBy('orderIndex')).filter((i) => !i.deletedAt)
  if (!items.length) return []
  const itemIds = items.map((i) => i.id)
  const memberRows = (await db.expenseLineItemMembers.where('lineItemId').anyOf(itemIds).toArray()).filter((m) => !m.deletedAt)
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    amount: item.amount,
    memberIds: memberRows.filter((m) => m.lineItemId === item.id).map((m) => m.memberId),
    proxyNames: item.proxyNames ?? [],
  }))
}
