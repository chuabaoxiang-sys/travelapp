import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { X, CheckCheck, Trash2, Check } from 'lucide-react'
import { db, ensureItineraryDay } from '../../db/dexie'
import { DatePicker } from '../../components/DatePicker'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { dateRange } from '../../lib/dates'
import { RateChipRow, type RateSelection } from '../rates/RateChipRow'
import { createRateBookEntry, recordRateUsage } from '../../domain/rates'
import { saveExpenseSplits } from '../../domain/splits'
import { categoryColor } from '../../lib/categoryColors'
import { CategoryIcon } from '../../components/CategoryBadge'
import { Avatar } from '../../components/Avatar'
import type { Trip, ExpensePhase, Expense, SplitType, ExpenseSplit } from '../../types'

export function AddExpenseSheet({
  trip,
  currentMemberId,
  initial,
  onClose,
}: {
  trip: Trip
  currentMemberId: string
  initial?: Expense
  onClose: () => void
}) {
  const categories = useLiveQuery(() => db.expenseCategories.toArray()) ?? []
  const members = useLiveQuery(() => db.members.toArray()) ?? []
  const itineraryDays = useLiveQuery(() => db.itineraryDays.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const itineraryItems = useLiveQuery(() => db.itineraryItems.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const tripDates = trip.startDate && trip.endDate ? dateRange(trip.startDate, trip.endDate) : []

  const [linkOpen, setLinkOpen] = useState(!!initial?.itineraryDayId)
  const [linkDate, setLinkDate] = useState('')
  const [linkItemId, setLinkItemId] = useState<string | null>(initial?.itineraryItemId ?? null)

  // itineraryDays 是 Dexie 的 useLiveQuery，首次渲染时还没查完（值是空数组），
  // 不能只靠 useState 的初始值去回填编辑时已关联的那一天——那样第一帧永远是空数组，
  // 算出来的日期必然是''。用 useEffect 等 itineraryDays 真正查到数据后再回填一次。
  const linkInitialized = useRef(false)
  useEffect(() => {
    if (linkInitialized.current) return
    if (!initial?.itineraryDayId) return
    const day = itineraryDays.find((d) => d.id === initial.itineraryDayId)
    if (!day) return // 数据还没到，等下一次 itineraryDays 更新再试
    setLinkDate(day.date)
    linkInitialized.current = true
  }, [itineraryDays, initial?.itineraryDayId])

  const [phase, setPhase] = useState<ExpensePhase>(initial?.phase ?? 'during_trip')
  const [categoryId, setCategoryId] = useState<string>(initial?.categoryId ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [currency, setCurrency] = useState(initial?.expenseCurrency ?? trip.homeCurrency)
  const [amount, setAmount] = useState(initial ? String(initial.expenseAmount) : '')
  const [rateSelection, setRateSelection] = useState<RateSelection>(
    initial?.rateBookEntryId ? { mode: 'existing', entryId: initial.rateBookEntryId, rate: initial.rateUsed } : { mode: 'none' },
  )
  const [payer, setPayer] = useState(initial?.paidBy ?? currentMemberId)
  const [expenseDate, setExpenseDate] = useState(initial?.expenseDate ?? trip.startDate ?? new Date().toISOString().slice(0, 10))

  // "大家分摊/个人开销"用独立状态记录，而不是从 splitMemberIds.length 推导——
  // 否则在"大家分摊"模式里手动取消勾选到只剩1人时，界面会突然塌成"个人开销"的样子，
  // 用户还在调整名单就被打断。splitType 是同步字段，不用等异步查询就能确定初始值
  const [mode, setMode] = useState<'share' | 'personal'>(initial?.splitType === 'none' ? 'personal' : 'share')

  // 分摊对象：新记账默认勾选全部成员（家庭场景下最常见的就是大家平摊）；
  // 编辑已有账目则要回填它原本的分摊名单。两边都依赖异步查询（members / expenseSplits），
  // 所以跟前面"关联行程"那处一样，用 useEffect + ref 只回填一次，避免空数组当成初始值
  const [splitMemberIds, setSplitMemberIds] = useState<string[]>([])
  const splitInitialized = useRef(false)
  const existingSplits = useLiveQuery(
    () => (initial ? db.expenseSplits.where('expenseId').equals(initial.id).toArray() : Promise.resolve<ExpenseSplit[]>([])),
    [initial?.id],
  ) ?? []
  useEffect(() => {
    if (splitInitialized.current) return
    if (initial) {
      if (!existingSplits.length) return
      setSplitMemberIds(existingSplits.map((s) => s.memberId))
      splitInitialized.current = true
    } else {
      if (!members.length) return
      setSplitMemberIds(members.map((m) => m.id))
      splitInitialized.current = true
    }
  }, [initial, existingSplits, members])

  const visibleCategories = categories.filter((c) => c.phase === phase || c.phase === 'either')
  const isForeign = currency !== trip.homeCurrency
  const numAmount = parseFloat(amount) || 0
  // 编辑已有账目、且还没碰过汇率选择时，先用当初快照的 rateUsed 顶着，不强行要求重新选一次；
  // 一旦用户点了别的chip或改了新汇率，rateSelection 就会有值，改用那个
  const numRate = !isForeign ? 1 : rateSelection.mode !== 'none' ? rateSelection.rate : initial?.rateUsed ?? 0
  const homeAmount = numAmount * numRate
  const rateReady = !isForeign || numRate > 0

  async function save() {
    if (!numAmount || !categoryId || !rateReady) return

    // 只有用户真的选了某一天才落地 itineraryDay（哪怕时间线里还没手动建过这一天）；
    // 没打开"关联到行程"这个环节，或者打开了但没选具体日期，就是不关联
    let itineraryDayId: string | null = null
    if (linkOpen && linkDate) {
      const day = await ensureItineraryDay(trip.id, linkDate)
      itineraryDayId = day.id
    }
    const itineraryItemId = itineraryDayId ? linkItemId : null

    // 汇率簿落地：选了已有chip就更新它的"最近使用"；填了新标签就先落一条新纪录，
    // 两种情况都要拿到最终的 rateBookEntryId 存进这笔账目里
    let rateBookEntryId: string | null = initial?.rateBookEntryId ?? null
    if (isForeign) {
      if (rateSelection.mode === 'existing') {
        rateBookEntryId = rateSelection.entryId
        await recordRateUsage(rateSelection.entryId)
      } else if (rateSelection.mode === 'new') {
        const entry = await createRateBookEntry({
          tripId: trip.id,
          foreignCurrency: currency,
          label: rateSelection.label,
          rate: rateSelection.rate,
          source: rateSelection.source,
          createdBy: currentMemberId,
        })
        rateBookEntryId = entry.id
      }
    } else {
      rateBookEntryId = null
    }

    // 只勾了付款人自己（或者干脆没勾人）就算不分摊；勾了2个人以上才是均摊
    const splitType: SplitType = splitMemberIds.length >= 2 ? 'equal' : 'none'
    const expenseId = initial?.id ?? crypto.randomUUID()

    if (initial) {
      await db.expenses.update(initial.id, {
        categoryId,
        phase,
        description: description.trim() || null,
        expenseCurrency: currency,
        expenseAmount: numAmount,
        rateBookEntryId,
        rateUsed: numRate,
        homeAmount,
        paidBy: payer,
        expenseDate,
        itineraryDayId,
        itineraryItemId,
        splitType,
        updatedAt: Date.now(),
      })
    } else {
      const id = expenseId
      const now = Date.now()
      await db.expenses.add({
        id,
        tripId: trip.id,
        categoryId,
        phase,
        description: description.trim() || null,
        expenseCurrency: currency,
        expenseAmount: numAmount,
        rateBookEntryId,
        rateUsed: numRate,
        homeAmount,
        paidBy: payer,
        recordedBy: currentMemberId,
        expenseDate,
        itineraryDayId,
        itineraryItemId,
        splitType,
        createdAt: now,
        updatedAt: now,
      })
    }

    await saveExpenseSplits(expenseId, homeAmount, splitType, splitMemberIds, payer)
    onClose()
  }

  const [confirmingDelete, setConfirmingDelete] = useState(false)

  async function remove() {
    if (!initial) return
    await db.expenseSplits.where('expenseId').equals(initial.id).delete()
    await db.expenses.delete(initial.id)
    onClose()
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <div className="flex-1 bg-ink/35" onClick={onClose} />
      <div className="bg-paper rounded-t-[26px] px-5 pt-3.5 pb-7 shadow-[0_-10px_40px_rgba(31,27,22,0.2)] max-h-[88%] overflow-y-auto no-scrollbar">
        <div className="w-[38px] h-1 rounded-full bg-[#D8CFC0] mx-auto mb-3.5" />
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-sm font-semibold">{initial ? '编辑这笔' : '记一笔'}</span>
          <button onClick={onClose} className="text-muted" title="取消">
            <X className="w-4 h-4" strokeWidth={1.8} />
          </button>
        </div>

        <div className="flex gap-1 bg-[#EDE6DA] rounded-xl p-1 my-2.5 w-fit">
          {(['pre_trip', 'during_trip'] as ExpensePhase[]).map((p) => (
            <button
              key={p}
              onClick={() => { setPhase(p); setCategoryId('') }}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] ${phase === p ? 'bg-ink text-paper' : 'text-[#8A8177]'}`}
            >
              {p === 'pre_trip' ? '出行前' : '途中'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5 py-1">
          {visibleCategories.map((c) => {
            const color = categoryColor(c)
            const selected = categoryId === c.id
            return (
              <button
                key={c.id}
                onClick={() => setCategoryId(c.id)}
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

        {tripDates.length > 0 && (
          <div className="mt-1">
            {!linkOpen ? (
              <button
                type="button"
                onClick={() => setLinkOpen(true)}
                className="text-[12px] text-plan"
              >
                🔗 关联到行程里的某天/某个行程项（可选）
              </button>
            ) : (
              <div className="bg-card border border-line rounded-xl p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10.5px] tracking-widest uppercase text-muted">关联到行程</span>
                  <button
                    type="button"
                    onClick={() => { setLinkOpen(false); setLinkDate(''); setLinkItemId(null) }}
                    className="text-[11px] text-muted"
                  >
                    不关联
                  </button>
                </div>
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
                  {tripDates.map((d) => {
                    const num = d.slice(-2).replace(/^0/, '')
                    const isActive = d === linkDate
                    return (
                      <button
                        type="button"
                        key={d}
                        onClick={() => { setLinkDate(d); setLinkItemId(null) }}
                        className={`flex-shrink-0 rounded-lg px-2.5 py-1.5 text-[11.5px] tabular border ${
                          isActive ? 'bg-ink text-paper border-ink' : 'bg-paper border-line text-[#57534E]'
                        }`}
                      >
                        {num}日
                      </button>
                    )
                  })}
                </div>
                {linkDate && (() => {
                  const day = itineraryDays.find((d) => d.date === linkDate)
                  const dayItems = day ? itineraryItems.filter((it) => it.dayId === day.id) : []
                  if (!dayItems.length) {
                    return <div className="text-[11px] text-muted mt-1.5">这天还没有行程项，只会挂到「这一天」</div>
                  }
                  return (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <button
                        type="button"
                        onClick={() => setLinkItemId(null)}
                        className={`rounded-full px-2.5 py-1 text-[11px] border ${
                          !linkItemId ? 'bg-plan text-card border-plan' : 'bg-paper border-line text-[#57534E]'
                        }`}
                      >
                        只挂到这一天
                      </button>
                      {dayItems.map((it) => (
                        <button
                          type="button"
                          key={it.id}
                          onClick={() => setLinkItemId(it.id)}
                          className={`rounded-full px-2.5 py-1 text-[11px] border ${
                            linkItemId === it.id ? 'bg-plan text-card border-plan' : 'bg-paper border-line text-[#57534E]'
                          }`}
                        >
                          {it.title}
                        </button>
                      ))}
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-[1fr_84px] gap-2 mt-3">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="金额"
            className="rounded-xl border border-line bg-card px-3 py-2.5 text-lg font-serif-sc tabular outline-none focus:border-plan min-w-0"
          />
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            placeholder="币种"
            className="rounded-xl border border-line bg-card px-2 py-2.5 text-sm text-center uppercase outline-none focus:border-plan min-w-0"
          />
        </div>

        {isForeign && (
          <div className="mt-2">
            <div className="text-[10.5px] tracking-widest uppercase text-muted mb-1">
              选择汇率（{currency} → {trip.homeCurrency}）
            </div>
            <RateChipRow
              tripId={trip.id}
              currency={currency}
              homeCurrency={trip.homeCurrency}
              value={rateSelection}
              onChange={setRateSelection}
            />
            <div className="text-[11px] text-muted mt-1.5">
              {numRate > 0 ? <>≈ {trip.homeCurrency} {homeAmount.toFixed(2)}</> : '请选择或新增一个汇率'}
            </div>
          </div>
        )}

        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="备注（可选）"
          className="w-full mt-2 rounded-xl border border-line bg-card px-3 py-2 text-sm outline-none focus:border-plan"
        />

        <div className="text-[10.5px] tracking-widest uppercase text-muted mt-3 mb-1">日期</div>
        <DatePicker value={expenseDate} onChange={setExpenseDate} />

        <div className="text-[10.5px] tracking-widest uppercase text-muted mt-3 mb-1">付款人</div>
        <div className="flex flex-wrap gap-1.5">
          {members.map((m) => (
            <button
              key={m.id}
              onClick={() => setPayer(m.id)}
              className={`flex items-center gap-1.5 rounded-full pl-1.5 pr-3.5 py-1.5 text-[12.5px] border ${
                payer === m.id ? 'bg-ink text-paper border-ink' : 'bg-card border-line text-[#57534E]'
              }`}
            >
              <Avatar member={m} size={20} />
              {m.displayName}垫付
            </button>
          ))}
        </div>

        <div className="text-[10.5px] tracking-widest uppercase text-muted mt-3 mb-1">这笔怎么算</div>
        <div className="flex border border-line rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => { setMode('share'); setSplitMemberIds(members.map((m) => m.id)) }}
            className={`flex-1 py-2 text-[12.5px] ${mode === 'share' ? 'bg-plan text-card font-medium' : 'text-muted'}`}
          >
            大家分摊
          </button>
          <button
            type="button"
            onClick={() => { setMode('personal'); setSplitMemberIds([]) }}
            className={`flex-1 py-2 text-[12.5px] ${mode === 'personal' ? 'bg-plan text-card font-medium' : 'text-muted'}`}
          >
            个人开销
          </button>
        </div>

        {mode === 'share' ? (
          <>
            <div className="flex items-center justify-between mt-3 mb-1">
              <span className="text-[10.5px] tracking-widest uppercase text-muted">
                分摊给{splitMemberIds.length >= 2 ? `（各 ${homeAmount ? (homeAmount / splitMemberIds.length).toFixed(2) : '0.00'}）` : ''}
              </span>
              {splitMemberIds.length !== members.length && (
                <button
                  type="button"
                  onClick={() => setSplitMemberIds(members.map((m) => m.id))}
                  className="text-plan"
                  title="全选"
                >
                  <CheckCheck className="w-[15px] h-[15px]" strokeWidth={1.8} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => {
                const checked = splitMemberIds.includes(m.id)
                return (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() =>
                      setSplitMemberIds((prev) => (checked ? prev.filter((id) => id !== m.id) : [...prev, m.id]))
                    }
                    className={`flex items-center gap-1.5 rounded-full pl-1.5 pr-3.5 py-1.5 text-[12.5px] border ${
                      checked ? 'bg-plan/10 border-plan text-plan font-medium' : 'bg-card border-line text-[#57534E]'
                    }`}
                  >
                    <Avatar member={m} size={20} />
                    {m.displayName} {checked ? '✓' : ''}
                  </button>
                )
              })}
            </div>
            {splitMemberIds.length === 1 && (
              <div className="text-[11px] text-muted mt-1">只勾了一个人 = 算这个人自己的，不分摊</div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2 mt-3 text-[12px] text-muted bg-card border border-dashed border-line rounded-xl px-3 py-2.5">
            <Avatar member={members.find((m) => m.id === payer)} size={20} />
            这笔算{members.find((m) => m.id === payer)?.displayName ?? '付款人'}自己的开销，不会出现在"分账"的结算里。
          </div>
        )}

        <div className="flex gap-2 mt-4">
          {initial && (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="rounded-2xl border border-negative/30 text-negative px-4 py-3.5"
              title="删除"
            >
              <Trash2 className="w-[18px] h-[18px]" strokeWidth={1.8} />
            </button>
          )}
          <button
            onClick={save}
            disabled={!numAmount || !categoryId || !rateReady}
            className="flex-1 rounded-2xl bg-plan text-card py-3.5 disabled:opacity-40 flex items-center justify-center"
            title={initial ? '保存修改' : '保存这笔'}
          >
            <Check className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          title="删除这笔记录？"
          onConfirm={remove}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  )
}
