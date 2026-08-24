import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveDayShares, saveDayAllocations, deleteDayAllocations, spendByDate, spentOnDate } from './dayAllocations'
import { db } from '../db/dexie'
import type { Expense, ExpenseDayAllocation } from '../types'

vi.mock('./household', () => ({ getCurrentHouseholdId: async () => 'h1' }))

describe('resolveDayShares', () => {
  it('能整除时平均分到每一天，加总等于原金额', () => {
    const shares = resolveDayShares(900, 'equal', ['2026-08-21', '2026-08-22', '2026-08-23'])
    expect(shares).toEqual([
      { date: '2026-08-21', amount: 300 },
      { date: '2026-08-22', amount: 300 },
      { date: '2026-08-23', amount: 300 },
    ])
  })

  it('不能整除时余数给第一天，加总仍然精确等于原金额（不会凭空丢几分钱）', () => {
    const shares = resolveDayShares(100, 'equal', ['2026-08-21', '2026-08-22', '2026-08-23'])
    const total = shares.reduce((s, x) => s + x.amount, 0)
    expect(Math.round(total * 100) / 100).toBe(100)
    expect(shares[0].amount).toBeCloseTo(33.34, 2)
    expect(shares[1].amount).toBeCloseTo(33.33, 2)
  })

  it('日期不连续时照样按选中的那几天分（周游券只在第1天和第4天用）', () => {
    const shares = resolveDayShares(120, 'equal', ['2026-08-19', '2026-08-22'])
    expect(shares).toEqual([
      { date: '2026-08-19', amount: 60 },
      { date: '2026-08-22', amount: 60 },
    ])
  })

  it('只选1天时等价于整笔算在那天', () => {
    expect(resolveDayShares(500, 'equal', ['2026-08-21'])).toEqual([{ date: '2026-08-21', amount: 500 }])
  })

  it('一天都没选时返回空数组，不抛错也不凭空造一行出来', () => {
    expect(resolveDayShares(500, 'equal', [])).toEqual([])
  })

  it('exact：按每天自己填的金额原样落地，不强制平分', () => {
    const shares = resolveDayShares(900, 'exact', ['2026-08-21', '2026-08-22'], {
      '2026-08-21': 250,
      '2026-08-22': 650,
    })
    expect(shares).toEqual([
      { date: '2026-08-21', amount: 250 },
      { date: '2026-08-22', amount: 650 },
    ])
  })

  it('exact 但某天没填时按0算，不会变成undefined写进库', () => {
    const shares = resolveDayShares(100, 'exact', ['2026-08-21', '2026-08-22'], { '2026-08-21': 100 })
    expect(shares[1]).toEqual({ date: '2026-08-22', amount: 0 })
  })
})

describe('saveDayAllocations / deleteDayAllocations（真实走Dexie）', () => {
  const expenseId = 'exp-alloc-test'

  beforeEach(async () => {
    await db.expenseDayAllocations.clear()
  })

  it('保存后能按 expenseId 查回来，金额和日期都对', async () => {
    await saveDayAllocations(expenseId, 'trip-1', 900, 'equal', ['2026-08-21', '2026-08-22', '2026-08-23'])
    const rows = await db.expenseDayAllocations.where('expenseId').equals(expenseId).toArray()
    expect(rows).toHaveLength(3)
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(900)
    expect(rows.map((r) => r.date).sort()).toEqual(['2026-08-21', '2026-08-22', '2026-08-23'])
  })

  it('再次保存会整体替换掉旧的那几行，不会留下上一次的残留（编辑时改天数的场景）', async () => {
    await saveDayAllocations(expenseId, 'trip-1', 900, 'equal', ['2026-08-21', '2026-08-22', '2026-08-23'])
    await saveDayAllocations(expenseId, 'trip-1', 900, 'equal', ['2026-08-21', '2026-08-23'])
    const rows = await db.expenseDayAllocations.where('expenseId').equals(expenseId).toArray()
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.date).sort()).toEqual(['2026-08-21', '2026-08-23'])
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(900)
  })

  it('不影响别的开销的分摊行', async () => {
    await saveDayAllocations(expenseId, 'trip-1', 300, 'equal', ['2026-08-21'])
    await saveDayAllocations('exp-other', 'trip-1', 200, 'equal', ['2026-08-22'])
    await saveDayAllocations(expenseId, 'trip-1', 300, 'equal', ['2026-08-23'])
    expect(await db.expenseDayAllocations.where('expenseId').equals('exp-other').count()).toBe(1)
  })

  it('删除后一行都不剩（改回单日开销、或整笔删掉的场景）', async () => {
    await saveDayAllocations(expenseId, 'trip-1', 900, 'equal', ['2026-08-21', '2026-08-22'])
    await deleteDayAllocations(expenseId)
    expect(await db.expenseDayAllocations.where('expenseId').equals(expenseId).count()).toBe(0)
  })
})

