import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { X, CircleCheck, Pencil, Trash2, Check } from 'lucide-react'
import { db } from '../../db/dexie'
import { computeBalances, simplifyDebts, type Transfer } from '../../domain/splits'
import { getSettlements, createSettlement, updateSettlement, deleteSettlement } from '../../domain/settlements'
import { formatMoney } from '../../lib/money'
import { toLocalDateString } from '../../lib/dates'
import { Avatar } from '../../components/Avatar'
import { DatePicker } from '../../components/DatePicker'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import type { Trip, Settlement } from '../../types'

export function SplitTab({ trip, currentMemberId }: { trip: Trip; currentMemberId: string }) {
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

  const [openKey, setOpenKey] = useState<string | null>(null)
  const [settleAmount, setSettleAmount] = useState('')
  const [settleDate, setSettleDate] = useState('')
  const [settleNote, setSettleNote] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editNote, setEditNote] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  function memberOf(id: string) {
    return members.find((m) => m.id === id)
  }
  function nameOf(id: string) {
    return memberOf(id)?.displayName ?? '未知'
  }

  const transfers = simplifyDebts(balances)
  const hasAnyMoney = balances.some((b) => b.paid > 0 || b.owed > 0)

  function openSettle(t: Transfer) {
    const key = `${t.from}-${t.to}`
    if (openKey === key) {
      setOpenKey(null)
      return
    }
    setOpenKey(key)
    setSettleAmount(String(t.amount))
    setSettleDate(toLocalDateString(new Date()))
    setSettleNote('')
  }

  async function confirmSettle(t: Transfer) {
    const amount = parseFloat(settleAmount)
    if (!amount) return
    await createSettlement({
      tripId: trip.id,
      fromMemberId: t.from,
      toMemberId: t.to,
      amount,
      settledDate: settleDate,
      note: settleNote.trim() || null,
      createdBy: currentMemberId,
    })
    setOpenKey(null)
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
        <div className="w-[60px] h-[60px] rounded-full bg-[#EDE6DA] flex items-center justify-center font-serif-sc text-2xl text-muted">分</div>
        <div className="font-serif-sc text-[15px] mt-2">还没有可以结算的账目</div>
        <div className="text-[12.5px] text-muted max-w-[220px]">记账时勾选"分摊给"多个人，这里就会自动算出谁该收谁的钱。</div>
      </div>
    )
  }

  return (
    <div className="px-5 pt-3 pb-safe-fab-clearance overflow-y-auto no-scrollbar h-full">
      <div className="font-serif-sc text-sm font-semibold mb-3">费用分摊 · 按人结算</div>

      <div className="bg-card border border-line rounded-2xl p-4 mb-4">
        <div className="text-[11px] tracking-widest uppercase text-muted text-center mb-3">
          {transfers.length > 0 ? `结算建议 · 还剩 ${transfers.length} 笔` : '结算建议'}
        </div>
        {transfers.length > 0 ? (
          <div className="flex flex-col gap-3">
            {transfers.map((t, i) => {
              const key = `${t.from}-${t.to}`
              const isOpen = openKey === key
              return (
                <div key={i} className="border border-line rounded-xl p-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar member={memberOf(t.from)} />
                    <span className="text-[13px] font-medium">{nameOf(t.from)}</span>
                    <span className="text-plan">→</span>
                    <Avatar member={memberOf(t.to)} />
                    <span className="text-[13px] font-medium">{nameOf(t.to)}</span>
                    <span className="font-serif-sc text-[16px] tabular ml-auto">{formatMoney(t.amount)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => openSettle(t)}
                    className={`w-full mt-2 rounded-full py-1.5 text-[12px] font-medium ${
                      isOpen ? 'bg-line text-muted' : 'bg-plan text-card'
                    }`}
                  >
                    {isOpen ? '收起' : '去结算'}
                  </button>

                  {isOpen && (
                    <div className="mt-2.5 p-3 rounded-xl bg-plan/5 border border-dashed border-plan/30 flex flex-col gap-2.5">
                      <div className="flex gap-2">
                        <label className="flex-1 text-[11px] text-muted">
                          金额（可部分结清）
                          <input
                            value={settleAmount}
                            onChange={(e) => setSettleAmount(e.target.value)}
                            inputMode="decimal"
                            className="block w-full mt-1 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] tabular outline-none focus:border-plan"
                          />
                        </label>
                        <label className="flex-1 text-[11px] text-muted">
                          日期
                          <div className="mt-1">
                            <DatePicker value={settleDate} onChange={setSettleDate} />
                          </div>
                        </label>
                      </div>
                      <label className="text-[11px] text-muted">
                        备注（可选）
                        <input
                          value={settleNote}
                          onChange={(e) => setSettleNote(e.target.value)}
                          placeholder="例如：现金 / 转账"
                          className="block w-full mt-1 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] outline-none focus:border-plan"
                        />
                      </label>
                      <div className="flex gap-2">
                        <button onClick={() => setOpenKey(null)} className="flex-1 rounded-lg border border-line py-2 text-muted flex items-center justify-center" title="取消">
                          <X className="w-4 h-4" strokeWidth={1.8} />
                        </button>
                        <button
                          onClick={() => confirmSettle(t)}
                          disabled={!settleAmount || !parseFloat(settleAmount)}
                          className="flex-1 rounded-lg bg-plan text-card py-2 disabled:opacity-40 flex items-center justify-center gap-1.5"
                          title="确认已结清"
                        >
                          <CircleCheck className="w-4 h-4" strokeWidth={1.8} />
                          <span className="text-[12.5px] font-medium">确认已结清</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-[12.5px] text-muted text-center py-1">目前收支刚好抵消，不需要转账</div>
        )}
      </div>

      {settlements.length > 0 && (
        <div className="bg-card border border-line rounded-2xl p-4 mb-4">
          <div className="text-[11px] tracking-widest uppercase text-muted mb-1">结算记录</div>
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
                <button onClick={() => startEdit(s)} className="w-6 h-6 rounded-lg border border-line bg-paper flex items-center justify-center text-muted flex-shrink-0" title="编辑">
                  <Pencil className="w-3 h-3" strokeWidth={1.8} />
                </button>
                <button onClick={() => setConfirmDeleteId(s.id)} className="w-6 h-6 rounded-lg border border-line bg-paper flex items-center justify-center text-muted flex-shrink-0" title="删除">
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
                    placeholder="备注（可选）"
                    className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] outline-none focus:border-plan"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => setEditingId(null)} className="flex-1 rounded-lg border border-line py-2 text-muted flex items-center justify-center" title="取消">
                      <X className="w-4 h-4" strokeWidth={1.8} />
                    </button>
                    <button onClick={saveEdit} disabled={!editAmount || !parseFloat(editAmount)} className="flex-1 rounded-lg bg-plan text-card py-2 disabled:opacity-40 flex items-center justify-center" title="保存">
                      <Check className="w-4 h-4" strokeWidth={2} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="font-serif-sc text-[13.5px] font-semibold mb-2">谁付了多少</div>
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
                    style={{ color: settled ? '#8A8071' : b.net >= 0 ? '#0F766E' : '#B91C1C' }}
                  >
                    {settled ? '已结清' : b.net >= 0 ? `应收 ${formatMoney(b.net)}` : `应付 ${formatMoney(-b.net)}`}
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-line overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, Math.round((Math.abs(b.net) / Math.max(1, Math.max(b.paid, b.owed))) * 100))}%`,
                      background: settled ? '#8A8071' : b.net >= 0 ? '#0F766E' : '#B91C1C',
                    }}
                  />
                </div>
                <div className="mt-1.5 text-[11px] text-muted">
                  垫付 {formatMoney(b.paid)} · {b.expenseCount} 笔 · 应分摊 {formatMoney(b.owed)}
                  {b.settledOut > 0 && ` · 已还 ${formatMoney(b.settledOut)}`}
                  {b.settledIn > 0 && ` · 已收 ${formatMoney(b.settledIn)}`}
                </div>
              </div>
            )
          })}
      </div>

      {confirmDeleteId && (
        <ConfirmDialog
          title="删除这条结算记录？"
          message="只是撤销这笔结款记录，对应的应收/应付金额会恢复，不影响其他记录。"
          onConfirm={() => { deleteSettlement(confirmDeleteId); setConfirmDeleteId(null) }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  )
}
