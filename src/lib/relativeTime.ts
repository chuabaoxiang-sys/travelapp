import type { TFunction } from 'i18next'

// 同步详情和行程动态都要把一个时间戳念成"3分钟前"这种相对时间，抽成共用函数
// 避免两处各写一份、翻译改了一边忘了另一边
export function relativeTime(at: number, now: number, t: TFunction): string {
  const diffMin = Math.round((now - at) / 60_000)
  if (diffMin < 1) return t('common.justNow')
  if (diffMin < 60) return t('common.minutesAgo', { count: diffMin })
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return t('common.hoursAgo', { count: diffHr })
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 30) return t('common.daysAgo', { count: diffDay })
  return new Date(at).toISOString().slice(0, 10)
}
