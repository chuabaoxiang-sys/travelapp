import { describe, it, expect, beforeEach, vi } from 'vitest'
import i18n from '../lib/i18n'
import { db } from '../db/dexie'
import { computeBalances, owedAfterWaive, simplifyDebts } from './splits'
import { createSettlement } from './settlements'
import { buildSettlementText } from './settlementText'
import type { Expense, ExpenseSplit } from '../types'

vi.mock('./household', () => ({ getCurrentHouseholdId: async () => 'h1', getCachedHouseholdIdSync: () => 'h1' }))

// 结算「免了」（0054，2026-11-10）：真实情况是 KN 要还 BX RM53.58，BX 不要 KN 还
function expense(id: string, home: number): Expense {
  return {
    id, householdId: 'h1', tripId: 't1', categoryId: 'cat-food', phase: 'during_trip', description: id,
    expenseCurrency: 'MYR', expenseAmount: home, rateBookEntryId: null, rateUsed: 1, homeAmount: home,
    paidBy: 'bx', recordedBy: 'bx', expenseDate: '2026-10-31', itineraryDayId: null, itineraryItemId: null,
    splitType: 'equal', deletedAt: null, createdAt: 0, updatedAt: 0,
  } as Expense
}
function split(expenseId: string, memberId: string, shareAmount: number): ExpenseSplit {
  return { id: `${expenseId}-${memberId}`, householdId: 'h1', expenseId, memberId, shareAmount, deletedAt: null }
}

beforeEach(async () => {
  await Promise.all([db.expenses.clear(), db.expenseSplits.clear(), db.settlements.clear(), db.taxRefunds.clear(), db.outbox.clear()])
  await db.expenses.add(expense('e1', 107.16))
  await db.expenseSplits.bulkAdd([split('e1', 'bx', 53.58), split('e1', 'kn', 53.58)])
  await i18n.changeLanguage('zh')
})

describe('结算「免了」', () => {
  it('免了整笔：两人都两清，不算已付/已收；账面应分摊不变，免了之后 KN 少 53.58、BX 多 53.58', async () => {
    await createSettlement({ tripId: 't1', fromMemberId: 'kn', toMemberId: 'bx', amount: 53.58, settledDate: '2026-11-10', note: null, waived: true })
    const b = await computeBalances('t1')
    const kn = b.find((x) => x.memberId === 'kn')!
    const bx = b.find((x) => x.memberId === 'bx')!
    expect(kn.net).toBe(0)
    expect(bx.net).toBe(0)
    expect([kn.settledOut, bx.settledIn]).toEqual([0, 0])
    expect([kn.owed, bx.owed]).toEqual([53.58, 53.58])
    expect([owedAfterWaive(kn), owedAfterWaive(bx)]).toEqual([0, 107.16])
    expect(kn.waivedInFrom).toEqual(['bx'])
    expect(bx.waivedOutTo).toEqual(['kn'])
    expect(simplifyDebts(b)).toEqual([])
  })

  it('只免一部分：剩下的照样要还', async () => {
    await createSettlement({ tripId: 't1', fromMemberId: 'kn', toMemberId: 'bx', amount: 3.58, settledDate: '2026-11-10', note: null, waived: true })
    const b = await computeBalances('t1')
    expect(b.find((x) => x.memberId === 'kn')!.net).toBe(-50)
    expect(simplifyDebts(b)).toEqual([{ from: 'kn', to: 'bx', amount: 50 }])
  })

  it('复制出去的文字：应分摊写免了之后的，括号写清楚，旅伴花费合计不变', async () => {
    await createSettlement({ tripId: 't1', fromMemberId: 'kn', toMemberId: 'bx', amount: 53.58, settledDate: '2026-11-10', note: null, waived: true })
    const balances = await computeBalances('t1')
    const text = buildSettlementText({
      tripName: '东京北海道 2026', currencySymbol: 'RM', balances, transfers: [], settledCount: 1,
      nameOf: (id) => id.toUpperCase(), appHost: 'x',
    }, i18n.t)
    expect(text).toContain('旅伴花费 RM107.16')
    expect(text).toContain('BX 应分摊 RM107.16（免了 KN RM53.58）')
    expect(text).toContain('KN 应分摊 RM0（BX 免了 RM53.58）')
  })
})
