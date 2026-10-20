import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { X, CreditCard, Lock } from 'lucide-react'
import { db } from '../../db/dexie'
import { BottomSheet } from '../../components/BottomSheet'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { categoryLabel } from '../../lib/categoryLabel'
import { fillCardCharge } from '../../domain/cardCharges'
import type { Expense, ExpenseCategory, PaymentCard, Trip } from '../../types'

// 「去补」：把这趟所有"刷卡待补扣款"的账一次列出来，按卡分组，对着银行App一笔笔填
// （2026-10-20 刷卡记账第3步）。填几笔存几笔，没填的继续是待补
export function CardChargeSheet({
  trip,
  pending,
  cards,
  categories,
  onClose,
}: {
  trip: Trip
  pending: Expense[]
  cards: PaymentCard[]
  categories: ExpenseCategory[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  useEscapeKey(true, onClose)
  const homePrefix = trip.homeCurrency === 'MYR' ? 'RM' : trip.homeCurrency
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // 已经按笔结算过的账金额锁住了，这里也不能补（跟编辑页同一个规矩）
  const settledIds = useLiveQuery(async () => {
    const rows = await db.settlements.where('tripId').equals(trip.id).toArray()
    return new Set(rows.filter((s) => !s.deletedAt && s.expenseId).map((s) => s.expenseId as string))
  }, [trip.id]) ?? new Set<string>()

  const groups = new Map<string, Expense[]>()
  for (const e of [...pending].sort((a, b) => a.expenseDate.localeCompare(b.expenseDate) || a.createdAt - b.createdAt)) {
    const key = e.paymentCardId as string
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(e)
  }

  const filled = pending.filter((e) => !settledIds.has(e.id) && parseFloat(values[e.id] ?? '') > 0)

  async function save() {
    if (saving || !filled.length) return
    setSaving(true)
    try {
      for (const e of filled) {
        await fillCardCharge(e.id, parseFloat(values[e.id]))
      }
      setValues({})
      // 全部补完了，这张单子就没东西了，直接关掉；只补了一部分就留着继续补
      if (filled.length === pending.length) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet onClose={onClose} cardClassName="px-5 pt-3.5 pb-5 max-h-[88%] flex flex-col">
      <div className="w-[38px] h-1 rounded-full bg-handle mx-auto mb-3.5 flex-shrink-0" />
      <div className="flex items-center justify-between flex-shrink-0">
        <h2 className="font-serif-sc text-[15px] font-semibold">{t('cardCharge.title')}</h2>
        <button onClick={onClose} className="text-muted" title={t('activity.close')}>
          <X className="w-[18px] h-[18px]" strokeWidth={1.8} />
        </button>
      </div>
      <div className="text-[11.5px] text-muted mt-0.5 mb-2 flex-shrink-0">{t('cardCharge.subtitle', { prefix: homePrefix })}</div>

      <div className="overflow-y-auto no-scrollbar flex-1 min-h-0">
        {!pending.length && <div className="text-[13px] text-muted py-6 text-center">{t('cardCharge.allDone')}</div>}
        {[...groups.entries()].map(([cardId, list]) => {
          const card = cards.find((c) => c.id === cardId)
          return (
            <div key={cardId} className="mt-2">
              <div className="text-[11px] font-semibold text-soft flex items-center gap-1.5 mb-1">
                <CreditCard className="w-3.5 h-3.5" strokeWidth={2} />
                {t('cardCharge.groupTitle', { name: card?.name ?? '—', count: list.length })}
              </div>
              <div className="bg-card border border-line rounded-2xl px-3">
                {list.map((e, i) => {
                  const cat = categories.find((c) => c.id === e.categoryId)
                  const locked = settledIds.has(e.id)
                  return (
                    <div key={e.id} className={`flex items-center gap-2.5 py-2.5 ${i > 0 ? 'border-t border-line' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-semibold truncate">{e.description || categoryLabel(cat, t)}</div>
                        <div className="text-[10.5px] text-muted tabular leading-snug">
                          {locked
                            ? t('cardCharge.settledLocked')
                            : t('cardCharge.rowMeta', {
                                date: e.expenseDate.slice(5).replace('-', '/'),
                                foreign: `${e.expenseCurrency} ${e.expenseAmount.toLocaleString()}`,
                              })}
                        </div>
                        {!locked && (
                          <div className="text-[10.5px] text-muted tabular leading-snug">
                            {t('cardCharge.rowEstimate', { prefix: homePrefix, estimate: e.homeAmount.toFixed(2) })}
                          </div>
                        )}
                      </div>
                      {locked ? (
                        <Lock className="w-3.5 h-3.5 text-muted flex-shrink-0" strokeWidth={1.8} />
                      ) : (
                        <>
                          <span className="text-[11px] text-muted flex-shrink-0">{homePrefix}</span>
                          <input
                            value={values[e.id] ?? ''}
                            onChange={(ev) => setValues((v) => ({ ...v, [e.id]: ev.target.value }))}
                            inputMode="decimal"
                            placeholder={t('cardCharge.inputPlaceholder')}
                            className={`w-[92px] text-right rounded-lg border bg-paper px-2 py-1.5 text-[13px] tabular outline-none focus:border-plan ${
                              parseFloat(values[e.id] ?? '') > 0 ? 'border-positive' : 'border-line'
                            }`}
                          />
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {pending.length > 0 && (
        <button
          onClick={save}
          disabled={!filled.length || saving}
          className="mt-3 w-full rounded-xl bg-plan text-card py-2.5 text-[13.5px] font-semibold disabled:opacity-40 flex-shrink-0"
        >
          {filled.length ? t('cardCharge.save', { count: filled.length }) : t('cardCharge.saveNone')}
        </button>
      )}
    </BottomSheet>
  )
}
