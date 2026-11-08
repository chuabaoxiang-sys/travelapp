import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../db/dexie'
import {
  computeRefundHomeAmount, deleteTaxRefund, markRefundArrived, pickDefaultRefundRate, refundShares, refundSummary,
  saveTaxRefund, type TaxRefundInput,
} from './taxRefunds'
import { computeBalances } from './splits'
import { actualSpend } from './cashback'
import { SYNC_CONFIG } from '../db/syncMapping'
import type { RateBookEntry, TaxRefund } from '../types'

vi.mock('./household', () => ({ getCurrentHouseholdId: async () => 'h1', getCachedHouseholdIdSync: () => 'h1' }))

// 例子照用户真实情况：机场现金退税 ¥8,000（钱在 BX 手上），网上退到 BX 的卡 ¥12,500 还没到账；
// 两笔都是 BX、KN 平分
function input(over: Partial<TaxRefundInput> = {}): TaxRefundInput {
  return {
    tripId: 't1', homeCurrency: 'MYR', method: 'cash', currency: 'JPY', foreignAmount: 8000, rate: 0.0266,
    pending: false, actualHomeAmount: null, memberIds: ['bx', 'kn'], receivedBy: 'bx', refundDate: '2026-11-06',
    note: null, rateBookLabel: '现金退税', createdBy: 'bx', ...over,
  }
}

function rateEntry(over: Partial<RateBookEntry>): RateBookEntry {
  return {
    id: 'r1', householdId: 'h1', tripId: 't1', foreignCurrency: 'JPY', label: '出发前网上换的现金', rate: 0.0266,
    source: 'manual', createdBy: 'bx', lastUsedAt: 1, archived: false, createdAt: 1, exchangedHomeAmount: 2660,
    exchangedForeignAmount: 100000, ...over,
  }
}

beforeEach(async () => {
  await Promise.all([db.taxRefunds.clear(), db.rateBookEntries.clear(), db.expenses.clear(), db.expenseSplits.clear(), db.settlements.clear(), db.outbox.clear()])
})

describe('退税怎么分', () => {
  it('平分，零头给第一个人，合计刚好', () => {
    expect(refundShares({ homeAmount: 100, memberIds: ['a', 'b', 'c'] })).toEqual([
      { memberId: 'a', amount: 33.34 }, { memberId: 'b', amount: 33.33 }, { memberId: 'c', amount: 33.33 },
    ])
  })

  it('合计、待到账、每人分到、谁手上收着', () => {
    const rows = [
      { homeAmount: 212.8, pending: false, memberIds: ['bx', 'kn'], receivedBy: 'bx', deletedAt: null },
      { homeAmount: 332.5, pending: true, memberIds: ['bx', 'kn'], receivedBy: 'bx', deletedAt: null },
      { homeAmount: 50, pending: false, memberIds: ['kn'], receivedBy: 'kn', deletedAt: 1 },
    ] as TaxRefund[]
    const s = refundSummary(rows)
    expect(s.total).toBe(545.3)
    expect(s.pendingTotal).toBe(332.5)
    expect(s.shareByMember.get('kn')).toBe(272.65)
    expect(s.heldByMember.get('bx')).toBe(545.3)
    expect(s.heldByMember.get('kn')).toBeUndefined()
  })

  it('本位币金额：现金/待到账按汇率算，退到卡已到账用实际金额', () => {
    expect(computeRefundHomeAmount({ method: 'cash', foreignAmount: 8000, rate: 0.0266, pending: false, actualHomeAmount: null })).toBe(212.8)
    expect(computeRefundHomeAmount({ method: 'card', foreignAmount: 12500, rate: 0.0266, pending: true, actualHomeAmount: null })).toBe(332.5)
    expect(computeRefundHomeAmount({ method: 'card', foreignAmount: 12500, rate: 0.0266, pending: false, actualHomeAmount: 329.1 })).toBe(329.1)
  })

  it('实际花费再扣退税', () => {
    expect(actualSpend(21727.27, 1162.09, 101.87, 545.3)).toBe(19918.01)
    expect(actualSpend(100, 0, 0)).toBe(100)
  })
})

