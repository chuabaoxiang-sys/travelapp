import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { X, Pencil, Trash2, Check, Coins, Info } from 'lucide-react'
import { db } from '../../db/dexie'
import { BottomSheet } from '../../components/BottomSheet'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { formatMoney } from '../../lib/money'
import {
  addCashback,
  updateCashback,
  deleteCashback,
  setCardCashbackPercent,
  cardTripSpend,
  estimateCashback,
  defaultCashbackOwner,
  listTripCashbacks,
  expenseCashbackForCard,
} from '../../domain/cashback'
import type { PaymentCard } from '../../types'

// 某张卡这趟的返现（2026-11-07）：设返现比例（可选、所有旅行通用）、按这趟刷卡
// 总额一键估算、记一笔/改/删返现。返现算"归谁"那个人的，不影响同行者之间的结算
export function CashbackSheet({
  tripId,
  card,
  currentMemberId,
  onClose,
}: {
  tripId: string
  card: PaymentCard
  currentMemberId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const expenses = (useLiveQuery(() => db.expenses.where('tripId').equals(tripId).toArray(), [tripId]) ?? []).filter((e) => !e.deletedAt)
  const records = (useLiveQuery(() => listTripCashbacks(tripId), [tripId]) ?? []).filter((c) => c.paymentCardId === card.id)
  const allMembers = useLiveQuery(() => db.members.toArray()) ?? []
  const members = allMembers.filter((m) => m.isActive)
  const nameOf = (id: string) => allMembers.find((m) => m.id === id)?.displayName ?? '?'

  const [percent, setPercent] = useState(card.cashbackPercent ? String(card.cashbackPercent) : '')
  const numPercent = parseFloat(percent) || 0
  const spend = cardTripSpend(expenses, card.id)
  // 每笔账上记的返现（0049）：这里只读显示合计；有的话就不再给"按比例估总数"，免得同一笔算两次
  const perExpense = expenseCashbackForCard(expenses, card.id)
  const estimate = perExpense.count > 0 ? null : estimateCashback(spend, numPercent)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [owner, setOwner] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const effectiveOwner = owner ?? defaultCashbackOwner(expenses, card.id, currentMemberId)
  const numAmount = parseFloat(amount) || 0

  async function savePercent() {
    const next = numPercent > 0 && numPercent <= 100 ? numPercent : null
    if ((card.cashbackPercent ?? null) === next) return
    await setCardCashbackPercent(card.id, next)
  }

  function resetForm() {
    setEditingId(null)
    setAmount('')
    setOwner(null)
    setNote('')
  }

  async function save() {
    if (saving || !(numAmount > 0)) return
    setSaving(true)
    try {
      if (editingId) await updateCashback(editingId, { memberId: effectiveOwner, amount: numAmount, note })
      else await addCashback({ tripId, paymentCardId: card.id, memberId: effectiveOwner, amount: numAmount, note, createdBy: currentMemberId })
      resetForm()
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet onClose={onClose} cardClassName="px-5 pt-3.5 pb-5 max-h-[90%] flex flex-col">
      <div className="w-[38px] h-1 rounded-full bg-handle mx-auto mb-2 flex-shrink-0" />
      <div className="flex items-center justify-between flex-shrink-0">
        <h2 className="font-serif-sc text-[15px] font-semibold truncate">{t('cashback.title', { card: card.name })}</h2>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-muted" title={t('activity.close')} aria-label={t('activity.close')}>
          <X className="w-[18px] h-[18px]" strokeWidth={1.8} />
        </button>
      </div>

      <div className="overflow-y-auto no-scrollbar flex-1 min-h-0 flex flex-col gap-2.5 mt-1">
        <label className="flex items-center gap-2 bg-card border border-line rounded-xl px-3 py-2">
          <span className="flex-1 text-[12.5px] text-soft">{t('cashback.percentLabel')}</span>
          <input
            value={percent}
            inputMode="decimal"
            onChange={(e) => setPercent(e.target.value)}
            onBlur={savePercent}
            placeholder="—"
            className="w-12 bg-transparent text-right text-[14px] outline-none tabular"
          />
          <span className="text-[12.5px] text-muted">%</span>
        </label>

        {perExpense.count > 0 && (
          <>
            <div className="text-[10.5px] tracking-widest uppercase text-muted mt-1">{t('cashback.perExpenseHeading')}</div>
            <div className="flex items-center gap-2 bg-card border border-line rounded-xl px-3 py-2">
              <Coins className="w-4 h-4 text-positive flex-shrink-0" strokeWidth={1.8} />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-positive tabular">{formatMoney(perExpense.total)}</div>
                <div className="text-[11px] text-muted truncate">
                  {t('cashback.perExpenseLine', { count: perExpense.count, names: perExpense.payerIds.map(nameOf).join('、') })}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-1.5 rounded-xl bg-positive/[.07] px-3 py-2 text-[12px] text-soft leading-relaxed">
              <Info className="w-3.5 h-3.5 text-positive flex-shrink-0 mt-[3px]" strokeWidth={2} />
              <span>{t('cashback.perExpenseWarning')}</span>
            </div>
          </>
        )}

        {estimate != null && (
          <div className="flex items-center gap-2 rounded-xl bg-positive/[.07] pl-3 pr-2 py-2">
            <span className="flex-1 text-[12px] text-soft leading-relaxed">
              {t('cashback.estimate', { spend: formatMoney(spend), percent: numPercent })}{' '}
              <b className="text-positive">{formatMoney(estimate)}</b>
            </span>
            <button
              type="button"
              onClick={() => setAmount(estimate.toFixed(2))}
              className="flex-shrink-0 min-h-[34px] px-3 rounded-full border border-positive bg-card text-positive text-[12px] font-medium"
            >
              {t('cashback.useEstimate')}
            </button>
          </div>
        )}

        {records.length > 0 && (
          <>
            <div className="text-[10.5px] tracking-widest uppercase text-muted mt-1">{t('cashback.recorded')}</div>
            {records.map((r) => (
              <div key={r.id} className={`flex items-center gap-2 bg-card border rounded-xl pl-3 pr-1.5 py-2 ${editingId === r.id ? 'border-plan' : 'border-line'}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold text-positive tabular">{formatMoney(r.amount)}</div>
                  <div className="text-[11px] text-muted truncate">
                    {t('cashback.ownerLine', { name: nameOf(r.memberId) })}{r.note ? ` · ${r.note}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setEditingId(r.id); setAmount(String(r.amount)); setOwner(r.memberId); setNote(r.note ?? '') }}
                  className="w-[34px] h-[34px] flex items-center justify-center text-plan border border-dashed border-plan/50 rounded-lg"
                  title={t('cashback.edit')}
                  aria-label={t('cashback.edit')}
                >
                  <Pencil className="w-3.5 h-3.5" strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(r.id)}
                  className="w-[34px] h-[34px] flex items-center justify-center text-negative border border-dashed border-negative/40 rounded-lg"
                  title={t('cashback.delete')}
                  aria-label={t('cashback.delete')}
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
                </button>
              </div>
            ))}
          </>
        )}

        <div className="text-[10.5px] tracking-widest uppercase text-muted mt-1">{editingId ? t('cashback.editing') : t('cashback.addHeading')}</div>
        <div className="bg-card border border-line rounded-xl px-3 py-2.5 flex flex-col gap-2">
          <label className="flex items-center gap-2">
            <span className="w-10 text-[12px] text-muted">{t('cashback.amount')}</span>
            <span className="text-[13px] text-muted">RM</span>
            <input
              value={amount}
              inputMode="decimal"
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="flex-1 min-w-0 bg-transparent border-b border-line text-[14px] py-0.5 outline-none focus:border-plan tabular"
            />
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-10 text-[12px] text-muted">{t('cashback.owner')}</span>
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setOwner(m.id)}
                className={`rounded-full px-3 py-1 text-[12.5px] border ${effectiveOwner === m.id ? 'bg-plan text-card border-plan' : 'border-line bg-card text-soft'}`}
              >
                {m.displayName}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <span className="w-10 text-[12px] text-muted">{t('cashback.note')}</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('cashback.notePlaceholder')}
              className="flex-1 min-w-0 bg-transparent border-b border-line text-[13px] py-0.5 outline-none focus:border-plan"
            />
          </label>
          <div className="flex gap-2">
            {editingId && (
              <button type="button" onClick={resetForm} className="min-h-[40px] px-4 rounded-full border border-line text-soft text-[13px]">
                {t('cashback.cancelEdit')}
              </button>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving || !(numAmount > 0)}
              className="flex-1 min-h-[40px] rounded-full bg-plan text-card text-[13px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Check className="w-[15px] h-[15px]" strokeWidth={2} />
              {editingId ? t('cashback.saveEdit') : t('cashback.save')}
            </button>
          </div>
        </div>
        <div className="text-[11px] text-muted leading-relaxed">{t('cashback.footnote')}</div>
      </div>

      {confirmDeleteId && (
        <ConfirmDialog
          title={t('cashback.deleteTitle')}
          message={t('cashback.deleteMessage')}
          confirmLabel={t('cashback.delete')}
          onConfirm={async () => {
            await deleteCashback(confirmDeleteId)
            if (editingId === confirmDeleteId) resetForm()
            setConfirmDeleteId(null)
          }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </BottomSheet>
  )
}
