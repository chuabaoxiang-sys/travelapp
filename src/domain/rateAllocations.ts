import { db } from '../db/dexie'
import { getCurrentHouseholdId } from './household'

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export interface RateAllocationInput {
  rateBookEntryId: string
  foreignAmount: number
  rate: number
}

export interface ResolvedRateShare {
  rateBookEntryId: string
  foreignAmount: number
  rateUsed: number
  homeAmount: number
}

// 把一笔开销的外币总额拆给不止一个汇率簿条目。跟 resolveDayShares（按天分摊）不同——
// 换汇批次之间没有"平均分摊"的自然含义，只有"精确填写"这一种模式：每一份具体
// 来自哪个批次、多少钱只能用户自己填（试算过"按剩余比例分"和"先用完一批再用
// 下一批"两种分法，算出来的实际花费不一样，没有唯一正确的默认分法，交给用户
// 自己决定更靠谱）。金额为0（没填）的行直接丢弃，不落地成一条空分摊记录
export function resolveRateShares(inputs: RateAllocationInput[]): ResolvedRateShare[] {
  return inputs
    .filter((i) => i.foreignAmount > 0)
    .map((i) => ({
      rateBookEntryId: i.rateBookEntryId,
      foreignAmount: round2(i.foreignAmount),
      rateUsed: i.rate,
      homeAmount: round2(i.foreignAmount * i.rate),
    }))
}

// 保存一笔开销的换汇分摊：先清掉旧的（编辑场景），再按新的方式重新写入。
// 跟 saveDayAllocations 一样，expenseRateAllocations 没有"总额必须等于开销总额"
// 的延迟约束，走通用的逐行同步 hook 就够了，不需要手动打包 outbox
export async function saveRateAllocations(expenseId: string, tripId: string, inputs: RateAllocationInput[]) {
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('未找到所属团队')
  await db.expenseRateAllocations.where('expenseId').equals(expenseId).delete()
  const shares = resolveRateShares(inputs)
  if (!shares.length) return
  await db.expenseRateAllocations.bulkAdd(
    shares.map((s) => ({ id: crypto.randomUUID(), householdId, expenseId, tripId, ...s })),
  )
}

// 一笔开销从"拆多笔汇率"改回单一汇率、或者整笔被删掉时，把它的换汇分摊一起清掉
export async function deleteRateAllocations(expenseId: string) {
  await db.expenseRateAllocations.where('expenseId').equals(expenseId).delete()
}
