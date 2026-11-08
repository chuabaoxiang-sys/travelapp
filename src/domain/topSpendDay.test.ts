import { describe, it, expect } from 'vitest'
import { topSpendDay } from './retrospective'
import type { Expense, ExpenseDayAllocation } from '../types'

// 例子照东京北海道这趟：4 月订的机票（出发前）、10/26 记的租车 8 天 + 酒店 2 晚、10/27 普通开销
function exp(id: string, date: string, home: number, spread = false): Expense {
  return {
    id, householdId: 'h1', tripId: 't1', categoryId: 'c', expenseDate: date, phase: 'during_trip', expenseCurrency: 'MYR',
    expenseAmount: home, rateBookEntryId: null, rateUsed: 1, homeAmount: home, paidBy: 'bx', recordedBy: 'bx',
    splitType: 'equal', itineraryDayId: null, itineraryItemId: null, description: id, deletedAt: null, createdAt: 0, updatedAt: 0,
    daySpreadMode: spread ? 'equal' : null,
  } as Expense
}
function alloc(expenseId: string, date: string, amount: number): ExpenseDayAllocation {
  return { id: `${expenseId}-${date}`, householdId: 'h1', expenseId, tripId: 't1', date, amount, deletedAt: null }
}

const expenses = [
  exp('flight', '2026-04-06', 4302),
  exp('car', '2026-10-26', 1295.55, true),
  exp('hotel', '2026-10-26', 547.02, true),
  exp('etc', '2026-10-26', 474.38),
  exp('dinner', '2026-10-27', 427.18),
]
const allocations = [
  ...['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']
    .map((d, i) => alloc('car', d, i === 0 ? 161.97 : 161.94)),
  alloc('hotel', '2026-10-26', 273.51),
  alloc('hotel', '2026-10-27', 273.51),
]

describe('旅程回顾「最贵的一天」', () => {
  it('跨天的账按天分摊，只在行程日期内选（出发前订机票那天不算）', () => {
    expect(topSpendDay(expenses, allocations, '2026-10-21', '2026-11-06', [])).toEqual({ date: '2026-10-26', total: 909.86 })
  })

  it('分摊以后最贵的可能换成别的一天', () => {
    const more = [...expenses, exp('crab', '2026-10-27', 100)]
    // 10/27 = 427.18 + 100 + 161.94 + 273.51 = 962.63 > 10/26 的 909.86
    expect(topSpendDay(more, allocations, '2026-10-21', '2026-11-06', [])).toEqual({ date: '2026-10-27', total: 962.63 })
  })

  it('行程没设日期时退回按记账日期整笔算', () => {
    expect(topSpendDay(expenses, allocations, null, null, [{ date: '2026-04-06', total: 4302 }, { date: '2026-10-26', total: 2316.95 }]))
      .toEqual({ date: '2026-04-06', total: 4302 })
  })
})
