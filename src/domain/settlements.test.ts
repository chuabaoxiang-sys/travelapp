import { describe, it, expect, beforeEach } from 'vitest'
import { isExpenseSettled } from './settlements'
import { db } from '../db/dexie'

describe('isExpenseSettled', () => {
  beforeEach(async () => {
    await db.settlements.where('expenseId').equals('exp-lock-test').delete()
  })

  it('没有任何结算记录指向这笔账目时返回false', async () => {
    expect(await isExpenseSettled('exp-lock-test')).toBe(false)
  })

  it('哪怕只有一条结算记录（部分结清）也算已结算', async () => {
    await db.settlements.add({
      id: 'settle-lock-1', householdId: 'h1', tripId: 't1', fromMemberId: 'a', toMemberId: 'b', amount: 10,
      settledDate: '2026-09-01', note: null, createdBy: 'a', expenseId: 'exp-lock-test', isPrepayment: false, createdAt: 0, updatedAt: 0,
    })
    expect(await isExpenseSettled('exp-lock-test')).toBe(true)
  })

  it('聚合结算（expenseId为null）不会误判成这笔账目被结算', async () => {
    await db.settlements.add({
      id: 'settle-lock-2', householdId: 'h1', tripId: 't1', fromMemberId: 'a', toMemberId: 'b', amount: 500,
      settledDate: '2026-09-01', note: null, createdBy: 'a', expenseId: null, isPrepayment: false, createdAt: 0, updatedAt: 0,
    })
    expect(await isExpenseSettled('exp-lock-test')).toBe(false)
  })
})
