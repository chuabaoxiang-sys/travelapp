import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { X, CircleCheck, Pencil, Trash2, Check, Plus, ChevronDown, ArrowLeftRight } from 'lucide-react'
import { db } from '../../db/dexie'
import { categoryLabel } from '../../lib/categoryLabel'
import { computeBalances, simplifyDebts, openExpenseDebts, closedExpenseDebts, prepaymentBalances, round2, type Transfer, type OpenExpenseDebt } from '../../domain/splits'
import { getSettlements, createSettlement, updateSettlement, deleteSettlement } from '../../domain/settlements'
import { formatMoney } from '../../lib/money'
import { toLocalDateString } from '../../lib/dates'
import { Avatar } from '../../components/Avatar'
import { DatePicker } from '../../components/DatePicker'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { CenteredModal } from '../../components/CenteredModal'
import { SuccessToast } from '../../components/SuccessToast'
import type { Trip, Settlement, Member } from '../../types'

function debtKey(d: OpenExpenseDebt) {
  return `${d.expenseId}:${d.debtorId}`
}

// "记一笔结算"表单——不依赖已有欠款/账目，用来记预付款这类场景。抽成组件
// 是因为空状态页和主页面各有一个入口，两边共用同一份表单，不重复一份JSX
function ManualSettleModal({
  members,
  from,
  to,
  amount,
  date,
  note,
  onFromChange,
  onToChange,
  onAmountChange,
  onDateChange,
  onNoteChange,
  onCancel,
  onConfirm,
}: {
  members: Member[]
  from: string | null
  to: string | null
  amount: string
  date: string
  note: string
  onFromChange: (id: string) => void
  onToChange: (id: string) => void
  onAmountChange: (v: string) => void
  onDateChange: (v: string) => void
  onNoteChange: (v: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  return (
    <CenteredModal onClose={onCancel}>
      <div className="font-serif-sc text-[15px] text-ink mb-3">{t('split.form.manualTitle')}</div>
      <label className="text-[11px] text-muted block mb-1.5">{t('split.form.manualFrom')}</label>
      <div className="flex flex-wrap gap-1.5 mb-2.5">
        {members.map((m) => (
          <button
            key={m.id}
            onClick={() => onFromChange(m.id)}
            className={`flex items-center gap-1.5 rounded-full pl-1.5 pr-3 py-1 text-[12px] border ${
              from === m.id ? 'bg-ink text-paper border-ink' : 'bg-paper border-line text-soft'
            }`}
          >
            <Avatar member={m} size={18} />
            {m.displayName}
          </button>
        ))}
      </div>
      <label className="text-[11px] text-muted block mb-1.5">{t('split.form.manualTo')}</label>
      <div className="flex flex-wrap gap-1.5 mb-2.5">
        {members.map((m) => (
          <button
            key={m.id}
            onClick={() => onToChange(m.id)}
            className={`flex items-center gap-1.5 rounded-full pl-1.5 pr-3 py-1 text-[12px] border ${
              to === m.id ? 'bg-ink text-paper border-ink' : 'bg-paper border-line text-soft'
            }`}
          >
            <Avatar member={m} size={18} />
            {m.displayName}
          </button>
        ))}
      </div>
      <label className="text-[11px] text-muted block mb-2.5">
        {t('split.form.amountLabel')}
        <input
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          inputMode="decimal"
          autoFocus
          className="block w-full mt-1 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[13px] tabular outline-none focus:border-plan"
        />
      </label>
      <label className="text-[11px] text-muted block mb-2.5">
        {t('split.form.dateLabel')}
        <div className="mt-1">
          <DatePicker value={date} onChange={onDateChange} />
        </div>
      </label>
      <label className="text-[11px] text-muted block">
        {t('split.form.noteLabel')}
        <input
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder={t('split.form.notePlaceholderPrepay')}
          className="block w-full mt-1 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[13px] outline-none focus:border-plan"
        />
      </label>
      <div className="flex gap-2 mt-4">
        <button onClick={onCancel} className="flex-1 rounded-xl border border-line py-2 text-muted flex items-center justify-center" title={t('split.form.cancel')}>
          <X className="w-4 h-4" strokeWidth={1.8} />
        </button>
        <button
          onClick={onConfirm}
          disabled={!from || !to || from === to || !(parseFloat(amount) > 0)}
          className="flex-1 rounded-xl bg-plan text-card py-2 disabled:opacity-40 flex items-center justify-center gap-1.5"
          title={t('split.form.confirm')}
        >
          <CircleCheck className="w-4 h-4" strokeWidth={1.8} />
          <span className="text-[12.5px] font-medium">{t('split.form.confirm')}</span>
        </button>
      </div>
    </CenteredModal>
  )
}

export function SplitTab({ trip, currentMemberId }: { trip: Trip; currentMemberId: string }) {
  const { t } = useTranslation()
  const members = useLiveQuery(() => db.members.toArray()) ?? []
  const expenses = useLiveQuery(() => db.expenses.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const settlements = useLiveQuery(() => getSettlements(trip.id), [trip.id]) ?? []
  // computeBalances 本身查库，依赖 expenses/expenseSplits/settlements 变化时要重新算，
  // 用这几张表的变化间接触发重新查询
  const balances = useLiveQuery(
    () => computeBalances(trip.id),
    [
      trip.id,
      expenses.length,
      expenses.map((e) => e.updatedAt).join(','),
      settlements.length,
      settlements.map((s) => s.updatedAt).join(','),
    ],
  ) ?? []

  const categories = useLiveQuery(() => db.expenseCategories.toArray()) ?? []
  const openDebts = useLiveQuery(
    () => openExpenseDebts(trip.id),
    [trip.id, expenses.length, expenses.map((e) => e.updatedAt).join(','), settlements.length, settlements.map((s) => s.updatedAt).join(',')],
  ) ?? []
  const prepayBalances = useLiveQuery(
    () => prepaymentBalances(trip.id),
    [trip.id, expenses.length, expenses.map((e) => e.updatedAt).join(','), settlements.length, settlements.map((s) => s.updatedAt).join(',')],
  ) ?? []
  const closedDebts = useLiveQuery(
    () => closedExpenseDebts(trip.id),
    [trip.id, expenses.length, expenses.map((e) => e.updatedAt).join(','), settlements.length, settlements.map((s) => s.updatedAt).join(',')],
  ) ?? []
  const [showClosed, setShowClosed] = useState(false)

  const [openKey, setOpenKey] = useState<string | null>(null)
  const [settleAmount, setSettleAmount] = useState('')
  const [settleDate, setSettleDate] = useState('')
  const [settleNote, setSettleNote] = useState('')

  // "谁欠谁"筛选——只有清单里真的出现2组以上不同的人物对时才显示筛选行，
  // 只有1组人（最常见的情况）摆一排筛选反而是多余的干扰。用派生值而不是
  // 直接拿pairFilter去过滤：选中的那组人如果因为结算完/换行程而从清单里
  // 消失了，effectivePairFilter会自动退回"全部"，不会卡在一个空列表上
  const [pairFilter, setPairFilter] = useState<string | null>(null)
  const pairKey = (d: OpenExpenseDebt) => `${d.debtorId}:${d.creditorId}`
  const distinctPairs = [...new Map(openDebts.map((d) => [pairKey(d), d])).values()]
  const effectivePairFilter = pairFilter && distinctPairs.some((d) => pairKey(d) === pairFilter) ? pairFilter : null
  const visibleDebts = effectivePairFilter ? openDebts.filter((d) => pairKey(d) === effectivePairFilter) : openDebts

  const [selectedDebtKeys, setSelectedDebtKeys] = useState<Set<string>>(new Set())
  const [itemSettleOpen, setItemSettleOpen] = useState(false)
  const [itemSettleAmount, setItemSettleAmount] = useState('')
  const [itemSettleDate, setItemSettleDate] = useState('')
  const [itemSettleNote, setItemSettleNote] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editNote, setEditNote] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // 结算确认成功的短暂提示——之前这3个确认按钮点了直接关表单，没有任何
  // "成功了"的信号，跟记一笔保存那边不一致
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  function flashSuccess(label: string) {
    setSuccessMsg(label)
    setTimeout(() => setSuccessMsg(null), 1400)
  }

  // 手动记一笔结算——不依赖"已有欠款"或"具体账目"，用来记预付款这类场景：
  // 有人提前给了一大笔钱，之后会持续用来抵消他名下的开销，但这笔钱产生的
  // 时候，"结算建议"和"按笔结算"这两个入口都还没有东西可以让他结算
  const [manualSettleOpen, setManualSettleOpen] = useState(false)
  const [manualFrom, setManualFrom] = useState<string | null>(null)
  const [manualTo, setManualTo] = useState<string | null>(null)
  const [manualAmount, setManualAmount] = useState('')
  const [manualDate, setManualDate] = useState('')
  const [manualNote, setManualNote] = useState('')

  function openManualSettle() {
    setManualFrom(null)
    setManualTo(null)
    setManualAmount('')
    setManualDate(toLocalDateString(new Date()))
    setManualNote('')
    setManualSettleOpen(true)
  }

  async function confirmManualSettle() {
    const amount = parseFloat(manualAmount)
    if (!manualFrom || !manualTo || manualFrom === manualTo || !(amount > 0)) return
    await createSettlement({
      tripId: trip.id,
      fromMemberId: manualFrom,
      toMemberId: manualTo,
      amount,
      settledDate: manualDate,
      note: manualNote.trim() || null,
      createdBy: currentMemberId,
      expenseId: null,
      isPrepayment: true,
    })
    setManualSettleOpen(false)
    flashSuccess(t('split.savedToast'))
  }

  function memberOf(id: string) {
    return members.find((m) => m.id === id)
  }
  function nameOf(id: string) {
    return memberOf(id)?.displayName ?? t('split.unknownMember')
  }
  // 备注优先，其次分类名——分类名要走categoryLabel翻译（系统预设分类按id查，
  // 用户自建分类保持原样），不能直接读.name，否则英文界面里会冒出中文分类名
  function titleOf(d: OpenExpenseDebt) {
    const cat = categories.find((c) => c.id === d.categoryId)
    return d.description || (cat ? categoryLabel(cat, t) : '') || t('split.untitledExpense')
  }

  const selectedDebts = openDebts.filter((d) => selectedDebtKeys.has(debtKey(d)))
  const selectedTotal = round2(selectedDebts.reduce((sum, d) => sum + d.remaining, 0))

  function toggleDebt(d: OpenExpenseDebt) {
    setSelectedDebtKeys((cur) => {
      const next = new Set(cur)
      const key = debtKey(d)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function openItemSettle() {
    if (selectedDebts.length === 0) return
    setItemSettleAmount(selectedDebts.length === 1 ? String(selectedDebts[0].remaining) : String(selectedTotal))
    setItemSettleDate(toLocalDateString(new Date()))
    setItemSettleNote('')
    setItemSettleOpen(true)
  }

  async function confirmSettleItems() {
    if (selectedDebts.length === 0) return
    if (selectedDebts.length === 1) {
      const amount = parseFloat(itemSettleAmount)
      if (!(amount > 0)) return
      await createSettlement({
        tripId: trip.id,
        fromMemberId: selectedDebts[0].debtorId,
        toMemberId: selectedDebts[0].creditorId,
        amount,
        settledDate: itemSettleDate,
        note: itemSettleNote.trim() || null,
        createdBy: currentMemberId,
        expenseId: selectedDebts[0].expenseId,
      })
    } else {
      // 多选时不支持部分结清——每笔都按各自还欠的全额单独记一条结算，
      // 一次动作产生N条结算记录，避免"总额打了折怎么分摊到每一笔"的歧义
      for (const d of selectedDebts) {
        await createSettlement({
          tripId: trip.id,
          fromMemberId: d.debtorId,
          toMemberId: d.creditorId,
          amount: d.remaining,
          settledDate: itemSettleDate,
          note: itemSettleNote.trim() || null,
          createdBy: currentMemberId,
          expenseId: d.expenseId,
        })
      }
    }
    setSelectedDebtKeys(new Set())
    setItemSettleOpen(false)
    flashSuccess(t('split.settledToast'))
  }

  const transfers = simplifyDebts(balances)
  // 有结算记录（哪怕是一笔还没对应任何账目的预付款）也算"有money活动"——
  // 不然KN提前打了一笔预付款，账目还一笔没记，这个页面会一直显示"还没有
  // 可以结算的账目"，看不到这笔预付款，也没地方能再管理它
  const hasAnyMoney = balances.some((b) => b.paid > 0 || b.owed > 0 || b.settledOut > 0 || b.settledIn > 0)

  // 参数名用transfer不用t：t是这个组件里的翻译函数，取名t会在函数体内把它遮掉
  function openSettle(transfer: Transfer) {
    const key = `${transfer.from}-${transfer.to}`
    if (openKey === key) {
      setOpenKey(null)
      return
    }
    setOpenKey(key)
    setSettleAmount(String(transfer.amount))
    setSettleDate(toLocalDateString(new Date()))
    setSettleNote('')
  }

  async function confirmSettle(transfer: Transfer) {
    const amount = parseFloat(settleAmount)
    if (!amount) return
    await createSettlement({
      tripId: trip.id,
      fromMemberId: transfer.from,
      toMemberId: transfer.to,
      amount,
      settledDate: settleDate,
      note: settleNote.trim() || null,
      createdBy: currentMemberId,
    })
    setOpenKey(null)
    flashSuccess(t('split.settledToast'))
  }

  function startEdit(s: Settlement) {
    setEditingId(s.id)
    setEditAmount(String(s.amount))
    setEditDate(s.settledDate)
    setEditNote(s.note ?? '')
  }

  async function saveEdit() {
    const amount = parseFloat(editAmount)
    if (!amount || !editingId) return
    await updateSettlement(editingId, { amount, settledDate: editDate, note: editNote.trim() || null })
    setEditingId(null)
  }

  if (!hasAnyMoney) {
    return (
      <div className="px-5 pt-16 pb-safe-fab-clearance h-full flex flex-col items-center text-center gap-2">
        <div className="w-[60px] h-[60px] rounded-full bg-segment flex items-center justify-center text-muted">
          <ArrowLeftRight className="w-6 h-6" strokeWidth={1.8} />
        </div>
        <div className="font-serif-sc text-[15px] mt-2">{t('split.emptyTitle')}</div>
        <div className="text-[12.5px] text-muted max-w-[220px]">{t('split.emptyHint')}</div>
        <button onClick={openManualSettle} className="flex items-center gap-1 text-plan text-[12.5px] font-semibold mt-2">
          <Plus className="w-3.5 h-3.5" strokeWidth={2.2} />
          {t('split.emptyPrepayCta')}
        </button>
        {manualSettleOpen && (
          <ManualSettleModal
            members={members}
            from={manualFrom}
            to={manualTo}
            amount={manualAmount}
            date={manualDate}
            note={manualNote}
            onFromChange={setManualFrom}
            onToChange={setManualTo}
            onAmountChange={setManualAmount}
            onDateChange={setManualDate}
            onNoteChange={setManualNote}
            onCancel={() => setManualSettleOpen(false)}
            onConfirm={confirmManualSettle}
          />
        )}
        {successMsg && (
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <SuccessToast label={successMsg} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="px-5 pt-3 pb-safe-fab-clearance overflow-y-auto no-scrollbar h-full">
      <div className="font-serif-sc text-sm font-semibold mb-3">{t('split.title')}</div>

      <div className="bg-card border border-line rounded-2xl p-4 mb-4">
        <div className="text-[11px] tracking-widest uppercase text-muted text-center mb-3">
          {transfers.length > 0
            ? t('split.suggestion.headingWithCount', { count: transfers.length })
            : t('split.suggestion.heading')}
        </div>
        {transfers.length > 0 ? (
          <div className="flex flex-col gap-3">
            {/* 循环变量刻意叫transfer不叫t——这个组件里t是翻译函数，用t当map参数
                会把它整段遮住，块内所有t('...')都会变成"把字符串当Transfer用" */}
            {transfers.map((transfer, i) => {
              const key = `${transfer.from}-${transfer.to}`
              const isOpen = openKey === key
              return (
                <div key={i} className="border border-line rounded-xl p-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar member={memberOf(transfer.from)} />
                    <span className="text-[13px] font-medium">{nameOf(transfer.from)}</span>
                    <span className="text-plan">→</span>
                    <Avatar member={memberOf(transfer.to)} />
                    <span className="text-[13px] font-medium">{nameOf(transfer.to)}</span>
                    <span className="font-serif-sc text-[16px] tabular ml-auto">{formatMoney(transfer.amount)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => openSettle(transfer)}
                    className={`w-full mt-2 rounded-full py-1.5 text-[12px] font-medium ${
                      isOpen ? 'bg-line text-muted' : 'bg-plan text-card'
                    }`}
                  >
                    {isOpen ? t('split.suggestion.collapse') : t('split.suggestion.goSettle')}
                  </button>

                  {isOpen && (
                    <div className="mt-2.5 p-3 rounded-xl bg-plan/5 border border-dashed border-plan/30 flex flex-col gap-2.5">
                      <div className="flex gap-2">
                        <label className="flex-1 text-[11px] text-muted">
                          {t('split.form.amountLabelPartial')}
                          <input
                            value={settleAmount}
                            onChange={(e) => setSettleAmount(e.target.value)}
                            inputMode="decimal"
                            className="block w-full mt-1 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] tabular outline-none focus:border-plan"
                          />
                        </label>
                        <label className="flex-1 text-[11px] text-muted">
                          {t('split.form.dateLabel')}
                          <div className="mt-1">
                            <DatePicker value={settleDate} onChange={setSettleDate} />
                          </div>
                        </label>
                      </div>
                      <label className="text-[11px] text-muted">
                        {t('split.form.noteLabel')}
                        <input
                          value={settleNote}
                          onChange={(e) => setSettleNote(e.target.value)}
                          placeholder={t('split.form.notePlaceholderMethod')}
                          className="block w-full mt-1 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] outline-none focus:border-plan"
                        />
                      </label>
                      <div className="flex gap-2">
                        <button onClick={() => setOpenKey(null)} className="flex-1 rounded-lg border border-line py-2 text-muted flex items-center justify-center" title={t('split.form.cancel')}>
                          <X className="w-4 h-4" strokeWidth={1.8} />
                        </button>
                        <button
                          onClick={() => confirmSettle(transfer)}
                          disabled={!settleAmount || !parseFloat(settleAmount)}
                          className="flex-1 rounded-lg bg-plan text-card py-2 disabled:opacity-40 flex items-center justify-center gap-1.5"
                          title={t('split.form.confirmSettled')}
                        >
                          <CircleCheck className="w-4 h-4" strokeWidth={1.8} />
                          <span className="text-[12.5px] font-medium">{t('split.form.confirmSettled')}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-[12.5px] text-muted text-center py-1">{t('split.suggestion.balanced')}</div>
        )}
      </div>

      {(openDebts.length > 0 || prepayBalances.length > 0 || closedDebts.length > 0) && (
        <div className="bg-card border border-line rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] tracking-widest uppercase text-muted">{t('split.byItem.heading')}</div>
            <div className="text-[10.5px] text-muted">{t('split.byItem.unsettledCount', { count: visibleDebts.length })}</div>
          </div>
          {prepayBalances.map((p) => (
            <div
              key={`${p.fromMemberId}:${p.toMemberId}`}
              className="flex items-center gap-1.5 rounded-lg bg-plan/5 border border-plan/25 px-2.5 py-1.5 mb-2 text-[10.5px]"
            >
              <span>
                {t('split.byItem.prepayLeft', {
                  from: nameOf(p.fromMemberId),
                  to: nameOf(p.toMemberId),
                  amount: formatMoney(p.remaining),
                })}
              </span>
            </div>
          ))}
          {distinctPairs.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-2 pb-0.5">
              <button
                onClick={() => setPairFilter(null)}
                className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[10.5px] border ${
                  effectivePairFilter === null ? 'bg-plan text-card border-plan font-medium' : 'border-line text-muted'
                }`}
              >
                {t('split.byItem.filterAll')}
              </button>
              {distinctPairs.map((d) => {
                const key = pairKey(d)
                return (
                  <button
                    key={key}
                    onClick={() => setPairFilter(key)}
                    className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[10.5px] border whitespace-nowrap ${
                      effectivePairFilter === key ? 'bg-plan text-card border-plan font-medium' : 'border-line text-muted'
                    }`}
                  >
                    {nameOf(d.debtorId)}→{nameOf(d.creditorId)}
                  </button>
                )
              })}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {visibleDebts.map((d) => {
              const key = debtKey(d)
              const checked = selectedDebtKeys.has(key)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleDebt(d)}
                  className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left ${
                    checked ? 'border-plan bg-plan/5' : 'border-line bg-paper'
                  }`}
                >
                  <span
                    className={`w-[18px] h-[18px] rounded-md border-[1.5px] flex-shrink-0 flex items-center justify-center ${
                      checked ? 'bg-plan border-plan' : 'border-line'
                    }`}
                  >
                    {checked && <Check className="w-3 h-3 text-card" strokeWidth={2.5} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium truncate">{titleOf(d)}</div>
                    <div className="text-[10.5px] text-muted">
                      {t('split.byItem.owes', { debtor: nameOf(d.debtorId), creditor: nameOf(d.creditorId) })}
                      {d.prepaidAmount > 0.01 && (
                        <span className="text-positive">
                          {t('split.byItem.prepaidApplied', { amount: formatMoney(d.prepaidAmount) })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-[13px] font-semibold tabular flex-shrink-0">{formatMoney(d.remaining)}</div>
                </button>
              )
            })}
          </div>
          {selectedDebts.length > 0 && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-dashed border-line">
              <div className="text-[11.5px] text-muted">
                {t('split.byItem.selectedSummary', { count: selectedDebts.length, total: formatMoney(selectedTotal) })}
              </div>
              <button
                onClick={openItemSettle}
                className="rounded-full bg-plan text-card px-4 py-1.5 text-[12px] font-medium"
              >
                {t('split.byItem.settleSelected', { count: selectedDebts.length })}
              </button>
            </div>
          )}
          {closedDebts.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowClosed((v) => !v)}
                className="w-full flex items-center justify-center gap-1 pt-2.5 mt-2 border-t border-dashed border-line text-plan text-[10.5px] font-semibold"
              >
                <ChevronDown
                  className={`w-3 h-3 transition-transform duration-200 ${showClosed ? 'rotate-180' : ''}`}
                  strokeWidth={2.2}
                />
                {showClosed
                  ? t('split.byItem.collapseClosed')
                  : t('split.byItem.viewClosed', { count: closedDebts.length })}
              </button>
              {showClosed && (
                <div className="flex flex-col gap-1.5 mt-2">
                  {closedDebts.map((d) => (
                    <div key={debtKey(d)} className="flex items-center gap-2.5 rounded-xl border border-line bg-paper p-2.5 opacity-70">
                      <span className="w-[18px] h-[18px] rounded-md bg-muted flex-shrink-0 flex items-center justify-center">
                        <Check className="w-3 h-3 text-card" strokeWidth={2.5} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-medium truncate text-muted">{titleOf(d)}</div>
                        <div className="text-[10.5px] text-muted">
                          {t('split.byItem.owes', { debtor: nameOf(d.debtorId), creditor: nameOf(d.creditorId) })}
                        </div>
                      </div>
                      {d.settledAmount > 0.01 && (
                        <span className="text-[8.5px] px-1.5 py-0.5 rounded-full bg-plan/10 text-plan font-semibold flex-shrink-0">{t('split.byItem.badgeByItem')}</span>
                      )}
                      {d.prepaidAmount > 0.01 && (
                        <span className="text-[8.5px] px-1.5 py-0.5 rounded-full bg-positive/10 text-positive font-semibold flex-shrink-0">
                          {d.settledAmount > 0.01 ? t('split.byItem.badgePrepayPlus') : t('split.byItem.badgePrepayOnly')}
                        </span>
                      )}
                      <div className="text-[13px] font-semibold tabular text-muted flex-shrink-0">{formatMoney(d.totalShare)}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="bg-card border border-line rounded-2xl p-4 mb-4">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[11px] tracking-widest uppercase text-muted">{t('split.records.heading')}</div>
          <button onClick={openManualSettle} className="flex items-center gap-1 text-plan text-[11.5px] font-semibold">
            <Plus className="w-3 h-3" strokeWidth={2.2} />
            {t('split.records.add')}
          </button>
        </div>
        {settlements.length === 0 ? (
          <div className="text-[11.5px] text-muted text-center py-2">
            {t('split.records.empty')}
          </div>
        ) : (
          <>
          {settlements.map((s) => (
            <div key={s.id}>
              <div className="flex items-center gap-2 py-2.5 border-t border-line first:border-t-0">
                <Avatar member={memberOf(s.fromMemberId)} size={22} />
                <span className="text-[12.5px]">{nameOf(s.fromMemberId)}</span>
                <span className="text-plan text-[13px]">→</span>
                <Avatar member={memberOf(s.toMemberId)} size={22} />
                <span className="text-[12.5px]">{nameOf(s.toMemberId)}</span>
                <div className="ml-auto text-right">
                  <div className="font-serif-sc text-[14px] tabular">{formatMoney(s.amount)}</div>
                  <div className="text-[10.5px] text-muted">{s.settledDate.slice(5).replace('-', '/')}{s.note ? ` · ${s.note}` : ''}</div>
                </div>
                <button onClick={() => startEdit(s)} className="w-6 h-6 rounded-lg border border-line bg-paper flex items-center justify-center text-muted flex-shrink-0" title={t('split.records.edit')}>
                  <Pencil className="w-3 h-3" strokeWidth={1.8} />
                </button>
                <button onClick={() => setConfirmDeleteId(s.id)} className="w-6 h-6 rounded-lg border border-line bg-paper flex items-center justify-center text-muted flex-shrink-0" title={t('split.records.delete')}>
                  <Trash2 className="w-3 h-3" strokeWidth={1.8} />
                </button>
              </div>

              {editingId === s.id && (
                <div className="mb-2 p-3 rounded-xl bg-paper border border-line flex flex-col gap-2">
                  <div className="flex gap-2">
                    <input
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      inputMode="decimal"
                      className="flex-1 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] tabular outline-none focus:border-plan"
                    />
                    <div className="flex-1">
                      <DatePicker value={editDate} onChange={setEditDate} />
                    </div>
                  </div>
                  <input
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                    placeholder={t('split.records.notePlaceholder')}
                    className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] outline-none focus:border-plan"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => setEditingId(null)} className="flex-1 rounded-lg border border-line py-2 text-muted flex items-center justify-center" title={t('split.form.cancel')}>
                      <X className="w-4 h-4" strokeWidth={1.8} />
                    </button>
                    <button onClick={saveEdit} disabled={!editAmount || !parseFloat(editAmount)} className="flex-1 rounded-lg bg-plan text-card py-2 disabled:opacity-40 flex items-center justify-center" title={t('split.records.save')}>
                      <Check className="w-4 h-4" strokeWidth={2} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          </>
        )}
      </div>

      <div className="font-serif-sc text-[13.5px] font-semibold mb-2">{t('split.balances.heading')}</div>
      <div className="flex flex-col gap-2">
        {balances
          .sort((a, b) => b.net - a.net)
          .map((b) => {
            const settled = Math.abs(b.net) < 0.5 && (b.settledOut > 0 || b.settledIn > 0)
            return (
              <div key={b.memberId} className="bg-card border border-line rounded-2xl p-3">
                <div className="flex justify-between items-baseline">
                  <span className="flex items-center gap-2 text-[13.5px] font-medium">
                    <Avatar member={memberOf(b.memberId)} />
                    {nameOf(b.memberId)}
                  </span>
                  <span
                    className="text-[13px] font-medium tabular"
                    style={{ color: settled ? 'var(--color-muted)' : b.net >= 0 ? 'var(--color-positive)' : 'var(--color-negative)' }}
                  >
                    {settled
                      ? t('split.balances.settled')
                      : b.net >= 0
                        ? t('split.balances.receivable', { amount: formatMoney(b.net) })
                        : t('split.balances.payable', { amount: formatMoney(-b.net) })}
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-line overflow-hidden">
                  <div
                    className="bar-fill h-full rounded-full"
                    style={{
                      width: `${Math.min(100, Math.round((Math.abs(b.net) / Math.max(1, Math.max(b.paid, b.owed))) * 100))}%`,
                      background: settled ? 'var(--color-muted)' : b.net >= 0 ? 'var(--color-positive)' : 'var(--color-negative)',
                    }}
                  />
                </div>
                {/* 拼成数组再join，而不是把" · 已还X"这种带分隔符的片段直接塞进JSX——
                    每一段各自是一条完整的翻译key，分隔符只由这里统一负责，
                    英文里段与段的措辞不用为了迁就分隔符而妥协 */}
                <div className="mt-1.5 text-[11px] text-muted">
                  {[
                    t('split.balances.paid', { amount: formatMoney(b.paid) }),
                    t('split.balances.expenseCount', { count: b.expenseCount }),
                    t('split.balances.share', { amount: formatMoney(b.owed) }),
                    b.settledOut > 0 ? t('split.balances.repaid', { amount: formatMoney(b.settledOut) }) : null,
                    b.settledIn > 0 ? t('split.balances.received', { amount: formatMoney(b.settledIn) }) : null,
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
            )
          })}
      </div>

      {confirmDeleteId && (
        <ConfirmDialog
          title={t('split.records.deleteConfirmTitle')}
          message={t('split.records.deleteConfirmMessage')}
          onConfirm={() => { deleteSettlement(confirmDeleteId); setConfirmDeleteId(null) }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}

      {itemSettleOpen && (
        <CenteredModal onClose={() => setItemSettleOpen(false)}>
          <div className="font-serif-sc text-[15px] text-ink mb-1">
            {t('split.form.itemSettleTitle', { count: selectedDebts.length })}
          </div>
          <div className="text-[11px] text-muted mb-3">
            {selectedDebts.length === 1
              ? t('split.form.itemSettleSingleDetail', {
                  title: titleOf(selectedDebts[0]),
                  debtor: nameOf(selectedDebts[0].debtorId),
                  creditor: nameOf(selectedDebts[0].creditorId),
                })
              : t('split.form.itemSettleMultiDetail')}
          </div>
          <label className="text-[11px] text-muted block mb-2.5">
            {selectedDebts.length === 1 ? t('split.form.amountLabelPartial') : t('split.form.amountLabel')}
            <input
              value={itemSettleAmount}
              onChange={(e) => setItemSettleAmount(e.target.value)}
              disabled={selectedDebts.length > 1}
              inputMode="decimal"
              className="block w-full mt-1 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[13px] tabular outline-none focus:border-plan disabled:opacity-60"
            />
          </label>
          <label className="text-[11px] text-muted block mb-2.5">
            {t('split.form.dateLabel')}
            <div className="mt-1">
              <DatePicker value={itemSettleDate} onChange={setItemSettleDate} />
            </div>
          </label>
          <label className="text-[11px] text-muted block">
            {t('split.form.noteLabel')}
            <input
              value={itemSettleNote}
              onChange={(e) => setItemSettleNote(e.target.value)}
              placeholder={t('split.form.notePlaceholderMethod')}
              className="block w-full mt-1 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[13px] outline-none focus:border-plan"
            />
          </label>
          <div className="flex gap-2 mt-4">
            <button onClick={() => setItemSettleOpen(false)} className="flex-1 rounded-xl border border-line py-2 text-muted flex items-center justify-center" title={t('split.form.cancel')}>
              <X className="w-4 h-4" strokeWidth={1.8} />
            </button>
            <button
              onClick={confirmSettleItems}
              disabled={selectedDebts.length === 1 && !(parseFloat(itemSettleAmount) > 0)}
              className="flex-1 rounded-xl bg-plan text-card py-2 disabled:opacity-40 flex items-center justify-center gap-1.5"
              title={t('split.form.confirmSettled')}
            >
              <CircleCheck className="w-4 h-4" strokeWidth={1.8} />
              <span className="text-[12.5px] font-medium">{t('split.form.confirmSettled')}</span>
            </button>
          </div>
        </CenteredModal>
      )}

      {manualSettleOpen && (
        <ManualSettleModal
          members={members}
          from={manualFrom}
          to={manualTo}
          amount={manualAmount}
          date={manualDate}
          note={manualNote}
          onFromChange={setManualFrom}
          onToChange={setManualTo}
          onAmountChange={setManualAmount}
          onDateChange={setManualDate}
          onNoteChange={setManualNote}
          onCancel={() => setManualSettleOpen(false)}
          onConfirm={confirmManualSettle}
        />
      )}

      {successMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <SuccessToast label={successMsg} />
        </div>
      )}
    </div>
  )
}
