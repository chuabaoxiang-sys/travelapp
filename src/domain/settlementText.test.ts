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

  it('还有钱没结：列出转账、每人明细（按应分摊从高到低，两行：应分摊 + 能对上的式子）和署名', () => {
    expect(buildSettlementText(input(), i18n.t)).toBe(
      [
        '【韩国行 · 结算】',
        '旅伴花费 RM8,400 · 3 人',
        '',
        '还需转账：',
        '阿灰 → 爸爸 RM1,750',
        '阿灰 → 妈妈 RM750',
        '共 2 笔，已是最少转账次数。',
        '',
        '【每人明细】',
        '爸爸 应分摊 RM2,850',
        '  垫付 RM4,600 → 应收回 RM1,750',
        '阿灰 应分摊 RM2,800',
        '  垫付 RM300 → 还需付 RM2,500',
        '妈妈 应分摊 RM2,750',
        '  垫付 RM3,500 → 应收回 RM750',
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
    expect(text).toContain('爸爸 应分摊 RM50\n  垫付 RM100 → 已两清')
    expect(text).toContain('妈妈 应分摊 RM50\n  垫付 RM0 → 已两清')
  })

  it('只记过结算、没有任何花费和垫付的人不出现在明细里，也不计入人数', () => {
    const text = buildSettlementText(input({ balances: [...input().balances, person('ghost', 0, 0, 0)] }), i18n.t)
    expect(text).toContain('· 3 人')
    expect(text).not.toContain('ghost')
  })

  it('用行程本位币的符号', () => {
    expect(buildSettlementText(input({ currencySymbol: 'SGD' }), i18n.t)).toContain('旅伴花费 SGD8,400')
  })

  it('英文版本走英文文案和复数', async () => {
    await i18n.changeLanguage('en')
    const text = buildSettlementText(input({ transfers: [{ from: 'grey', to: 'dad', amount: 1750 }], settledCount: 1 }), i18n.t)
    expect(text).toContain('[韩国行 · Settle up]')
    expect(text).toContain('1 payment — that\'s the fewest possible.')
    expect(text).toContain('(1 payment already settled)')
    expect(text).toContain('爸爸: share RM2,850\n  paid RM4,600 → gets back RM1,750')
    expect(text).toContain('— Made with TripNotes travelapp.example')
  })

  it('东京北海道这趟的情况：已结清、代购、退税都写出来，每人那条式子加减得通', () => {
    // BX 垫了全部（另垫代购 RM1,015.79），KN 已经转了 RM10,000；机场现金退税 RM53.26 算 KN 的
    // 但在 BX 手上，Global Blue RM35.33 是 BX 自己的
    const bx: PersonBalance = {
      memberId: 'bx', paid: 20711.48, owed: 10604.42, settledOut: 0, settledIn: 10000, expenseCount: 160,
      refundHeld: 88.59, refundShare: 35.33, proxyFronted: 1015.79, net: 53.8,
    }
    const kn: PersonBalance = {
      memberId: 'kn', paid: 0, owed: 10107.06, settledOut: 10000, settledIn: 0, expenseCount: 0,
      refundHeld: 0, refundShare: 53.26, proxyFronted: 0, net: -53.8,
    }
    for (const b of [bx, kn]) {
      expect(Math.round((b.paid - b.owed + b.settledOut - b.settledIn - b.refundHeld! + b.refundShare!) * 100) / 100).toBe(b.net)
    }
    const text = buildSettlementText(input({
      tripName: '东京北海道 2026', balances: [kn, bx], transfers: [{ from: 'kn', to: 'bx', amount: 53.8 }],
      nameOf: (id) => id.toUpperCase(),
    }), i18n.t)
    expect(text).toContain('旅伴花费 RM20,711.48 · 2 人')
    expect(text).toContain([
      'BX 应分摊 RM10,604.42',
      '  垫付 RM20,711.48（另垫了代购 RM1,015.79） · 已收 RM10,000 · 代收退税 RM88.59 · 分到退税 RM35.33 → 应收回 RM53.80',
      'KN 应分摊 RM10,107.06',
      '  垫付 RM0 · 已付 RM10,000 · 分到退税 RM53.26 → 还需付 RM53.80',
    ].join('\n'))
  })

  it('只有退税、没有花费和垫付的人也列出来', () => {
    const text = buildSettlementText(input({
      balances: [...input().balances, { memberId: 'ghost', paid: 0, owed: 0, settledOut: 0, settledIn: 0, expenseCount: 0, refundShare: 10, refundHeld: 0, net: 10 }],
    }), i18n.t)
    expect(text).toContain('ghost 应分摊 RM0\n  垫付 RM0 · 分到退税 RM10 → 应收回 RM10')
  })
  it('还有刷卡没补实际扣款：转账列表下面注明金额是估算', async () => {
    await i18n.changeLanguage('zh')
    const text = buildSettlementText(input({ pendingEstimateCount: 1 }), i18n.t)
    expect(text).toContain('共 2 笔，已是最少转账次数。\n（其中有 1 笔刷卡还没补实际扣款，金额是估算，补完后可能会变）')
    expect(buildSettlementText(input(), i18n.t)).not.toContain('估算')
  })
})
