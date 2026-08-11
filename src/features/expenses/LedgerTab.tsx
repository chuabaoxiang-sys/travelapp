import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/dexie'
import type { Trip, ExpenseSplit } from '../../types'
import { formatMoney } from '../../lib/money'
import { AddExpenseSheet } from './AddExpenseSheet'
import { RateBookScreen } from '../rates/RateBookScreen'
import { getOverallBudget } from '../../domain/budgets'
import { CategoryBadge } from '../../components/CategoryBadge'
import { Avatar } from '../../components/Avatar'

export function LedgerTab({ trip, currentMemberId }: { trip: Trip; currentMemberId: string }) {
  const expenses = useLiveQuery(
    () => db.expenses.where('tripId').equals(trip.id).reverse().sortBy('createdAt'),
    [trip.id],
  ) ?? []
  const expenseIds = expenses.map((e) => e.id)
  const splits = useLiveQuery(
    () => (expenseIds.length ? db.expenseSplits.where('expenseId').anyOf(expenseIds).toArray() : Promise.resolve<ExpenseSplit[]>([])),
    [expenseIds.join(',')],
  ) ?? []
  const categories = useLiveQuery(() => db.expenseCategories.toArray()) ?? []
  const members = useLiveQuery(() => db.members.toArray()) ?? []
  const overallBudget = useLiveQuery(() => getOverallBudget(trip.id), [trip.id])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [rateBookOpen, setRateBookOpen] = useState(false)

  const total = expenses.reduce((a, e) => a + e.homeAmount, 0)
  const editingExpense = expenses.find((e) => e.id === editingId)

  function categoryOf(id: string) {
    return categories.find((c) => c.id === id)
  }
  function memberOf(id: string) {
    return members.find((m) => m.id === id)
  }
  function splitCountOf(expenseId: string) {
    return splits.filter((s) => s.expenseId === expenseId).length
  }

  return (
    <div className="px-5 pt-3 pb-24 overflow-y-auto no-scrollbar h-full relative">
      <div className="flex items-center justify-between mb-1">
        <span className="font-serif-sc text-sm font-semibold">记账 · 共 {expenses.length} 笔</span>
        <button
          onClick={() => setRateBookOpen(true)}
          className="w-8 h-8 rounded-[10px] bg-card border border-line flex items-center justify-center text-[14px] text-plan"
          title="汇率簿"
        >
          簿
        </button>
      </div>

      <div className="bg-ink rounded-[20px] px-[18px] pt-[18px] pb-4 text-paper my-1.5 mb-4">
        <div className="text-[11px] tracking-wider text-paper/55">已花费</div>
        <div className="flex items-baseline gap-2 mt-1.5">
          <div className="font-serif-sc text-[30px] leading-none">{formatMoney(total, trip.homeCurrency === 'MYR' ? 'RM' : trip.homeCurrency)}</div>
        </div>
        {overallBudget && (
          <div className="mt-2 text-[11px] text-paper/50">
            {total > overallBudget.amount
              ? `已超出总预算 ${formatMoney(total - overallBudget.amount)}`
              : `距总预算还剩 ${formatMoney(overallBudget.amount - total)}`}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {expenses.map((e) => {
          const cat = categoryOf(e.categoryId)
          const payer = memberOf(e.paidBy)
          const isPersonal = e.splitType === 'none'
          return (
            <button
              key={e.id}
              onClick={() => setEditingId(e.id)}
              className="text-left flex items-center gap-3 bg-card border border-line rounded-2xl px-3.5 py-2.5 hover:border-plan/50 transition-colors"
            >
              <CategoryBadge category={cat} />
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-medium truncate">{e.description || cat?.name}</div>
                <div className="text-[11px] text-muted mt-0.5 truncate">{e.expenseDate} · {cat?.name}</div>
                <div className="flex items-center gap-1.5 mt-1 min-w-0">
                  <Avatar member={payer} size={16} />
                  <span className="text-[11px] text-muted truncate">
                    {isPersonal ? payer?.displayName : `${payer?.displayName}垫付 · ${splitCountOf(e.id)}人分摊`}
                  </span>
                  {isPersonal && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-line text-muted flex-shrink-0">个人开销</span>}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[15px] tabular">{formatMoney(e.homeAmount, trip.homeCurrency === 'MYR' ? 'RM' : trip.homeCurrency)}</div>
                {e.expenseCurrency !== trip.homeCurrency && (
                  <div className="text-[10px] text-[#A79E92] tabular">{e.expenseCurrency} {e.expenseAmount}</div>
                )}
              </div>
            </button>
          )
        })}
        {!expenses.length && <div className="text-[13px] text-muted py-6 text-center">还没有记账，点右下角＋记一笔</div>}
      </div>

      {editingExpense && (
        <AddExpenseSheet
          trip={trip}
          currentMemberId={currentMemberId}
          initial={editingExpense}
          onClose={() => setEditingId(null)}
        />
      )}

      {rateBookOpen && (
        <RateBookScreen trip={trip} currentMemberId={currentMemberId} onClose={() => setRateBookOpen(false)} />
      )}
    </div>
  )
}
