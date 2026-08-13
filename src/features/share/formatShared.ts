const DOW = ['日', '一', '二', '三', '四', '五', '六']

// dayDate 是 ISO 日期字符串（如 "2026-10-20"），这几个格式化函数供分享页各模板复用，
// 避免每个模板文件里各写一份日期拼接逻辑
export function formatMD(dayDate: string): string {
  const [, m, d] = dayDate.split('-').map((s) => parseInt(s, 10))
  return `${m}月${d}日`
}

export function formatDotDate(dayDate: string): string {
  const [, m, d] = dayDate.split('-')
  return `${parseInt(m, 10)}.${d}`
}

export function formatDow(dayDate: string): string {
  const date = new Date(dayDate + 'T00:00:00')
  return `周${DOW[date.getDay()]}`
}

export function formatDayNum(index: number): string {
  return String(index + 1).padStart(2, '0')
}