describe('汇率默认值：这趟这种外币现金的汇率', () => {
  it('优先真的换过钱的那批（最近建的），不拿退税自己那条当参考', () => {
    const entries = [
      rateEntry({ id: 'old', rate: 0.027, createdAt: 1 }),
      rateEntry({ id: 'new', rate: 0.0266, createdAt: 5 }),
      rateEntry({ id: 'refund', rate: 0.03, createdAt: 9 }),
      rateEntry({ id: 'manual', rate: 0.031, exchangedForeignAmount: null, exchangedHomeAmount: null, lastUsedAt: 99 }),
      rateEntry({ id: 'krw', foreignCurrency: 'KRW', rate: 0.003, createdAt: 10 }),
    ]
    expect(pickDefaultRefundRate(entries, 'JPY', new Set(['refund']))?.id).toBe('new')
  })

  it('没有换过钱的就取最近用过的；什么都没有就 null', () => {
    const entries = [rateEntry({ id: 'a', exchangedForeignAmount: null, lastUsedAt: 1 }), rateEntry({ id: 'b', exchangedForeignAmount: null, lastUsedAt: 5 })]
    expect(pickDefaultRefundRate(entries, 'JPY', new Set())?.id).toBe('b')
    expect(pickDefaultRefundRate(entries, 'KRW', new Set())).toBeNull()
  })
})

describe('记退税（真实走 Dexie）', () => {
  it('JPY 现金退税：同时在汇率簿建一条，"已换"就是退回来的日元', async () => {
    const id = await saveTaxRefund(input({ note: '机场现金退税' }))
    const r = (await db.taxRefunds.get(id))!
    expect(r).toMatchObject({ method: 'cash', foreignAmount: 8000, homeAmount: 212.8, pending: false, receivedBy: 'bx' })
    const entry = (await db.rateBookEntries.get(r.rateBookEntryId!))!
    expect(entry).toMatchObject({ label: '机场现金退税', foreignCurrency: 'JPY', rate: 0.0266, exchangedForeignAmount: 8000, exchangedHomeAmount: 212.8, archived: false })
  })

  it('改金额：汇率簿那条跟着改，不会多建一条', async () => {
    const id = await saveTaxRefund(input())
    await saveTaxRefund(input({ foreignAmount: 9000 }), id)
    expect(await db.rateBookEntries.count()).toBe(1)
    expect((await db.rateBookEntries.toArray())[0].exchangedForeignAmount).toBe(9000)
    expect((await db.taxRefunds.get(id))!.homeAmount).toBe(239.4)
  })

  it('退到卡、本位币现金：不进汇率簿；从现金改成退到卡时，没用过的那条汇率删掉', async () => {
    const cardId = await saveTaxRefund(input({ method: 'card', foreignAmount: 12500, pending: true }))
    expect((await db.taxRefunds.get(cardId))!).toMatchObject({ pending: true, homeAmount: 332.5, rateBookEntryId: null })
    await saveTaxRefund(input({ currency: 'MYR', foreignAmount: 50, rate: 1 }))
    expect(await db.rateBookEntries.count()).toBe(0)

    const cashId = await saveTaxRefund(input())
    expect(await db.rateBookEntries.count()).toBe(1)
    await saveTaxRefund(input({ method: 'card', pending: true }), cashId)
    expect(await db.rateBookEntries.count()).toBe(0)
    expect((await db.taxRefunds.get(cashId))!.rateBookEntryId).toBeNull()
  })

  it('现金退税改成"待到账"不成立：只有退到卡才会是估算', async () => {
    const id = await saveTaxRefund(input({ pending: true }))
    expect((await db.taxRefunds.get(id))!.pending).toBe(false)
  })

  it('到账了：估算换成实际金额', async () => {
    const id = await saveTaxRefund(input({ method: 'card', foreignAmount: 12500, pending: true }))
    await markRefundArrived(id, 329.1)
    expect((await db.taxRefunds.get(id))!).toMatchObject({ pending: false, homeAmount: 329.1 })
  })

  it('删退税：汇率没被用过就一起删；已经拿这笔日元记过账了就只停用', async () => {
    const unused = await saveTaxRefund(input())
    expect(await deleteTaxRefund(unused)).toBe('deleted')
    expect(await db.rateBookEntries.count()).toBe(0)
    expect((await db.taxRefunds.get(unused))!.deletedAt).not.toBeNull()

    const used = await saveTaxRefund(input())
    const rateId = (await db.taxRefunds.get(used))!.rateBookEntryId!
    await db.expenses.add({
      id: 'lunch', householdId: 'h1', tripId: 't1', categoryId: 'c', expenseDate: '2026-11-07', phase: 'during_trip',
      expenseCurrency: 'JPY', expenseAmount: 3000, rateBookEntryId: rateId, rateUsed: 0.0266, homeAmount: 79.8,
      paidBy: 'bx', recordedBy: 'bx', splitType: 'equal', itineraryDayId: null, itineraryItemId: null, description: null,
      deletedAt: null, createdAt: 0, updatedAt: 0,
    } as never)
    expect(await deleteTaxRefund(used)).toBe('archived')
    expect((await db.rateBookEntries.get(rateId))!.archived).toBe(true)
  })
})

