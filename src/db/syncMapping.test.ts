import { describe, it, expect } from 'vitest'
import { SYNC_CONFIG } from './syncMapping'

// 刷卡记账（0045）：卡表和开销上新加的两列，推上去再拉回来要原样还原
describe('paymentCards / expense card fields mapping', () => {
  it('round-trips a payment card, including archived', () => {
    const card = {
      id: 'c1', householdId: 'h1', name: 'TNG VISA', archivedAt: Date.UTC(2026, 9, 20),
      createdBy: 'm1', createdAt: Date.UTC(2026, 9, 1), updatedAt: Date.UTC(2026, 9, 2), cashbackPercent: 5,
    }
    const remote = SYNC_CONFIG.paymentCards.toRemote(card)
    expect(remote.archived_at).toBe('2026-10-20T00:00:00.000Z')
    expect(remote.cashback_percent).toBe(5)
    expect(SYNC_CONFIG.paymentCards.fromRemote(remote)).toEqual(card)
    expect(SYNC_CONFIG.paymentCards.fromRemote({ ...remote, archived_at: null }).archivedAt).toBeNull()
    // 0048 之前的卡没有返现比例
    expect(SYNC_CONFIG.paymentCards.fromRemote({ ...remote, cashback_percent: null }).cashbackPercent).toBeNull()
  })

  it('round-trips a card cashback record (0048)', () => {
    const cb = {
      id: 'cb1', householdId: 'h1', tripId: 't1', paymentCardId: 'c1', memberId: 'm1', amount: 45.6, note: '11月账单',
      createdBy: 'm1', createdAt: Date.UTC(2026, 10, 1), updatedAt: Date.UTC(2026, 10, 2), deletedAt: null,
    }
    const remote = SYNC_CONFIG.cardCashbacks.toRemote(cb)
    expect(remote).toMatchObject({ trip_id: 't1', payment_card_id: 'c1', member_id: 'm1', amount: 45.6, note: '11月账单' })
    expect(SYNC_CONFIG.cardCashbacks.fromRemote({ ...remote, amount: '45.60' })).toEqual(cb)
  })

  it('sends card fields on expenses, defaulting old rows to cash', () => {
    const base = {
      id: 'e1', householdId: 'h1', tripId: 't1', categoryId: 'c', phase: 'during', description: null,
      expenseCurrency: 'JPY', expenseAmount: 1200, rateBookEntryId: null, rateUsed: 0.0294, homeAmount: 35.28,
      paidBy: 'm1', recordedBy: 'm1', expenseDate: '2026-10-23', itineraryDayId: null, itineraryItemId: null,
      splitType: 'none', deletedAt: null, createdAt: 0, updatedAt: 0,
    }
    const card = SYNC_CONFIG.expenses.toRemote({ ...base, paymentCardId: 'c1', cardChargePending: true })
    expect(card.payment_card_id).toBe('c1')
    expect(card.card_charge_pending).toBe(true)

    const legacy = SYNC_CONFIG.expenses.toRemote(base)
    expect(legacy.payment_card_id).toBeNull()
    expect(legacy.card_charge_pending).toBe(false)

    const back = SYNC_CONFIG.expenses.fromRemote({ ...card, rate_used: '0.0294', home_amount: '35.28', expense_amount: '1200' })
    expect(back.paymentCardId).toBe('c1')
    expect(back.cardChargePending).toBe(true)
  })
})
