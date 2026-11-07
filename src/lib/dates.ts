// Postgres 的 time 列经 PostgREST 返回时带秒（HH:MM:SS），本地 TimePicker 只产出
// HH:MM——统一在这里截断，不管数据来自哪一路径，显示出来的都是 HH:MM
export function formatTimeHM(time: string | null | undefined) {
  return time ? time.slice(0, 5) : ''
}

export function toLocalDateString(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 两个 'YYYY-MM-DD' 之间有几天，含头含尾（同一天算 1 天）。
// 按 UTC 解析而不是本地时间：这两个值本来就是纯日期、不带时区含义，用本地时间解析
// 会在夏令时切换那几天多算或少算一天。
export function daysInclusive(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T00:00:00Z`)
  const to = Date.parse(`${toISO}T00:00:00Z`)
  if (Number.isNaN(from) || Number.isNaN(to)) return 0
  return Math.max(0, Math.floor((to - from) / 86_400_000) + 1)
}

export function dateRange(start: string, end: string) {
  const dates: string[] = []
  const cur = new Date(start + 'T00:00:00')
  const last = new Date(end + 'T00:00:00')
  while (cur <= last) {
    dates.push(toLocalDateString(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

// 打开「行程」页、记一笔新账时默认停在哪一天（2026-11-07，用户旅行回来反馈：
// 旅途中每次打开都停在第一天、记账日期每次都是出发那天，要手动翻到今天）：
//   - 行程进行中（今天在出发日到结束日之间）→ 今天
//   - 还没出发 → 第一天
//   - 已经结束 → 最后一天（回来补记、翻看，最近的记忆在最后几天）
//   - 行程没设日期 → 今天
// today 由调用方传进来（手机本地日期，不是 UTC），方便测试
export function defaultTripDate(trip: { startDate: string | null; endDate: string | null }, today: string): string {
  const { startDate, endDate } = trip
  if (!startDate || !endDate) return today
  if (today < startDate) return startDate
  if (today > endDate) return endDate
  return today
}

export function todayLocal(): string {
  return toLocalDateString(new Date())
}
