import { db } from '../db/dexie'
import { getCurrentHouseholdId } from './household'
import { persistExpenseSplitShares, round2 } from './splits'
import type { ExpenseLineItem } from '../types'

export interface LineItemInput {
  name: string
  amount: number
  memberIds: string[]
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
  const raw = resolveLineItemWeights(items, feePercent)
  if (homeAmount == null) return raw
  const weightTotal = raw.reduce((s, r) => s + r.shareAmount, 0)
  if (!(weightTotal > 0)) return raw.map((r) => ({ ...r, shareAmount: 0 }))
  const scaled = raw.map((r) => ({ memberId: r.memberId, shareAmount: round2((homeAmount * r.shareAmount) / weightTotal) }))
  const diff = round2(homeAmount - scaled.reduce((s, r) => s + r.shareAmount, 0))
  if (diff !== 0 && scaled.length) {
    const biggest = scaled.reduce((a, b) => (b.shareAmount > a.shareAmount ? b : a))
    biggest.shareAmount = round2(biggest.shareAmount + diff)
  }
  return scaled
}

function resolveLineItemWeights(items: LineItemInput[], feePercent: number): LineItemShare[] {
  const totals = new Map<string, number>()
  for (const item of items) {
    if (!item.memberIds.length) continue
    const withFee = round2(item.amount * (1 + feePercent / 100))
    const n = item.memberIds.length
    const base = Math.floor((withFee / n) * 100) / 100
    const remainder = round2(withFee - base * n)
    item.memberIds.forEach((id, i) => {
      const share = i === 0 ? round2(base + remainder) : base
      totals.set(id, round2((totals.get(id) ?? 0) + share))
    })
  }
  return [...totals.entries()].map(([memberId, shareAmount]) => ({ memberId, shareAmount }))
}

// 保存一笔逐项拆账：子项+成员关联永远整份替换（先清掉这笔账目旧的两张表的行，
// 再重新写入），这两张表没有"编辑单个字段"的路径，逻辑更简单也不会留孤儿行。
// 算出来的最终每人份额复用 persistExpenseSplitShares 落地进 expenseSplits——
// 结算/按笔结算这些下游逻辑完全不用知道这笔账目是不是逐项拆的
export async function saveItemizedExpense(expenseId: string, items: LineItemInput[], feePercent: number, homeAmount: number) {
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
    deletedAt: null,
  }))
  await db.expenseLineItems.bulkAdd(itemRows)

  const memberRows = itemRows.flatMap((row, i) =>
    items[i].memberIds.map((memberId) => ({ id: crypto.randomUUID(), householdId, lineItemId: row.id, memberId, deletedAt: null })),
  )
  if (memberRows.length) await db.expenseLineItemMembers.bulkAdd(memberRows)

  const shares = resolveLineItemShares(items, feePercent, homeAmount)
  await persistExpenseSplitShares(expenseId, shares)
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
  }))
}
