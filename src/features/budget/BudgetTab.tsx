import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Trash2, Check, X, Plus } from 'lucide-react'
import { db } from '../../db/dexie'
import { getOverallBudget, getCategoryBudgets, upsertBudget, deleteBudget, sumSpend } from '../../domain/budgets'
import { formatMoney } from '../../lib/money'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { categoryColor } from '../../lib/categoryColors'
import { CategoryIcon } from '../../components/CategoryBadge'
import type { Trip } from '../../types'

export function BudgetTab({ trip }: { trip: Trip }) {
  const expenses = useLiveQuery(() => db.expenses.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const categories = useLiveQuery(() => db.expenseCategories.toArray()) ?? []
  const overallBudget = useLiveQuery(() => getOverallBudget(trip.id), [trip.id])
  const categoryBudgets = useLiveQuery(() => getCategoryBudgets(trip.id), [trip.id]) ?? []

  const [editingOverall, setEditingOverall] = useState(false)
  const [overallInput, setOverallInput] = useState('')
  const [addingCategoryBudget, setAddingCategoryBudget] = useState(false)
  const [newCategoryId, setNewCategoryId] = useState('')
  const [newCategoryAmount, setNewCategoryAmount] = useState('')
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [confirmRemoveOverall, setConfirmRemoveOverall] = useState(false)

  const totalSpend = sumSpend(expenses, null)
  const overallPct = overallBudget ? Math.min(999, Math.round((totalSpend / overallBudget.amount) * 100)) : 0
  const overallOver = !!overallBudget && totalSpend > overallBudget.amount

  const categoryRows = categoryBudgets
    .map((b) => {
      const cat = categories.find((c) => c.id === b.categoryId)
      const spend = sumSpend(expenses, b.categoryId)
      const pct = b.amount > 0 ? Math.round((spend / b.amount) * 100) : 0
      return { budget: b, category: cat, spend, pct, over: spend > b.amount }
    })
    .sort((a, b) => (b.over ? 1 : 0) - (a.over ? 1 : 0)) // 超支的排最前面，不用往下翻才发现

  const categoriesWithoutBudget = categories.filter(
    (c) => (c.phase === 'during_trip' || c.phase === 'either') && !categoryBudgets.some((b) => b.categoryId === c.id),
  )

  async function saveOverall() {
    const amount = parseFloat(overallInput)
    if (!amount) return
    await upsertBudget({ tripId: trip.id, categoryId: null, amount })
    setEditingOverall(false)
  }

  async function addCategoryBudget() {
    const amount = parseFloat(newCategoryAmount)
    if (!amount || !newCategoryId) return
    await upsertBudget({ tripId: trip.id, categoryId: newCategoryId, amount })
    setAddingCategoryBudget(false)
    setNewCategoryId('')
    setNewCategoryAmount('')
  }

  return (
    <div className="px-5 pt-3 pb-24 overflow-y-auto no-scrollbar h-full">
      <div className="font-serif-sc text-sm font-semibold mb-2">预算</div>

      {overallBudget && !editingOverall ? (
        <div className="mb-4">
          <div className="ring-wrap flex justify-center py-2">
            <div
              className="w-[160px] h-[160px] rounded-full flex items-center justify-center"
              style={{ background: `conic-gradient(${overallOver ? '#B91C1C' : '#4C1D95'} ${Math.min(100, overallPct) * 3.6}deg, #E4DCCF 0)` }}
            >
              <div className="w-[124px] h-[124px] rounded-full bg-paper flex flex-col items-center justify-center">
                <div className="text-[10.5px] tracking-widest text-muted">已用预算</div>
                <div className="font-serif-sc text-[24px] mt-0.5">{overallPct}%</div>
                <div className="text-[11px] text-muted mt-0.5">
                  {overallOver ? `超支 ${formatMoney(totalSpend - overallBudget.amount)}` : `还剩 ${formatMoney(overallBudget.amount - totalSpend)}`}
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between text-[11.5px] text-muted px-2">
            <span>{formatMoney(totalSpend)} / {formatMoney(overallBudget.amount)}</span>
            <span className="flex items-center gap-2.5">
              <button onClick={() => { setEditingOverall(true); setOverallInput(String(overallBudget.amount)) }} className="text-plan">改总预算</button>
              <button onClick={() => setConfirmRemoveOverall(true)} className="text-muted" title="删除">
                <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
              </button>
            </span>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-dashed border-line rounded-2xl p-4 mb-4">
          <div className="text-[12.5px] text-muted mb-2">
            {overallBudget ? '修改整趟行程的总预算' : '还没设置整趟行程的总预算'}
          </div>
          <div className="flex gap-2">
            <input
              value={overallInput}
              onChange={(e) => setOverallInput(e.target.value)}
              inputMode="decimal"
              placeholder={`总预算（${trip.homeCurrency}）`}
              className="flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-sm tabular outline-none focus:border-plan"
            />
            <button onClick={saveOverall} className="rounded-xl bg-plan text-card px-4 flex items-center justify-center" title="保存">
              <Check className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

      {categoryRows.some((r) => r.over) && (
        <div className="flex flex-col gap-2 mb-3">
          {categoryRows.filter((r) => r.over).map((r) => (
            <div key={r.budget.id} className="border-[1.5px] border-negative rounded-2xl px-3.5 py-3">
              <div className="flex items-center justify-between text-[13px] font-semibold text-negative">
                <span>⚠ {r.category?.name ?? '未知分类'}已超出预算</span>
                <span className="text-[11px] bg-negative/10 px-2 py-0.5 rounded-full">超支 {formatMoney(r.spend - r.budget.amount)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <span className="font-serif-sc text-[13.5px] font-semibold">分类明细</span>
        {categoriesWithoutBudget.length > 0 && (
          <button onClick={() => setAddingCategoryBudget(true)} className="text-[11.5px] text-plan flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
            加分类预算
          </button>
        )}
      </div>

      {addingCategoryBudget && (
        <div className="bg-card border border-line rounded-2xl p-3 mb-3 flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {categoriesWithoutBudget.map((c) => {
              const color = categoryColor(c)
              const selected = newCategoryId === c.id
              return (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => setNewCategoryId(c.id)}
                  className="flex items-center gap-1.5 rounded-[11px] pl-1.5 pr-3 py-1.5 text-[12.5px] border"
                  style={
                    selected
                      ? { borderColor: color, background: `color-mix(in srgb, ${color} 11%, #FFFDF9)`, color, fontWeight: 600 }
                      : { background: '#FFFDF9', borderColor: '#E8E0D4', color: '#57534E' }
                  }
                >
                  <span
                    className="text-card flex items-center justify-center flex-shrink-0"
                    style={{ background: color, width: 24, height: 24, borderRadius: 7 }}
                  >
                    <CategoryIcon category={c} size={13} />
                  </span>
                  {c.name}
                </button>
              )
            })}
          </div>
          <div className="flex gap-2">
            <input
              value={newCategoryAmount}
              onChange={(e) => setNewCategoryAmount(e.target.value)}
              inputMode="decimal"
              placeholder={`预算金额（${trip.homeCurrency}）`}
              className="flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-sm tabular outline-none focus:border-plan"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setAddingCategoryBudget(false)} className="flex-1 rounded-xl border border-line py-2 text-muted flex items-center justify-center" title="取消">
              <X className="w-4 h-4" strokeWidth={1.8} />
            </button>
            <button onClick={addCategoryBudget} disabled={!newCategoryId || !newCategoryAmount} className="flex-1 rounded-xl bg-plan text-card py-2 disabled:opacity-40 flex items-center justify-center" title="保存">
              <Check className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {categoryRows.map((r) => (
          <div key={r.budget.id}>
            <div className="flex justify-between items-baseline text-[13.5px]">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ background: categoryColor(r.category) }} />
                {r.category?.name ?? '未知分类'}
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular text-[12px]">{formatMoney(r.spend)} / {formatMoney(r.budget.amount)}</span>
                <button onClick={() => setConfirmRemoveId(r.budget.id)} className="text-muted" title="删除">
                  <Trash2 className="w-3 h-3" strokeWidth={1.8} />
                </button>
              </span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-line overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(100, r.pct)}%`, background: r.over ? '#B91C1C' : categoryColor(r.category) }}
              />
            </div>
          </div>
        ))}
        {!categoryRows.length && (
          <div className="text-[12.5px] text-muted text-center py-4">还没有按分类设置预算，点上面"＋加分类预算"</div>
        )}
      </div>

      {confirmRemoveId && (
        <ConfirmDialog
          title="删除这个分类预算？"
          message="只是不再追踪这个分类的预算，已经记的账不受影响。"
          onConfirm={() => { deleteBudget(confirmRemoveId); setConfirmRemoveId(null) }}
          onCancel={() => setConfirmRemoveId(null)}
        />
      )}

      {confirmRemoveOverall && overallBudget && (
        <ConfirmDialog
          title="删除总预算？"
          message="只是不再追踪整趟行程的总预算，已经记的账不受影响。"
          onConfirm={() => { deleteBudget(overallBudget.id); setConfirmRemoveOverall(false) }}
          onCancel={() => setConfirmRemoveOverall(false)}
        />
      )}
    </div>
  )
}
