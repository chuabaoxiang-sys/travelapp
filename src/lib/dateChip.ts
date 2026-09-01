import type { ResolvedLocale } from './locale'

const DOW_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

// 账目页日期条用的星期几/月-日格式，中英文各自的读法习惯差太多，不能只是
// 换个词——中文用"周五"+"9/4"，英文换成"Fri"+"Sep 4"，都是本地读者最熟悉
// 的紧凑写法
export function formatDateChipDow(date: string, locale: ResolvedLocale): string {
  const d = new Date(date + 'T00:00:00')
  if (locale === 'zh') return DOW_ZH[d.getDay()]
  return d.toLocaleDateString('en-US', { weekday: 'short' })
}

export function formatDateChipDate(date: string, locale: ResolvedLocale): string {
  if (locale === 'zh') {
    return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
  }
  const d = new Date(date + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
