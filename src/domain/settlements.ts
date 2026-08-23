import { db } from '../db/dexie'
import { getCurrentHouseholdId } from './household'
import type { Settlement } from '../types'

export async function getSettlements(tripId: string): Promise<Settlement[]> {
  const all = await db.settlements.where('tripId').equals(tripId).toArray()
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export async function createSettlement(params: {
  tripId: string
  fromMemberId: string
  toMemberId: string
  amount: number
  settledDate: string
  note: string | null
  // 记这笔结算的人。可空是为了兼容还没传这个值的调用方/历史数据
  createdBy?: string | null
  // 这笔结算是针对具体哪一笔账目记的——不传/传null就是聚合结算，行为跟以前一样
  expenseId?: string | null
}) {
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('未找到所属团队')
  const id = crypto.randomUUID()
  const now = Date.now()
  const settlement: Settlement = {
    id,
    householdId,
    ...params,
    createdBy: params.createdBy ?? null,
    expenseId: params.expenseId ?? null,
    createdAt: now,
    updatedAt: now,
  }
  await db.settlements.add(settlement)
  return id
}

export async function updateSettlement(
  id: string,
  params: { amount: number; settledDate: string; note: string | null },
) {
  await db.settlements.update(id, { ...params, updatedAt: Date.now() })
}

export async function deleteSettlement(id: string) {
  await db.settlements.delete(id)
}

// 这笔账目有没有被"按笔结算"过（哪怕只结算了一部分）——有的话金额/分摊方式
// 就不能再改、也不能删除这笔账目，避免跟已经记录的结算对不上。现查不缓存，
// 删掉对应的结算记录之后这笔账目会自动重新变回可编辑
export async function isExpenseSettled(expenseId: string): Promise<boolean> {
  const count = await db.settlements.where('expenseId').equals(expenseId).count()
  return count > 0
}
