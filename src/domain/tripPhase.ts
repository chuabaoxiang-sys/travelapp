// 出发前 / 旅途中 / 回家后——「概览」tab 靠这个决定显示哪一种版式。
//
// 判定规则跟 dailyAllowance.ts 里"今天算不算这趟行程里的一天"用的是同一条：
// 今天 < 出发日 → 出发前；出发日 ≤ 今天 ≤ 结束日 → 旅途中；今天 > 结束日 → 回家后。
// 行程没设日期时退回"出发前"——这是这里唯一新加的兜底：一趟还没定日期的行程，
// 用"准备阶段"的版式（讲的是"有没有排安排"而不是"还剩几天"）远比硬凑一个"旅途中"
// 或者"回家后"更说得通。
export type TripPhase = 'before' | 'during' | 'after'

export function resolveTripPhase(todayISO: string, startDate: string | null, endDate: string | null): TripPhase {
  if (!startDate || !endDate) return 'before'
  if (todayISO < startDate) return 'before'
  if (todayISO > endDate) return 'after'
  return 'during'
}

// 距离出发还有几天。只在 'before' 阶段有意义，调用方自己判断阶段后再用。
// 用日期字符串直接比较文本会得到错的天数（'2026-9-1' vs '2026-09-01' 这类），
// 所以还是老老实实转成时间戳做减法，按 UTC 解析避免本地时区把日期偏掉一天
export function daysUntil(todayISO: string, startDate: string): number {
  const from = Date.parse(`${todayISO}T00:00:00Z`)
  const to = Date.parse(`${startDate}T00:00:00Z`)
  if (Number.isNaN(from) || Number.isNaN(to)) return 0
  return Math.round((to - from) / 86_400_000)
}

// 今天是这趟行程的第几天。只在 'during' 阶段有意义。
export function currentDayIndex(todayISO: string, startDate: string): number {
  return daysUntil(startDate, todayISO) + 1
}
