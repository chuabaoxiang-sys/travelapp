import type { ExpenseCategory } from '../types'

// 之前这里直接写死了跟 src/index.css 里 --color-cat-* 数值一样的十六进制——
// 两份数据长得一样纯属巧合，深色模式一上线立刻穿帮：这里返回的是绝对颜色，
// 不会跟着 index.css 里定义的深色变量走。改成直接返回 CSS 变量引用，
// 分类色的"这个值具体是多少"从此只有 index.css 一个真相来源
export const CATEGORY_COLORS: Record<string, string> = {
  'cat-flight': 'var(--color-cat-flight)',
  'cat-transport': 'var(--color-cat-transport)',
  'cat-stay': 'var(--color-cat-stay)',
  'cat-food': 'var(--color-cat-food)',
  'cat-ticket': 'var(--color-cat-ticket)',
  'cat-shop': 'var(--color-cat-shop)',
  'cat-misc': 'var(--color-cat-misc)',
}

export function categoryColor(category: ExpenseCategory | null | undefined) {
  return (category && CATEGORY_COLORS[category.colorVar]) ?? 'var(--color-cat-misc)'
}
