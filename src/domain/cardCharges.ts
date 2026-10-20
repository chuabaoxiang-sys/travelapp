import { db } from '../db/dexie'
import { persistExpenseSplitShares, resolveSplitShares, round2 } from './splits'
import { saveDayAllocations } from './dayAllocations'
import { isExpenseSettled } from './settlements'
import { isCardExpense } from './paymentCards'
import type { Expense } from '../types'

// 刷卡"待补扣款"（2026-10-20）：刷卡当下不知道银行扣了多少，先按估算汇率记了
// homeAmount、标成 cardChargePending；之后补上真实扣款时，这笔账的本位币金额变了，
// 挂在它下面所有"按本位币记的拆分"都要跟着变，不然分摊合计就对不上总额了

export function isPendingCardExpense(e: Expense): boolean {
  return !e.deletedAt && !!e.cardChargePending && isCardExpense(e)
}

// 把一组金额按比例缩放到新的总额，保证加起来刚好等于新总额：各项先按比例四舍五入，
// 剩下的零头（最多几分钱）补给第一项——跟 resolveSplitShares "余数给第一个人"同一个规矩。
// 旧总额是0时没法按比例，退成平均分
export function scaleAmounts(amounts: number[], newTotal: number): number[] {
  if (!amounts.length) return []
  const oldTotal = amounts.reduce((a, b) => a + b, 0)
  const scaled = oldTotal > 0
    ? amounts.map((a) => round2((a * newTotal) / oldTotal))
    : amounts.map(() => Math.floor((newTotal / amounts.length) * 100) / 100)
  const diff = round2(newTotal - scaled.reduce((a, b) => a + b, 0))
  scaled[0] = round2(scaled[0] + diff)
  return scaled
}

export class ExpenseSettledError extends Error {
  constructor() {
    super('Expense already settled')
  }
}

// 补上一笔刷卡的真实扣款。分摊怎么跟着变：
//   - 平均分/不分摊：按原来那几个人重新平均分（跟记账页保存时走同一个 resolveSplitShares）
//   - 自定义金额/逐项拆账：每个人的份额按比例缩放
//   - 逐项拆账的子项金额也按比例缩放（编辑页回显用，不参与结算）
//   - 跨天开销每天的金额：平均分的重新平均，自定义的按比例
// 已经按笔结算过的账不允许改金额（跟编辑页锁住金额是同一个原因）
export async function fillCardCharge(expenseId: string, charged: number) {
  const e = await db.expenses.get(expenseId)
  if (!e || e.deletedAt) throw new Error('Expense not found')
  if (!(charged > 0)) throw new Error('Charge must be positive')
  if (await isExpenseSettled(expenseId)) throw new ExpenseSettledError()

  const newHome = round2(charged)
  const oldHome = e.homeAmount

  await db.expenses.update(expenseId, {
    homeAmount: newHome,
    rateUsed: e.expenseAmount > 0 ? charged / e.expenseAmount : e.rateUsed,
    cardChargePending: false,
    updatedAt: Date.now(),
  })

  const splits = (await db.expenseSplits.where('expenseId').equals(expenseId).toArray()).filter((s) => !s.deletedAt)
  if (e.splitType === 'equal' || e.splitType === 'none' || !splits.length) {
    const memberIds = e.splitType === 'none' ? [] : splits.map((s) => s.memberId)
    await persistExpenseSplitShares(expenseId, resolveSplitShares(newHome, e.splitType, memberIds, e.paidBy))
  } else {
    const scaled = scaleAmounts(splits.map((s) => s.shareAmount), newHome)
    await persistExpenseSplitShares(expenseId, splits.map((s, i) => ({ memberId: s.memberId, shareAmount: scaled[i] })))
  }

  if (e.splitType === 'itemized' && oldHome > 0) {
    const items = (await db.expenseLineItems.where('expenseId').equals(expenseId).toArray()).filter((it) => !it.deletedAt)
    for (const it of items) {
      await db.expenseLineItems.update(it.id, { amount: round2((it.amount * newHome) / oldHome) })
    }
  }

  if (e.daySpreadMode) {
    const days = (await db.expenseDayAllocations.where('expenseId').equals(expenseId).toArray())
      .filter((d) => !d.deletedAt)
      .sort((a, b) => a.date.localeCompare(b.date))
    const dates = days.map((d) => d.date)
    if (e.daySpreadMode === 'equal') {
      await saveDayAllocations(expenseId, e.tripId, newHome, 'equal', dates)
    } else {
      const scaled = scaleAmounts(days.map((d) => d.amount), newHome)
      await saveDayAllocations(expenseId, e.tripId, newHome, 'exact', dates, Object.fromEntries(dates.map((d, i) => [d, scaled[i]])))
    }
  }
}