describe('退税进结算（真实走 Dexie）', () => {
  it('BX 收着 ¥8,000（RM212.80），BX、KN 平分：KN 该收 RM106.40，BX 该付 RM106.40', async () => {
    await saveTaxRefund(input())
    const balances = await computeBalances('t1')
    const bx = balances.find((b) => b.memberId === 'bx')!
    const kn = balances.find((b) => b.memberId === 'kn')!
    expect(kn.net).toBe(106.4)
    expect(bx.net).toBe(-106.4)
    expect(bx).toMatchObject({ paid: 0, owed: 0, refundHeld: 212.8, refundShare: 106.4 })
    expect(kn).toMatchObject({ refundShare: 106.4, refundHeld: 0 })
  })

  it('跟例子一样：BX 用这笔日元请两人吃饭，KN 那份饭钱正好被退税抵掉', async () => {
    await saveTaxRefund(input())
    await db.expenses.add({
      id: 'lunch', householdId: 'h1', tripId: 't1', categoryId: 'c', expenseDate: '2026-11-07', phase: 'during_trip',
      expenseCurrency: 'JPY', expenseAmount: 8000, rateBookEntryId: null, rateUsed: 0.0266, homeAmount: 212.8,
      paidBy: 'bx', recordedBy: 'bx', splitType: 'equal', itineraryDayId: null, itineraryItemId: null, description: null,
      deletedAt: null, createdAt: 0, updatedAt: 0,
    } as never)
    await db.expenseSplits.bulkAdd([
      { id: 's1', householdId: 'h1', expenseId: 'lunch', memberId: 'bx', shareAmount: 106.4, deletedAt: null },
      { id: 's2', householdId: 'h1', expenseId: 'lunch', memberId: 'kn', shareAmount: 106.4, deletedAt: null },
    ])
    const balances = await computeBalances('t1')
    expect(balances.find((b) => b.memberId === 'kn')!.net).toBe(0)
    expect(balances.find((b) => b.memberId === 'bx')!.net).toBe(0)
  })

  it('删掉的退税不算', async () => {
    const id = await saveTaxRefund(input())
    await deleteTaxRefund(id)
    const balances = await computeBalances('t1')
    expect(balances.every((b) => b.net === 0)).toBe(true)
  })
})

describe('同步映射（0053）', () => {
  it('推上去再拉回来原样还原，numeric 列是字符串也能读', () => {
    const row: TaxRefund = {
      id: 'tr1', householdId: 'h1', tripId: 't1', method: 'card', currency: 'JPY', foreignAmount: 12500, rate: 0.0266,
      homeAmount: 332.5, pending: true, memberIds: ['bx', 'kn'], receivedBy: 'bx', rateBookEntryId: null,
      refundDate: '2026-11-05', note: '网上退税', createdBy: 'bx', createdAt: Date.UTC(2026, 10, 8), updatedAt: Date.UTC(2026, 10, 8), deletedAt: null,
    }
    const remote = SYNC_CONFIG.taxRefunds.toRemote(row)
    expect(remote).toMatchObject({ method: 'card', foreign_amount: 12500, member_ids: ['bx', 'kn'], pending: true, refund_date: '2026-11-05' })
    expect(SYNC_CONFIG.taxRefunds.fromRemote({ ...remote, foreign_amount: '12500.00', rate: '0.02660000', home_amount: '332.50' })).toEqual(row)
  })
})
