import { describe, it, expect, beforeEach } from 'vitest'
import i18n from '../lib/i18n'
import { buildSettlementText, type SettlementTextInput } from './settlementText'
import type { PersonBalance } from './splits'

const NAMES: Record<string, string> = { dad: '爸爸', mum: '妈妈', grey: '阿灰' }

function person(memberId: string, paid: number, owed: number, net: number): PersonBalance {
  return { memberId, paid, owed, settledOut: 0, settledIn: 0, net, expenseCount: 0 }
}

function input(over: Partial<SettlementTextInput> = {}): SettlementTextInput {
  return {
    tripName: '韩国行',
    currencySymbol: 'RM',
    balances: [person('grey', 300, 2800, -2500), person('dad', 4600, 2850, 1750), person('mum', 3500, 2750, 750)],
    transfers: [
      { from: 'grey', to: 'dad', amount: 1750 },
      { from: 'grey', to: 'mum', amount: 750 },
    ],
    settledCount: 0,
    nameOf: (id) => NAMES[id] ?? id,
    appHost: 'travelapp.example',
    ...over,
  }
}

describe('buildSettlementText', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh')
  })

  it('还有钱没结：列出转账、每人明细（按实际花费从高到低）和署名', () => {
    expect(buildSettlementText(input(), i18n.t)).toBe(
      [
        '【韩国行 · 结算】',
        '总支出 RM8,400 · 3 人',
        '',
        '还需转账：',
        '阿灰 → 爸爸 RM1,750',
        '阿灰 → 妈妈 RM750',
        '共 2 笔，已是最少转账次数。',
        '',
        '【每人明细】',
        '爸爸 实际花费 RM2,850（垫付 RM4,600 · 应收回 RM1,750）',
        '阿灰 实际花费 RM2,800（垫付 RM300 · 还需付 RM2,500）',
        '妈妈 实际花费 RM2,750（垫付 RM3,500 · 应收回 RM750）',
        '',
        '— 由「旅记」生成 travelapp.example',
      ].join('\n'),
    )
  })

  it('有按笔结算过的记录时注明另有几笔已结清', () => {
    expect(buildSettlementText(input({ settledCount: 3 }), i18n.t)).toContain('（另有 3 笔已结清）')
  })

  it('全部结清：转账部分换成两清，每人都是已两清；不到0.5的零头也算两清', () => {
    const text = buildSettlementText(
      input({
        balances: [person('dad', 100, 50, 0.3), person('mum', 0, 50, -0.3)],
        transfers: [],
        settledCount: 2,
      }),
      i18n.t,
    )
    expect(text).toContain('大家已经两清 🎉')
    expect(text).not.toContain('还需转账')
    expect(text).not.toContain('已结清）')
    expect(text).toContain('爸爸 实际花费 RM50（垫付 RM100 · 已两清）')
    expect(text).toContain('妈妈 实际花费 RM50（垫付 RM0 · 已两清）')
  })

  it('只记过结算、没有任何花费和垫付的人不出现在明细里，也不计入人数', () => {
    const text = buildSettlementText(input({ balances: [...input().balances, person('ghost', 0, 0, 0)] }), i18n.t)
    expect(text).toContain('· 3 人')
    expect(text).not.toContain('ghost')
  })

  it('用行程本位币的符号', () => {
    expect(buildSettlementText(input({ currencySymbol: 'SGD' }), i18n.t)).toContain('总支出 SGD8,400')
  })

  it('英文版本走英文文案和复数', async () => {
    await i18n.changeLanguage('en')
    const text = buildSettlementText(input({ transfers: [{ from: 'grey', to: 'dad', amount: 1750 }], settledCount: 1 }), i18n.t)
    expect(text).toContain('[韩国行 · Settle up]')
    expect(text).toContain('1 payment — that\'s the fewest possible.')
    expect(text).toContain('(1 payment already settled)')
    expect(text).toContain('爸爸: share RM2,850 (paid RM4,600 · gets back RM1,750)')
    expect(text).toContain('— Made with TripNotes travelapp.example')
  })
})
