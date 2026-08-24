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
