import type { TFunction } from 'i18next'
import type { ExpenseCategory } from '../types'

// 10个系统预设分类的id是固定、跟语言无关的字面量（db/dexie.ts的DEFAULT_CATEGORIES），
// 这里只是把id去掉'seed-cat-'前缀映射成驼峰key去locales/*.json里查显示名。
// 用户在预算页自建的分类没有对应key，直接落到下面的.name分支——那是用户自己
// 打的字，不经过翻译层，保持原样
const SYSTEM_CATEGORY_KEYS: Record<string, string> = {
  'seed-cat-insurance': 'insurance',
  'seed-cat-flight': 'flight',
  'seed-cat-visa': 'visa',
  'seed-cat-stay-prepaid': 'stayPrepaid',
  'seed-cat-food': 'food',
  'seed-cat-transport': 'transport',
  'seed-cat-shopping': 'shopping',
  'seed-cat-ticket': 'ticket',
  'seed-cat-stay-onsite': 'stayOnsite',
  'seed-cat-misc': 'misc',
}

export function categoryLabel(category: ExpenseCategory | null | undefined, t: TFunction): string {
  if (!category) return ''
  const key = SYSTEM_CATEGORY_KEYS[category.id]
  return key ? t(`categories.${key}`) : category.name
}
