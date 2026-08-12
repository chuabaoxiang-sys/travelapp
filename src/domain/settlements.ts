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
}) {
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('未找到所属团队')
  const id = crypto.randomUUID()
  const now = Date.now()
  const settlement: Settlement = { id, householdId, ...params, createdAt: now, updatedAt: now }
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
