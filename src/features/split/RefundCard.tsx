import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { ReceiptText, Banknote, CreditCard, Check, Plus, Trash2, Info, Clock } from 'lucide-react'
import { db } from '../../db/dexie'
import { formatMoney, round2 } from '../../lib/money'
import { toLocalDateString } from '../../lib/dates'
import { BottomSheet } from '../../components/BottomSheet'
import { Avatar } from '../../components/Avatar'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import {
  deleteTaxRefund, listTripRefunds, markRefundArrived, pickDefaultRefundRate, refundGoesToRateBook, refundShares,
  refundSummary, saveTaxRefund,
} from '../../domain/taxRefunds'
import { isProxySplit } from '../../domain/splits'
import type { ExpenseSplit, Member, TaxRefund, TaxRefundMethod, Trip } from '../../types'

// 退税（2026-11-08，0053）：机场现金退税、网上退到信用卡。放在结算页「代购」下面。
// 规则见 domain/taxRefunds.ts 开头。每条点一下改/删；退到卡还没到账的，到账后点
// 「已到账，填实际金额」把估算换成实际数字

function md(date: string) {
  return date.slice(5).replace('-', '/')
}

export function RefundCard({ trip, members, currentMemberId }: { trip: Trip; members: Member[]; currentMemberId: string }) {
  const { t } = useTranslation()
  const refunds = (useLiveQuery(() => listTripRefunds(trip.id), [trip.id]) ?? [])
    .sort((a, b) => b.refundDate.localeCompare(a.refundDate) || b.createdAt - a.createdAt)
  const expenses = (useLiveQuery(() => db.expenses.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []).filter((e) => !e.deletedAt)
  const expenseIds = expenses.map((e) => e.id)
  const splits = useLiveQuery(
    () => (expenseIds.length ? db.expenseSplits.where('expenseId').anyOf(expenseIds).toArray() : Promise.resolve<ExpenseSplit[]>([])),
    [expenseIds.join(',')],
  ) ?? []
  const [editing, setEditing] = useState<TaxRefund | 'new' | null>(null)
  const [arriving, setArriving] = useState<TaxRefund | null>(null)
  const [arrivedInput, setArrivedInput] = useState('')
  const [busy, setBusy] = useState(false)

  const homePrefix = trip.homeCurrency === 'MYR' ? 'RM' : trip.homeCurrency
  const money = (n: number) => formatMoney(n, homePrefix)
  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.displayName ?? t('split.unknownMember')
  const summary = refundSummary(refunds)
  // 这趟真的参与了账目的同行者——"算谁的"可选、新记一条时默认全勾（跟送礼一样）
  const travelerIds = [...new Set([
    ...expenses.map((e) => e.paidBy),
    ...splits.filter((s) => !s.deletedAt && !isProxySplit(s)).map((s) => s.memberId),
    currentMemberId,
  ])].filter((id) => members.some((m) => m.id === id))

  function titleOf(r: TaxRefund) {
    return r.note || t(r.method === 'cash' ? 'split.refund.defaultNameCash' : 'split.refund.defaultNameCard')
  }

  return (
    <div className="bg-card border border-line rounded-2xl p-4 mb-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] tracking-widest uppercase text-muted flex items-center gap-1.5">
          <ReceiptText className="w-[13px] h-[13px] text-plan" strokeWidth={1.8} />
          {t('split.refund.heading')}
        </div>
        {summary.total > 0 && (
          <div className="text-[10.5px] text-muted">
            {t(summary.pendingTotal > 0 ? 'split.refund.totalPending' : 'split.refund.total', { amount: money(summary.total) })}
          </div>
        )}
      </div>

      {refunds.length === 0 && <div className="text-[12px] text-soft mt-2 leading-relaxed">{t('split.refund.empty')}</div>}

      {refunds.length > 0 && (
        <div className="flex flex-col gap-2.5 mt-3">
          {refunds.map((r) => {
            const shares = refundShares(r)
            const foreign = `${r.currency} ${r.foreignAmount.toLocaleString()}`
            return (
              <div key={r.id} className="border border-line rounded-xl p-2.5">
                <button type="button" onClick={() => setEditing(r)} className="w-full text-left">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${r.method === 'cash' ? 'bg-positive/10' : 'bg-plan/[.08]'}`}>
                      {r.method === 'cash'
                        ? <Banknote className="w-[15px] h-[15px] text-positive" strokeWidth={1.8} />
                        : <CreditCard className="w-[15px] h-[15px] text-plan" strokeWidth={1.8} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium truncate">{titleOf(r)}</div>
                      <div className="text-[11px] text-muted truncate">
                        {t(r.method === 'cash' ? 'split.refund.metaCash' : 'split.refund.metaCard', { date: md(r.refundDate), amount: foreign, name: nameOf(r.receivedBy) })}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`font-serif-sc text-[16px] tabular ${r.pending ? 'text-soft' : ''}`}>
                        {r.pending ? t('split.refund.approx', { amount: money(r.homeAmount) }) : money(r.homeAmount)}
                      </div>
                      <div className={`text-[10.5px] ${r.pending ? 'text-spend-text' : 'text-positive'}`}>
                        {t(r.pending ? 'split.refund.pendingTag' : 'split.refund.arrivedTag')}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 ml-[38px] text-[11.5px] text-soft tabular">
                    {shares.length === 1
                      ? t('split.refund.splitOne', { name: nameOf(shares[0].memberId) })
                      : t(r.pending ? 'split.refund.splitEqualApprox' : 'split.refund.splitEqual', {
                          names: shares.map((s) => nameOf(s.memberId)).join('、'),
                          amount: money(shares[shares.length - 1].amount),
                        })}
                    {r.rateBookEntryId ? t('split.refund.inRateBook') : ''}
                  </div>
                </button>
                {r.pending && (
                  <div className="flex gap-2 mt-2.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => { setArriving(r); setArrivedInput(r.homeAmount.toFixed(2)) }}
                      className="flex-1 rounded-full py-1.5 text-[12px] font-medium bg-plan text-card flex items-center justify-center gap-1.5 disabled:opacity-60"
                    >
                      <Check className="w-3.5 h-3.5" strokeWidth={2} />
                      {t('split.refund.markArrived')}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => setEditing('new')}
        className="mt-3 w-full rounded-full py-2 text-[12.5px] font-medium border border-dashed border-plan text-plan bg-card flex items-center justify-center gap-1.5"
      >
        <Plus className="w-3.5 h-3.5" strokeWidth={2} />
        {t('split.refund.add')}
      </button>

      {editing && (
        <RefundSheet
          trip={trip}
          members={members}
          travelerIds={travelerIds}
          currentMemberId={currentMemberId}
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {arriving && (
        <BottomSheet onClose={() => setArriving(null)} cardClassName="px-5 pt-3.5 pb-5 flex flex-col gap-3">
          <div className="w-[38px] h-1 rounded-full bg-handle mx-auto flex-shrink-0" />
          <h2 className="font-serif-sc text-[15px] font-semibold">{t('split.refund.arrivedTitle', { name: titleOf(arriving) })}</h2>
          <div className="text-[12px] text-muted">{t('split.refund.arrivedHint', { amount: money(arriving.homeAmount) })}</div>
          <label className="flex items-center gap-2 rounded-xl border-[1.5px] border-plan bg-card px-3 py-2.5">
            <span className="text-[13px] text-muted">{homePrefix}</span>
            <input
              autoFocus
              value={arrivedInput}
              onChange={(e) => setArrivedInput(e.target.value)}
              inputMode="decimal"
              className="flex-1 min-w-0 bg-transparent text-[20px] font-bold tabular outline-none"
            />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setArriving(null)} className="flex-1 min-h-[44px] rounded-full border border-line bg-card text-soft text-[13px]">
              {t('split.refund.cancel')}
            </button>
            <button
              type="button"
              disabled={busy || !(parseFloat(arrivedInput) > 0)}
              onClick={async () => {
                const r = arriving
                const amount = round2(parseFloat(arrivedInput))
                setArriving(null)
                setBusy(true)
                try { await markRefundArrived(r.id, amount) } finally { setBusy(false) }
              }}
              className="flex-[2] min-h-[44px] rounded-full bg-plan text-card text-[13px] font-semibold disabled:opacity-60"
            >
              {t('split.refund.arrivedConfirm')}
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  )
}

function RefundSheet({
  trip, members, travelerIds, currentMemberId, existing, onClose,
}: {
  trip: Trip
  members: Member[]
  travelerIds: string[]
  currentMemberId: string
  existing: TaxRefund | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const home = trip.homeCurrency
  const homePrefix = home === 'MYR' ? 'RM' : home
  const money = (n: number) => formatMoney(n, homePrefix)
  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.displayName ?? t('split.unknownMember')
  const currencies = Array.from(new Set([...(trip.currencies ?? []), home, ...(existing ? [existing.currency] : [])]))
  const rateEntries = useLiveQuery(() => db.rateBookEntries.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const refundRateIds = new Set(
    (useLiveQuery(() => listTripRefunds(trip.id), [trip.id]) ?? []).map((r) => r.rateBookEntryId).filter((id): id is string => !!id),
  )

  const [method, setMethod] = useState<TaxRefundMethod>(existing?.method ?? 'cash')
  const [currency, setCurrency] = useState(existing?.currency ?? (trip.currencies?.[0] ?? home))
  const [amount, setAmount] = useState(existing ? String(existing.foreignAmount) : '')
  // 汇率输入：null = 还没动过，用默认（这趟这种外币现金的汇率）
  const [rateInput, setRateInput] = useState<string | null>(existing && existing.currency !== home ? String(existing.rate) : null)
  const [pending, setPending] = useState(existing ? existing.pending : true)
  const [actual, setActual] = useState(existing && existing.method === 'card' && !existing.pending ? existing.homeAmount.toFixed(2) : '')
  const [memberIds, setMemberIds] = useState<string[]>(existing?.memberIds ?? travelerIds)
  const [date, setDate] = useState(existing?.refundDate ?? toLocalDateString(new Date()))
  const [note, setNote] = useState(existing?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isForeign = currency !== home
  const defaultRateEntry = isForeign ? pickDefaultRefundRate(rateEntries, currency, refundRateIds) : null
  const rateText = rateInput ?? (defaultRateEntry ? String(defaultRateEntry.rate) : '')
  const rate = isForeign ? parseFloat(rateText) : 1
  const numAmount = parseFloat(amount)
  const cardArrived = method === 'card' && !pending
  const needsRate = isForeign && !cardArrived
  const estimate = Number.isFinite(numAmount) && rate > 0 ? round2(numAmount * rate) : 0
  const homeAmount = cardArrived ? round2(parseFloat(actual) || 0) : estimate
  const toRateBook = refundGoesToRateBook(method, currency, home)
  const defaultName = t(method === 'cash' ? 'split.refund.defaultNameCash' : 'split.refund.defaultNameCard')
  const shares = refundShares({ homeAmount, memberIds })

  const valid = numAmount > 0 && memberIds.length > 0 && (!needsRate || rate > 0) && (!cardArrived || homeAmount > 0) && !!date

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    try {
      await saveTaxRefund({
        tripId: trip.id,
        homeCurrency: home,
        method,
        currency,
        foreignAmount: numAmount,
        // 退到卡已到账：汇率反推（实际本位币 ÷ 外币），只是存档用
        rate: !isForeign ? 1 : cardArrived ? homeAmount / numAmount : rate,
        pending: method === 'card' ? pending : false,
        actualHomeAmount: cardArrived ? homeAmount : null,
        memberIds,
        receivedBy: existing?.receivedBy ?? currentMemberId,
        refundDate: date,
        note: note.trim() || null,
        rateBookLabel: defaultName,
        createdBy: currentMemberId,
      }, existing?.id)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    // 内容比屏幕高（选了退到卡 + 已到账 + 好几个人）时在卡片里滚，标题栏（含保存）钉在顶上
    <BottomSheet onClose={onClose} cardClassName="max-h-full overflow-y-auto px-[18px] pb-5 flex flex-col gap-3.5">
      <div className="sticky top-0 z-10 bg-paper -mx-[18px] px-[18px] pt-3 pb-1 flex flex-col gap-3">
      <div className="w-[38px] h-1 rounded-full bg-handle mx-auto flex-shrink-0" />
      <div className="flex items-center justify-between">
        <button type="button" onClick={onClose} className="text-[13px] text-muted min-h-[32px]">{t('split.refund.cancel')}</button>
        <h2 className="font-serif-sc text-[15px] font-semibold">{t(existing ? 'split.refund.sheetTitleEdit' : 'split.refund.sheetTitleNew')}</h2>
        <div className="flex items-center gap-3">
          {existing && (
            <button type="button" onClick={() => setConfirmDelete(true)} className="text-negative min-h-[32px]" title={t('split.refund.delete')} aria-label={t('split.refund.delete')}>
              <Trash2 className="w-4 h-4" strokeWidth={1.8} />
            </button>
          )}
          <button type="button" onClick={save} disabled={!valid || saving} className="text-[13px] text-plan font-semibold min-h-[32px] disabled:opacity-40">
            {t('split.refund.save')}
          </button>
        </div>
      </div>
      </div>

      <div className="flex bg-segment rounded-xl p-[3px]">
        {(['cash', 'card'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-[7px] rounded-[10px] text-[12.5px] ${method === m ? 'bg-surface-strong text-on-dark font-semibold' : 'text-soft'}`}
          >
            {m === 'cash' ? <Banknote className="w-3.5 h-3.5" strokeWidth={1.8} /> : <CreditCard className="w-3.5 h-3.5" strokeWidth={1.8} />}
            {t(m === 'cash' ? 'split.refund.cash' : 'split.refund.card')}
          </button>
        ))}
      </div>

      <div className="bg-card border-[1.5px] border-plan rounded-2xl px-3.5 py-3">
        <div className="text-[11px] text-muted">{t('split.refund.amountLabel')}</div>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="0"
          className="w-full bg-transparent text-[28px] font-bold tabular outline-none placeholder:text-faint mt-0.5"
        />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {currencies.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { setCurrency(c); setRateInput(null) }}
              className={`text-[12.5px] px-3 py-1 rounded-full border ${currency === c ? 'bg-plan border-plan text-card' : 'border-line text-soft'}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {method === 'card' && (
        <div>
          <div className="text-[11.5px] text-muted mb-1.5">{t('split.refund.arrivedQ')}</div>
          <div className="flex bg-segment rounded-xl p-[3px]">
            {[true, false].map((p) => (
              <button
                key={String(p)}
                type="button"
                onClick={() => setPending(p)}
                className={`flex-1 py-[7px] rounded-[10px] text-[12.5px] ${pending === p ? 'bg-card text-ink font-semibold border border-line' : 'text-soft'}`}
              >
                {t(p ? 'split.refund.notYet' : 'split.refund.yes')}
              </button>
            ))}
          </div>
          {cardArrived && (
            <label className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 focus-within:border-plan">
              <span className="text-[12px] text-soft whitespace-nowrap">{t('split.refund.actualLabel', { prefix: homePrefix })}</span>
              <input
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                inputMode="decimal"
                placeholder={estimate > 0 ? estimate.toFixed(2) : '0.00'}
                className="flex-1 min-w-0 bg-transparent text-right text-[15px] font-semibold tabular outline-none placeholder:text-faint placeholder:font-normal"
              />
            </label>
          )}
        </div>
      )}

      {needsRate && (
        <div>
          <div className="text-[11.5px] text-muted mb-1.5">{t('split.refund.rateLabel', { from: currency, to: home })}</div>
          <label className="flex items-center gap-2 rounded-[10px] border border-line bg-card px-3 py-2 focus-within:border-plan">
            <span className="text-[12px] text-soft flex-1 truncate">
              {rateInput == null && defaultRateEntry ? t('split.refund.rateFrom', { label: defaultRateEntry.label }) : t('split.refund.rateCustom')}
            </span>
            <input
              value={rateText}
              onChange={(e) => setRateInput(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="w-28 bg-transparent text-right text-[15px] font-semibold tabular outline-none placeholder:text-faint placeholder:font-normal"
            />
          </label>
          {estimate > 0 && <div className="text-[11.5px] text-soft mt-1.5 tabular">{t('split.refund.approx', { amount: money(estimate) })}</div>}
        </div>
      )}

      {toRateBook && numAmount > 0 && (
        <div className="flex items-start gap-1.5 rounded-xl bg-positive/[.07] px-3 py-2 text-[12px] text-soft leading-relaxed">
          <Info className="w-3.5 h-3.5 text-positive flex-shrink-0 mt-[3px]" strokeWidth={2} />
          <span>{t('split.refund.rateBookHint', { amount: `${currency} ${numAmount.toLocaleString()}`, label: note.trim() || defaultName })}</span>
        </div>
      )}
      {method === 'card' && pending && isForeign && estimate > 0 && (
        <div className="flex items-start gap-1.5 text-[11.5px] text-soft leading-relaxed">
          <Clock className="w-3.5 h-3.5 text-muted flex-shrink-0 mt-[3px]" strokeWidth={2} />
          <span>{t('split.refund.pendingHint', { amount: money(estimate) })}</span>
        </div>
      )}

      <div>
        <div className="text-[11.5px] text-muted mb-1.5">{t('split.refund.whoLabel')}</div>
        <div className="flex flex-wrap gap-2">
          {travelerIds.map((id) => {
            const m = members.find((x) => x.id === id)!
            const on = memberIds.includes(id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => setMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
                className={`flex items-center gap-1.5 rounded-full pl-1.5 pr-3.5 py-1.5 text-[13px] border ${on ? 'bg-plan/10 border-plan text-plan font-medium' : 'bg-card border-line text-soft'}`}
              >
                <Avatar member={m} size={20} />
                {m.displayName}
              </button>
            )
          })}
        </div>
        {shares.length > 0 && homeAmount > 0 && (
          <div className="text-[11.5px] text-soft mt-1.5 tabular leading-relaxed">
            {shares.length === 1
              ? t('split.refund.splitOne', { name: nameOf(shares[0].memberId) })
              : t('split.refund.splitEqual', { names: shares.map((s) => nameOf(s.memberId)).join('、'), amount: money(shares[shares.length - 1].amount) })}
            {' · '}{t('split.refund.heldHint', { name: nameOf(existing?.receivedBy ?? currentMemberId) })}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="flex-1 min-w-0 rounded-[10px] border border-line bg-card px-3 py-2 text-[13px] outline-none focus:border-plan"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={defaultName}
          className="flex-[1.4] min-w-0 rounded-[10px] border border-line bg-card px-3 py-2 text-[13px] outline-none focus:border-plan placeholder:text-faint"
        />
      </div>
      {method === 'card' && <div className="text-[11px] text-muted leading-relaxed">{t('split.refund.cardNoRateBook')}</div>}

      {confirmDelete && existing && (
        <ConfirmDialog
          title={t('split.refund.deleteTitle')}
          message={t('split.refund.deleteMessage')}
          onConfirm={async () => {
            setConfirmDelete(false)
            await deleteTaxRefund(existing.id)
            onClose()
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </BottomSheet>
  )
}
