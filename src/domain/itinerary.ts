import { db, ensureItineraryDay } from '../db/dexie'
import type { ItineraryItem } from '../types'

// 行程项的展示顺序：有具体时间的按时间排，没设时间的按创建时的 orderIndex 排在后面。
// ItineraryTab（时间线）和 CalendarView（日历）都要按这个顺序展示同一天的行程项——
// 两处如果各自排序容易不一致（之前就出现过：日历视图完全没排序，直接用 Dexie 查询
// 返回的原始顺序，导致相邻地点通勤提示这类"顺序敏感"的功能在日历视图里配对配错）
export function sortItineraryItems(items: ItineraryItem[]): ItineraryItem[] {
  return [...items].sort((a, b) => {
    if (!a.time && !b.time) return a.orderIndex - b.orderIndex
    if (!a.time) return 1
    if (!b.time) return -1
    return a.time.localeCompare(b.time)
  })
}

// 换日期前要先知道：这个行程项关联的账目是不是用了跨天分摊（daySpreadMode）。
// 是的话，换日期时不会顺手把账目也挪过去（分摊到哪几天背后往往有具体考量，
// 比如实际入住日期，自动平移容易猜错），调用方要在真正换之前先弹确认框
export async function hasLinkedDaySpreadExpense(itemId: string): Promise<boolean> {
  const expense = await db.expenses.where('itineraryItemId').equals(itemId).first()
  return !!expense?.daySpreadMode
}

// 把一个行程项换到另一天，返回新的 dayId 给调用方一起写进 itineraryItems.update。
// 顺带把关联的账目也挪过去——但只挪普通单日账目，跨天分摊的账目日期不动
// （调用前应该已经用 hasLinkedDaySpreadExpense 弹过确认框，这里不重复判断）
export async function resolveDayForItemMove(tripId: string, newDate: string, itemId: string): Promise<string> {
  const day = await ensureItineraryDay(tripId, newDate)
  const expense = await db.expenses.where('itineraryItemId').equals(itemId).first()
  if (expense && !expense.daySpreadMode) {
    await db.expenses.update(expense.id, { itineraryDayId: day.id, expenseDate: newDate, updatedAt: Date.now() })
  }
  return day.id
}
