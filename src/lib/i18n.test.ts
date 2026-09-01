import { describe, it, expect, beforeEach } from 'vitest'
import i18n from './i18n'

// 这份测试盯的是"复数规则真的生效了"这件事——用react-i18next而不是自己写一个
// t()，唯一的理由就是英文复数（"1 item" vs "2 items"）容易漏，所以这套机制
// 值得有测试兜着：i18next的复数是靠key后缀（_one/_other）匹配的，配置里
// JSON格式版本一旦变了就会静默退化成永远取单数，界面上不会报错、只是英文读着别扭
describe('i18next 复数规则', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('英文按数量选 _one / _other', () => {
    expect(i18n.t('split.byItem.settleSelected', { count: 1 })).toBe('Settle 1 item')
    expect(i18n.t('split.byItem.settleSelected', { count: 3 })).toBe('Settle 3 items')
  })

  it('英文里 0 走复数形式（不是单数）', () => {
    expect(i18n.t('split.balances.expenseCount', { count: 0 })).toBe('0 expenses')
  })

  it('中文只有一种形式，任何数量都取 _other', async () => {
    await i18n.changeLanguage('zh')
    expect(i18n.t('split.byItem.settleSelected', { count: 1 })).toBe('结算选中的 1 笔')
    expect(i18n.t('split.byItem.settleSelected', { count: 3 })).toBe('结算选中的 3 笔')
  })

  it('中英两份文案的key结构一致——漏翻的key会静默回落到中文，这里当护栏', async () => {
    // 拿英文桶里所有叶子key去中文桶里查，反过来也查一遍，两边对不上就是漏了
    const leaves = (obj: unknown, prefix = ''): string[] => {
      if (typeof obj !== 'object' || obj === null) return [prefix]
      return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
        leaves(v, prefix ? `${prefix}.${k}` : k),
      )
    }
    const en = leaves(i18n.getResourceBundle('en', 'translation')).sort()
    const zh = leaves(i18n.getResourceBundle('zh', 'translation')).sort()
    // 复数key在两种语言下后缀本来就不一样（英文有_one，中文没有），比较时先归一化掉
    const strip = (keys: string[]) => [...new Set(keys.map((k) => k.replace(/_(one|other)$/, '')))].sort()
    expect(strip(en)).toEqual(strip(zh))
  })
})
