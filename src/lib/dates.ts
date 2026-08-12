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
