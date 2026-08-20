import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, AlertTriangle } from 'lucide-react'
import { getRateBookEntries, suggestLabels, usedForeignAmountByEntry, deriveRateFromExchangeAmounts } from '../../domain/rates'
import { fetchReferenceRate } from '../../api/fx'
import { ExchangeAmountFields } from './ExchangeAmountFields'

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

export function RateChipRow({
  tripId,
  currency,
  homeCurrency,
  value,
  onChange,
}: {
  tripId: string
  currency: string
  homeCurrency: string
  value: RateSelection
  onChange: (v: RateSelection) => void
}) {
  const entries = useLiveQuery(() => getRateBookEntries(tripId, currency), [tripId, currency]) ?? []
  const topEntries = entries.slice(0, 4)
  const usedByEntry = useLiveQuery(() => usedForeignAmountByEntry(tripId), [tripId]) ?? new Map<string, number>()

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
        if (r != null) setNewRate(r.toFixed(4))
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
    const rateStr = derived != null ? derived.toFixed(4) : newRate
    if (derived != null) {
      setPrefillTouched(true)
      setNewRate(rateStr)
    }
    commitNewRate(newLabel, rateStr, true, home, foreign)
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {topEntries.map((e) => {
          const isSelected = value.mode === 'existing' && value.entryId === e.id
          const hasExchangeAmount = e.exchangedForeignAmount != null
          const remaining = hasExchangeAmount ? (e.exchangedForeignAmount as number) - (usedByEntry.get(e.id) ?? 0) : null
          const exhausted = remaining != null && remaining <= 0
          return (
            <button
              type="button"
              key={e.id}
              onClick={() => { setShowNewForm(false); onChange({ mode: 'existing', entryId: e.id, rate: e.rate }) }}
              className={`rounded-full px-2.5 py-1.5 text-[11.5px] border tabular flex flex-col items-start gap-0.5 ${
                isSelected
                  ? 'bg-plan/10 border-plan text-plan font-semibold'
                  : exhausted
                    ? 'bg-card border-spend text-[#57534E]'
                    : 'bg-card border-line text-[#57534E]'
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

      {value.mode === 'existing' && (() => {
        const selectedEntry = entries.find((e) => e.id === value.entryId)
        if (!selectedEntry || selectedEntry.exchangedForeignAmount == null) return null
        const remaining = selectedEntry.exchangedForeignAmount - (usedByEntry.get(selectedEntry.id) ?? 0)
        if (remaining > 0) return null
        return (
          <div className="text-[10.5px] text-spend mt-1.5 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" strokeWidth={2.2} />
            这批钱已经用完了，仍会按这个汇率记账
          </div>
        )
      })()}

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
    </div>
  )
}
