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
