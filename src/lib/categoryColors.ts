import type { ExpenseCategory } from '../types'

export const CATEGORY_COLORS: Record<string, string> = {
  'cat-transport': '#0F766E',
  'cat-stay': '#7C3AED',
  'cat-food': '#C2410C',
  'cat-ticket': '#B45309',
  'cat-shop': '#BE123C',
  'cat-misc': '#57534E',
}

export function categoryColor(category: ExpenseCategory | null | undefined) {
  return (category && CATEGORY_COLORS[category.colorVar]) ?? '#57534E'
}
