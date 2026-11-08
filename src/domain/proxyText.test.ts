import { describe, it, expect, beforeEach } from 'vitest'
import i18n from '../lib/i18n'
import { buildProxyCopyText, proxyGroupTotals } from './proxyText'
import type { ProxyGroup, ProxyItem } from './proxies'

// 例子用东京北海道这趟的真实代购（Chi Hui 还没还、Chi En 已还少还了一点、妈妈是送的）
function item(over: Partial<ProxyItem>): ProxyItem {
  return {
    splitId: crypto.randomUUID(), name: 'Chi Hui', expenseId: 'e', expenseDate: '2026-10-31', description: 'Mega Donki',
    currency: 'JPY', amount: 1000, shareAmount: 26.33, costAmount: 22, creditorId: 'bx', repaidAt: null,
    repaidAmount: null, giftMemberIds: null, received: 26.33, ...over,
  }
}

function group(items: ProxyItem[], over: Partial<ProxyGroup> = {}): ProxyGroup {
  return { key: 'k', name: items[0].name, creditorId: 'bx', items, total: items.reduce((s, i) => s + i.received, 0), repaidAt: null, ...over }
}

const chiHui = group([
  item({ expenseDate: '2026-10-31', description: 'Mega Donki', amount: 10044, shareAmount: 264.49, received: 264.49 }),
  item({ expenseDate: '2026-10-31', description: 'Mega Donki', amount: 10234, shareAmount: 269.5, received: 269.5 }),
  item({ expenseDate: '2026-11-04', description: 'Mega Donki Sapporo', amount: 3738, shareAmount: 98.63, received: 98.63 }),
  item({ expenseDate: '2026-11-05', description: '狸小路 松本清药妆', amount: 2784, shareAmount: 73.12, received: 73.12 }),
])

const base = { tripName: '东京北海道 2026', homeCurrency: 'MYR', payerName: 'BX', giftNames: '' }

describe('代购明细的合计', () => {
  it('外币合计、本位币合计、平均汇率（本位币合计 ÷ 外币合计，4 位有效数字）', () => {
    expect(proxyGroupTotals(chiHui.items, 'unpaid', 'MYR')).toEqual({ foreign: [{ currency: 'JPY', amount: 26800 }], home: 705.74, avgRate: 0.02633 })
  })

  it('跨几种外币：分别列出，不写汇率', () => {
    const t = proxyGroupTotals([item({ amount: 1000, shareAmount: 26 }), item({ currency: 'KRW', amount: 50000, shareAmount: 160 })], 'unpaid', 'MYR')
    expect(t.foreign).toEqual([{ currency: 'JPY', amount: 1000 }, { currency: 'KRW', amount: 50000 }])
    expect(t.avgRate).toBeNull()
  })

  it('送的那组按成本算本位币', () => {
    expect(proxyGroupTotals([item({ costAmount: 25.68 }), item({ costAmount: 74.31 })], 'gifted', 'MYR').home).toBe(99.99)
  })
})

describe('一键复制的文字', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh')
  })

  it('还没还：每一笔 → 该还的 RM，合计带外币和平均汇率，最后请还给付款人', () => {
    expect(buildProxyCopyText({ ...base, group: chiHui, kind: 'unpaid' }, i18n.t)).toBe([
      '【帮 Chi Hui 代购 · 东京北海道 2026】',
      '10/31 Mega Donki · JPY 10,044 → RM264.49',
      '10/31 Mega Donki · JPY 10,234 → RM269.50',
      '11/04 Mega Donki Sapporo · JPY 3,738 → RM98.63',
      '11/05 狸小路 松本清药妆 · JPY 2,784 → RM73.12',
      '合计 JPY 26,800 → RM705.74（平均汇率 0.02633）',
      '请还给 BX',
    ].join('\n'))
  })

  it('已还：合计是该还的，最后写哪天实际还了多少', () => {
    const repaidAt = new Date(2026, 10, 8, 12).getTime()
    const g = group([
      item({ name: 'Chi En', expenseDate: '2026-10-25', description: 'Bic Camera 免税', amount: 7300, shareAmount: 195.33, received: 194.18, repaidAt }),
      item({ name: 'Chi En', expenseDate: '2026-10-30', description: 'Sapporo Drug Store', amount: 1700, shareAmount: 44.77, received: 44.51, repaidAt }),
      item({ name: 'Chi En', expenseDate: '2026-10-31', description: 'Mega Donki', amount: 598, shareAmount: 15.75, received: 15.66, repaidAt }),
    ], { repaidAt })
    const text = buildProxyCopyText({ ...base, group: g, kind: 'repaid' }, i18n.t)
    expect(text).toContain('合计 JPY 9,598 → RM255.85（平均汇率 0.02666）')
    expect(text.split('\n').at(-1)).toBe('11/08 已还 RM254.35')
  })

  it('送的：中文名不加空格，只写外币，最后写谁送的、不用还', () => {
    const g = group([
      item({ name: '妈妈', expenseDate: '2026-10-25', description: 'Bic Camera 免税', amount: 1100, costAmount: 25.68, received: 0 }),
      item({ name: '妈妈', expenseDate: '2026-10-30', description: 'Sapporo Drug Store', amount: 3120, costAmount: 74.31, received: 0 }),
    ])
    expect(buildProxyCopyText({ ...base, group: g, kind: 'gifted', giftNames: 'BX、KN' }, i18n.t)).toBe([
      '【帮妈妈代购 · 东京北海道 2026】',
      '10/25 Bic Camera 免税 · JPY 1,100',
      '10/30 Sapporo Drug Store · JPY 3,120',
      '合计 JPY 4,220',
      '这些是 BX、KN 送的，不用还',
    ].join('\n'))
  })

  it('本位币买的代购：不重复写 MYR → RM', () => {
    const g = group([item({ currency: 'MYR', amount: 50, shareAmount: 50, received: 50, description: '机场免税店' })])
    const text = buildProxyCopyText({ ...base, group: g, kind: 'unpaid' }, i18n.t)
    expect(text).toContain('10/31 机场免税店 · RM50')
    expect(text).toContain('合计 RM50')
  })

  it('英文版', async () => {
    await i18n.changeLanguage('en')
    const text = buildProxyCopyText({ ...base, group: chiHui, kind: 'unpaid' }, i18n.t)
    expect(text.split('\n')[0]).toBe('[Bought for Chi Hui · 东京北海道 2026]')
    expect(text).toContain('Total JPY 26,800 → RM705.74 (average rate 0.02633)')
    expect(text.split('\n').at(-1)).toBe('Please pay back BX')
  })
})
