import { toLocalDateString } from '../lib/dates'
import type { Trip, TripStatus } from '../types'

// "规划中/进行中/已结束"以前是创建行程那一刻算好、写死存进数据库的一次性快照，
// 之后永远不会再变——行程明明早就结束了几个月，状态还是显示"进行中"。改成每次
// 显示时用当前日期实时算，不再依赖存进数据库的 status 字段作为展示的真相来源
// （那个字段继续保留，只是不再直接拿来显示）。
// "已归档"目前没有任何地方会真的把行程设成这个状态（没有对应的手动操作入口），
// 这里先保留识别（不覆盖它），但不处理"怎么让行程变成已归档"，用户明确要求暂不管
export function computeTripStatus(trip: Pick<Trip, 'status' | 'startDate' | 'endDate'>, today: Date = new Date()): TripStatus {
  if (trip.status === 'archived') return 'archived'
  if (!trip.startDate) return 'planning'
  const todayStr = toLocalDateString(today)
  if (todayStr < trip.startDate) return 'planning'
  if (trip.endDate && todayStr > trip.endDate) return 'completed'
  return 'active'
}
