import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveRateShares, saveRateAllocations, deleteRateAllocations } from './rateAllocations'
import { db } from '../db/dexie'

vi.mock('./household', () => ({ getCurrentHouseholdId: async () => 'h1' }))

describe('resolveRateShares', () => {
  it('每一批按自己的汇率算出本位币金额，互不影响', () => {
    const shares = resolveRateShares([
      { rateBookEntryId: 'airport', foreignAmount: 6000, rate: 0.03 },
      { rateBookEntryId: 'bank', foreignAmount: 4000, rate: 0.031 },
    ])
    expect(shares).toEqual([
      { rateBookEntryId: 'airport', foreignAmount: 6000, rateUsed: 0.03, homeAmount: 180 },
      { rateBookEntryId: 'bank', foreignAmount: 4000, rateUsed: 0.031, homeAmount: 124 },
    ])
  })

  it('金额为0或负数的行直接丢弃，不落地成一条空分摊记录', () => {
    const shares = resolveRateShares([
      { rateBookEntryId: 'a', foreignAmount: 0, rate: 0.03 },
      { rateBookEntryId: 'b', foreignAmount: -5, rate: 0.03 },
      { rateBookEntryId: 'c', foreignAmount: 100, rate: 0.03 },
    ])
    expect(shares).toEqual([{ rateBookEntryId: 'c', foreignAmount: 100, rateUsed: 0.03, homeAmount: 3 }])
  })

  it('本位币金额四舍五入到分', () => {
    const shares = resolveRateShares([{ rateBookEntryId: 'a', foreignAmount: 3333, rate: 0.0303 }])
    expect(shares[0].homeAmount).toBe(100.99) // 3333 * 0.0303 = 100.9899 -> 100.99 四舍五入到分
  })

  it('空数组返回空数组', () => {
    expect(resolveRateShares([])).toEqual([])
  })
})

describe('saveRateAllocations / deleteRateAllocations（真实走Dexie）', () => {
  const expenseId = 'exp-rate-alloc-test'

  beforeEach(async () => {
    await db.expenseRateAllocations.clear()
  })

  it('保存后能按 expenseId 查回来，每批的外币/本位币金额都对', async () => {
    await saveRateAllocations(expenseId, 'trip-1', [
      { rateBookEntryId: 'airport', foreignAmount: 6000, rate: 0.03 },
      { rateBookEntryId: 'bank', foreignAmount: 4000, rate: 0.031 },
    ])
    const rows = await db.expenseRateAllocations.where('expenseId').equals(expenseId).toArray()
    expect(rows).toHaveLength(2)
    expect(rows.reduce((s, r) => s + r.foreignAmount, 0)).toBe(10000)
    expect(rows.reduce((s, r) => s + r.homeAmount, 0)).toBe(304)
  })

  it('再次保存会整体替换掉旧的那几行（编辑时改拆法的场景）', async () => {
    await saveRateAllocations(expenseId, 'trip-1', [{ rateBookEntryId: 'airport', foreignAmount: 6000, rate: 0.03 }])
    await saveRateAllocations(expenseId, 'trip-1', [
      { rateBookEntryId: 'airport', foreignAmount: 3000, rate: 0.03 },
      { rateBookEntryId: 'cash', foreignAmount: 3000, rate: 0.0296 },
    ])
    const rows = await db.expenseRateAllocations.where('expenseId').equals(expenseId).toArray()
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.rateBookEntryId).sort()).toEqual(['airport', 'cash'])
  })

  it('不影响别的开销的分摊行', async () => {
    await saveRateAllocations(expenseId, 'trip-1', [{ rateBookEntryId: 'airport', foreignAmount: 1000, rate: 0.03 }])
    await saveRateAllocations('exp-other', 'trip-1', [{ rateBookEntryId: 'bank', foreignAmount: 500, rate: 0.031 }])
    await saveRateAllocations(expenseId, 'trip-1', [{ rateBookEntryId: 'cash', foreignAmount: 2000, rate: 0.0296 }])
    expect(await db.expenseRateAllocations.where('expenseId').equals('exp-other').count()).toBe(1)
  })

  it('删除后一行都不剩（改回单一汇率、或整笔删掉的场景）', async () => {
    await saveRateAllocations(expenseId, 'trip-1', [{ rateBookEntryId: 'airport', foreignAmount: 1000, rate: 0.03 }])
    await deleteRateAllocations(expenseId)
    expect(await db.expenseRateAllocations.where('expenseId').equals(expenseId).count()).toBe(0)
  })
})