describe('spendByDate', () => {
  const days = [
    { id: 'day-1', date: '2026-08-21' },
    { id: 'day-2', date: '2026-08-22' },
  ]

  function expense(id: string, homeAmount: number, itineraryDayId: string | null, daySpreadMode?: 'equal' | 'exact'): Expense {
    return {
      id, householdId: 'h1', tripId: 't1', categoryId: 'cat-food', phase: 'during_trip', description: null,
      expenseCurrency: 'MYR', expenseAmount: homeAmount, rateBookEntryId: null, rateUsed: 1, homeAmount,
      paidBy: 'papa', recordedBy: 'papa', expenseDate: '2026-08-21', itineraryDayId, itineraryItemId: null,
      splitType: 'equal', daySpreadMode: daySpreadMode ?? null, createdAt: 0, updatedAt: 0,
    }
  }
  function alloc(expenseId: string, date: string, amount: number): ExpenseDayAllocation {
    return { id: `${expenseId}-${date}`, householdId: 'h1', expenseId, tripId: 't1', date, amount }
  }

  it('单日开销整笔算在它关联的那一天', () => {
    const totals = spendByDate([expense('e1', 180, 'day-1')], [], days)
    expect(totals.get('2026-08-21')).toBe(180)
    expect(totals.get('2026-08-22')).toBeUndefined()
  })

  it('跨天开销按每天分到的金额算，不按整笔算', () => {
    const totals = spendByDate(
      [expense('e1', 900, null, 'equal')],
      [alloc('e1', '2026-08-21', 450), alloc('e1', '2026-08-22', 450)],
      days,
    )
    expect(totals.get('2026-08-21')).toBe(450)
    expect(totals.get('2026-08-22')).toBe(450)
  })

  it('跨天开销即使还挂着 itineraryDayId 也不会被重复计算一次', () => {
    const totals = spendByDate(
      [expense('e1', 900, 'day-1', 'equal')],
      [alloc('e1', '2026-08-21', 450), alloc('e1', '2026-08-22', 450)],
      days,
    )
    expect(totals.get('2026-08-21')).toBe(450) // 不是 450+900
  })

  it('单日和跨天混在一起时各自累加', () => {
    const totals = spendByDate(
      [expense('e1', 900, null, 'equal'), expense('e2', 180, 'day-2')],
      [alloc('e1', '2026-08-21', 300), alloc('e1', '2026-08-22', 600)],
      days,
    )
    expect(totals.get('2026-08-21')).toBe(300)
    expect(totals.get('2026-08-22')).toBe(780) // 600 分摊 + 180 单日
  })

  it('没关联到任何一天的开销不计入任何一天', () => {
    const totals = spendByDate([expense('e1', 180, null)], [], days)
    expect(totals.size).toBe(0)
  })
})

describe('spentOnDate（和 spendByDate 是不同口径，别混用）', () => {
  function expense(id: string, homeAmount: number, expenseDate: string,
                   itineraryDayId: string | null, daySpreadMode?: 'equal' | 'exact'): Expense {
    return {
      id, householdId: 'h1', tripId: 't1', categoryId: 'cat-food', phase: 'during_trip', description: null,
      expenseCurrency: 'MYR', expenseAmount: homeAmount, rateBookEntryId: null, rateUsed: 1, homeAmount,
      paidBy: 'papa', recordedBy: 'papa', expenseDate, itineraryDayId, itineraryItemId: null,
      splitType: 'equal', daySpreadMode: daySpreadMode ?? null, createdAt: 0, updatedAt: 0,
    }
  }
  const alloc = (expenseId: string, date: string, amount: number): ExpenseDayAllocation =>
    ({ id: `${expenseId}-${date}`, householdId: 'h1', expenseId, tripId: 't1', date, amount })

  // 这条是这个函数存在的全部理由：关联行程是可选的，绝大多数账目 itineraryDayId 都是
  // null。曾经"今天已花"错用了 spendByDate，导致这类账目一律不计，额度一整天显示满的
  it('没有关联任何行程日的开销，照样算进当天', () => {
    expect(spentOnDate([expense('e1', 268, '2026-08-24', null)], [], '2026-08-24')).toBe(268)
  })

  it('按 expenseDate 归日，不看它关联到哪个行程日', () => {
    // 关联的是 day-1（8/21），但 expenseDate 是 8/24 —— 应该算在 8/24
    const e = expense('e1', 100, '2026-08-24', 'day-1')
    expect(spentOnDate([e], [], '2026-08-24')).toBe(100)
    expect(spentOnDate([e], [], '2026-08-21')).toBe(0)
  })

  it('跨天开销只算它分到当天的那一份，不整笔算', () => {
    const e = expense('e1', 900, '2026-08-21', null, 'equal')
    const as = [alloc('e1', '2026-08-21', 300), alloc('e1', '2026-08-22', 600)]
    expect(spentOnDate([e], as, '2026-08-21')).toBe(300)
    expect(spentOnDate([e], as, '2026-08-22')).toBe(600)
  })

  it('别的日子的开销不会漏进来', () => {
    const es = [expense('e1', 100, '2026-08-23', null), expense('e2', 50, '2026-08-24', null)]
    expect(spentOnDate(es, [], '2026-08-24')).toBe(50)
  })
})
