import type { SatisfactionRating } from '../../types'

// 值/一般/后悔三种评价共用的颜色+旋转角度+印章短词——账目盖章
// (SatisfactionStampBadge.tsx的Stamp组件)和翻卡回顾选评分/落章动效
// (SatisfactionFlipDeck.tsx)都从这里取值，同一套视觉在两个地方各自
// 实现一遍容易慢慢跑偏，所以抽出来共用。单独一个文件而不是塞进
// SatisfactionStampBadge.tsx，是因为那边还要导出Stamp/SatisfactionStampBadge
// 两个组件，一个文件里混着导出组件和普通常量会破坏Fast Refresh（这个项目
// 里categoryVisuals/heroRawValue的拆分是同一个原因）
export const RATING_COLOR: Record<SatisfactionRating, string> = {
  worth: 'var(--color-positive)',
  neutral: 'var(--color-muted)',
  regret: 'var(--color-negative)',
}
export const RATING_ROTATE: Record<SatisfactionRating, string> = { worth: '-9deg', neutral: '6deg', regret: '-4deg' }
// 章上刻的字要够短才塞得进一个40px的小圆章——跟按钮下面的完整文案
// （t('satisfaction.ratingWorth')="Worth it"这类，给提示文字/曲线轴标签用，
// 空间够）是两套不同用途的文案，不能共用同一个key
export const RATING_STAMP_KEY: Record<SatisfactionRating, string> = {
  worth: 'satisfaction.stampWorth',
  neutral: 'satisfaction.stampNeutral',
  regret: 'satisfaction.stampRegret',
}
