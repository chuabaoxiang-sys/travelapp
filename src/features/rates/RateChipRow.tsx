import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, AlertTriangle, ChevronRight, ChevronLeft } from 'lucide-react'
import { getRateBookEntries, suggestLabels, usageByEntry, deriveRateFromExchangeAmounts, type RateEntryUsage } from '../../domain/rates'
import { fetchReferenceRate } from '../../api/fx'
import { ExchangeAmountFields } from './ExchangeAmountFields'

export type RateSplitAllocation = { rateBookEntryId: string; foreignAmount: number; rate: number }

export type RateSelection =
  | { mode: 'none' }
  | { mode: 'existing'; entryId: string; rate: number }
  | {
      mode: 'new'
      label: string
      rate: number
      source: 'manual' | 'api_accepted' | 'api_edited'
      exchangedHomeAmount?: number | null
      exchangedForeignAmount?: number | null
    }
  | { mode: 'split'; allocations: RateSplitAllocation[] }

export function RateChipRow({
  tripId,
  currency,
  homeCurrency,
  expenseAmount,
  value,
  onChange,
}: {
  tripId: string
  currency: string
  homeCurrency: string
  // 这笔开销的外币总额——拆分模式下用来实时校验有没有刚好分完
  expenseAmount: number
  value: RateSelection
  onChange: (v: RateSelection) => void
}) {
  const entries = useLiveQuery(() => getRateBookEntries(tripId, currency), [tripId, currency]) ?? []
  const topEntries = entries.slice(0, 4)
  const usageMap = useLiveQuery(() => usageByEntry(tripId), [tripId]) ?? new Map<string, RateEntryUsage>()

  const [showNewForm, setShowNewForm] = useState(value.mode === 'new')
  const [newLabel, setNewLabel] = useState(value.mode === 'new' ? value.label : '')
  const [newRate, setNewRate] = useState(value.mode === 'new' ? String(value.rate) : '')
  const [prefillTouched, setPrefillTouched] = useState(value.mode === 'new' && value.source !== 'api_accepted')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [fetchingRef, setFetchingRef] = useState(false)
  const [exchangeHome, setExchangeHome] = useState(
    value.mode === 'new' && value.exchangedHomeAmount != null ? String(value.exchangedHomeAmount) : ''
  )
  const [exchangeForeign, setExchangeForeign] = useState(
    value.mode === 'new' && value.exchangedForeignAmount != null ? String(value.exchangedForeignAmount) : ''
  )

  // 拆分模式（一笔钱来自不止一批换汇）：selectedIds 记选中顺序（决定输入框出现的顺序），
  // amounts 是每个条目对应的外币金额输入框原始字符串——跟 customAmounts/dayAmounts
  // 是同一套形状（字符串存、允许"12."这种打到一半的中间态）
  const [splitOpen, setSplitOpen] = useState(value.mode === 'split')
  const [splitSelectedIds, setSplitSelectedIds] = useState<string[]>(value.mode === 'split' ? value.allocations.map((a) => a.rateBookEntryId) : [])
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>(
    value.mode === 'split' ? Object.fromEntries(value.allocations.map((a) => [a.rateBookEntryId, String(a.foreignAmount)])) : {},
  )
  // value 里的 split 数据可能是编辑已有账目时异步查出来的（先渲染一次 {mode:'none'}，
  // 查到 expenseRateAllocations 之后父组件才把 value 变成 {mode:'split',...}）——跟
  // AddExpensePage 里那几处"useEffect+ref只回填一次"是同一个道理，这里也补一份
  const splitBackfilled = useRef(value.mode === 'split')
  useEffect(() => {
    if (splitBackfilled.current) return
    if (value.mode !== 'split') return
    setSplitOpen(true)
    setSplitSelectedIds(value.allocations.map((a) => a.rateBookEntryId))
    setSplitAmounts(Object.fromEntries(value.allocations.map((a) => [a.rateBookEntryId, String(a.foreignAmount)])))
    splitBackfilled.current = true
  }, [value])

  useEffect(() => {
    suggestLabels(tripId, currency).then(setSuggestions)
  }, [tripId, currency])

  function openNewForm() {
    setShowNewForm(true)
    setNewLabel('')
    setPrefillTouched(false)
    setExchangeHome('')
    setExchangeForeign('')
    onChange({ mode: 'none' })
    if (currency.length === 3) {
      setFetchingRef(true)
      fetchReferenceRate(currency, homeCurrency).then((r) => {
        setFetchingRef(false)
        // 7位小数——像日元这种面额大的币种，汇率小数点后差一点点，摊到大金额上
        // 就是实打实的钱，4位不够精确
        if (r != null) setNewRate(r.toFixed(7))
      })
    }
  }

  function commitNewRate(label: string, rateStr: string, touched: boolean, home: string, foreign: string) {
    const r = parseFloat(rateStr)
    if (!label.trim() || !r) {
      onChange({ mode: 'none' })
      return
    }
    const homeNum = parseFloat(home)
    const foreignNum = parseFloat(foreign)
    onChange({
      mode: 'new',
      label: label.trim(),
      rate: r,
      source: touched ? 'api_edited' : 'api_accepted',
      exchangedHomeAmount: homeNum > 0 ? homeNum : null,
      exchangedForeignAmount: foreignNum > 0 ? foreignNum : null,
    })
  }

  function onExchangeChange(home: string, foreign: string) {
    setExchangeHome(home)
    setExchangeForeign(foreign)
    const derived = deriveRateFromExchangeAmounts(home, foreign)
    // 7位小数——像日元这种面额大的币种，汇率小数点后差一点点，摊到大金额上
    // 就是实打实的钱，4位不够精确
    const rateStr = derived != null ? derived.toFixed(7) : newRate
    if (derived != null) {
      setPrefillTouched(true)
      setNewRate(rateStr)
    }
    commitNewRate(newLabel, rateStr, true, home, foreign)
  }

  function remainingFor(e: (typeof entries)[number]) {
    const hasExchangeAmount = e.exchangedForeignAmount != null
    const remaining = hasExchangeAmount ? (e.exchangedForeignAmount as number) - (usageMap.get(e.id)?.foreignAmount ?? 0) : null
    return { remaining, exhausted: remaining != null && remaining <= 0 }
  }

  function openSplit() {
    setShowNewForm(false)
    setSplitOpen(true)
    reportSplit(splitSelectedIds, splitAmounts)
  }

  function closeSplit() {
    setSplitOpen(false)
    onChange({ mode: 'none' })
  }

  function reportSplit(ids: string[], amounts: Record<string, string>) {
    onChange({
      mode: 'split',
      allocations: ids.map((id) => ({
        rateBookEntryId: id,
        foreignAmount: parseFloat(amounts[id] ?? '0') || 0,
        rate: entries.find((e) => e.id === id)?.rate ?? 0,
      })),
    })
  }

  function toggleSplitEntry(id: string) {
    const next = splitSelectedIds.includes(id) ? splitSelectedIds.filter((i) => i !== id) : [...splitSelectedIds, id]
    setSplitSelectedIds(next)
    reportSplit(next, splitAmounts)
  }

  function setSplitAmount(id: string, v: string) {
    const next = { ...splitAmounts, [id]: v }
    setSplitAmounts(next)
    reportSplit(splitSelectedIds, next)
  }

  const splitTotal = splitSelectedIds.reduce((sum, id) => sum + (parseFloat(splitAmounts[id] ?? '0') || 0), 0)
  const splitDiff = Math.round((expenseAmount - splitTotal) * 100) / 100
  const splitHomeTotal = splitSelectedIds.reduce((sum, id) => {
    const amount = parseFloat(splitAmounts[id] ?? '0') || 0
    const rate = entries.find((e) => e.id === id)?.rate ?? 0
    return sum + amount * rate
  }, 0)
  const splitValid = Math.abs(splitDiff) < 0.01

  return (
    <div>
      {!splitOpen && (
        <div className="flex flex-wrap gap-1.5">
          {topEntries.map((e) => {
            const isSelected = value.mode === 'existing' && value.entryId === e.id
            const { remaining, exhausted } = remainingFor(e)
            return (
              <button
                type="button"
                key={e.id}
                onClick={() => { setShowNewForm(false); onChange({ mode: 'existing', entryId: e.id, rate: e.rate }) }}
                className={`rounded-full px-2.5 py-1.5 text-[11.5px] border tabular flex flex-col items-start gap-0.5 ${
                  isSelected
                    ? 'bg-plan/10 border-plan text-plan font-semibold'
                    : exhausted
                      ? 'bg-card border-spend text-soft'
                      : 'bg-card border-line text-soft'
                }`}
              >
                <span>{e.label} {e.rate}</span>
                {remaining != null && (
                  <span className={`text-[9.5px] ${exhausted ? 'text-spend font-semibold' : 'text-muted'}`}>
                    {exhausted ? '已用完' : `还剩 ${remaining.toLocaleString()}`}
                  </span>
                )}
              </button>
            )
          })}
          <button
            type="button"
            onClick={openNewForm}
            title="新汇率"
            className={`rounded-full px-2.5 py-1.5 border flex items-center ${
              showNewForm ? 'bg-plan/10 border-plan text-plan font-semibold' : 'border-plan text-plan'
            }`}
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        </div>
      )}

      {!splitOpen && value.mode === 'existing' && (() => {
        const selectedEntry = entries.find((e) => e.id === value.entryId)
        if (!selectedEntry || selectedEntry.exchangedForeignAmount == null) return null
        const remaining = selectedEntry.exchangedForeignAmount - (usageMap.get(selectedEntry.id)?.foreignAmount ?? 0)
        if (remaining > 0) return null
        return (
          <div className="text-[10.5px] text-spend mt-1.5 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" strokeWidth={2.2} />
            这批钱已经用完了，仍会按这个汇率记账
          </div>
        )
      })()}

      {!splitOpen && !showNewForm && entries.length >= 2 && (
        <button type="button" onClick={openSplit} className="flex items-center gap-1 text-[11.5px] text-plan font-semibold mt-2">
          <ChevronRight className="w-3 h-3" strokeWidth={2.5} />
          这笔钱来自不止一笔汇率？
        </button>
      )}

      {showNewForm && (
        <div className="mt-2 bg-card border border-line rounded-xl p-2.5 flex flex-col gap-2">
          <div>
            <input
              value={newLabel}
              onChange={(e) => {
                setNewLabel(e.target.value)
                commitNewRate(e.target.value, newRate, prefillTouched, exchangeHome, exchangeForeign)
              }}
              list="rate-label-suggestions"
              placeholder="标签，例如「现金汇率」"
              className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-plan"
            />
            <datalist id="rate-label-suggestions">
              {suggestions.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <input
              value={newRate}
              onChange={(e) => {
                setPrefillTouched(true)
                setNewRate(e.target.value)
                commitNewRate(newLabel, e.target.value, true, exchangeHome, exchangeForeign)
              }}
              inputMode="decimal"
              placeholder={`1 ${currency} = 多少 ${homeCurrency}`}
              className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm tabular outline-none focus:border-plan"
            />
            <div className="text-[10.5px] text-muted mt-1">
              {fetchingRef ? '正在获取参考汇率…' : !prefillTouched && newRate ? '参考汇率（可直接改）' : ' '}
            </div>
          </div>
          <ExchangeAmountFields
            homeCurrency={homeCurrency}
            foreignCurrency={currency}
            homeAmount={exchangeHome}
            foreignAmount={exchangeForeign}
            onChangeHomeAmount={(v) => onExchangeChange(v, exchangeForeign)}
            onChangeForeignAmount={(v) => onExchangeChange(exchangeHome, v)}
          />
        </div>
      )}

      {splitOpen && (
        <div className="mt-1">
          <button type="button" onClick={closeSplit} className="flex items-center gap-0.5 text-[11px] text-muted font-semibold mb-1.5">
            <ChevronLeft className="w-3 h-3" strokeWidth={2.5} />
            改回单一汇率
          </button>
          <div className="flex flex-wrap gap-1.5">
            {topEntries.map((e) => {
              const isSelected = splitSelectedIds.includes(e.id)
              const { remaining, exhausted } = remainingFor(e)
              return (
                <button
                  type="button"
                  key={e.id}
                  onClick={() => toggleSplitEntry(e.id)}
                  className={`rounded-full px-2.5 py-1.5 text-[11.5px] border tabular flex flex-col items-start gap-0.5 ${
                    isSelected
                      ? 'bg-plan/10 border-plan text-plan font-semibold'
                      : exhausted
                        ? 'bg-card border-spend text-soft'
                        : 'bg-card border-line text-soft'
                  }`}
                >
                  <span>{e.label} {e.rate}</span>
                  {remaining != null && (
                    <span className={`text-[9.5px] ${exhausted ? 'text-spend font-semibold' : 'text-muted'}`}>
                      {exhausted ? '已用完' : `还剩 ${remaining.toLocaleString()}`}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {splitSelectedIds.length > 0 && (
            <div className="flex flex-col gap-1.5 mt-2">
              {splitSelectedIds.map((id) => {
                const e = entries.find((en) => en.id === id)
                if (!e) return null
                const { exhausted } = remainingFor(e)
                return (
                  <div key={id} className={`flex items-center gap-2 bg-card border rounded-xl px-3 py-2 ${exhausted ? 'border-spend' : 'border-line'}`}>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-semibold truncate">{e.label}</div>
                      <div className={`text-[10px] mt-0.5 ${exhausted ? 'text-spend font-semibold' : 'text-muted'}`}>
                        {exhausted ? '这批钱已经用完了，仍会按这个汇率记账' : `汇率 ${e.rate}`}
                      </div>
                    </div>
                    <input
                      value={splitAmounts[id] ?? ''}
                      onChange={(ev) => setSplitAmount(id, ev.target.value)}
                      inputMode="decimal"
                      placeholder="0"
                      className="w-[84px] text-right rounded-lg border border-line bg-paper px-2 py-1 text-[12.5px] tabular outline-none focus:border-plan"
                    />
                    <span className="text-[10.5px] text-muted flex-shrink-0">{currency}</span>
                  </div>
                )
              })}
            </div>
          )}

          {splitSelectedIds.length > 0 && (
            <div className={`text-[11.5px] mt-2 font-semibold ${splitValid ? 'text-positive' : 'text-negative'}`}>
              {splitValid
                ? '刚好分完这笔钱'
                : splitDiff > 0
                  ? `还剩 ${splitDiff.toLocaleString()} ${currency} 没分完`
                  : `超出了 ${Math.abs(splitDiff).toLocaleString()} ${currency}`}
            </div>
          )}
          {splitValid && splitTotal > 0 && (
            <div className="text-[10.5px] text-muted mt-1">
              加权平均汇率 ≈ {(splitHomeTotal / splitTotal).toFixed(4)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
