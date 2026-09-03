const DOW_ZH = ['日', '一', '二', '三', '四', '五', '六']
const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// dayDate 是 ISO 日期字符串（如 "2026-10-20"），这几个格式化函数供分享页各模板复用，
// 避免每个模板文件里各写一份日期拼接逻辑。分享页模板是纯函数组件而非React组件本身
// 调translation hook的场景，所以跟categoryLabel(cat, t)一样，显式传locale而不是在
// 这里自己调useTranslation()
export function formatMD(dayDate: string, locale: string): string {
  const [, m, d] = dayDate.split('-').map((s) => parseInt(s, 10))
  if (locale === 'en') return `${MONTH_EN[m - 1]} ${d}`
  return `${m}月${d}日`
}

export function formatDotDate(dayDate: string): string {
  const [, m, d] = dayDate.split('-')
  return `${parseInt(m, 10)}.${d}`
}

export function formatDow(dayDate: string, locale: string): string {
  const date = new Date(dayDate + 'T00:00:00')
  if (locale === 'en') return DOW_EN[date.getDay()]
  return `周${DOW_ZH[date.getDay()]}`
}

export function formatDayNum(index: number): string {
  return String(index + 1).padStart(2, '0')
}
