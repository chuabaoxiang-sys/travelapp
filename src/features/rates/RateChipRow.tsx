import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus } from 'lucide-react'
import { getRateBookEntries, suggestLabels } from '../../domain/rates'
import { fetchReferenceRate } from '../../api/fx'

export type RateSelection =
  | { mode: 'none' }
  | { mode: 'existing'; entryId: string; rate: number }
  | { mode: 'new'; label: string; rate: number; source: 'manual' | 'api_accepted' | 'api_edited' }

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

  const [showNewForm, setShowNewForm] = useState(value.mode === 'new')
  const [newLabel, setNewLabel] = useState(value.mode === 'new' ? value.label : '')
  const [newRate, setNewRate] = useState(value.mode === 'new' ? String(value.rate) : '')
  const [prefillTouched, setPrefillTouched] = useState(value.mode === 'new' && value.source !== 'api_accepted')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [fetchingRef, setFetchingRef] = useState(false)

  useEffect(() => {
    suggestLabels(tripId, currency).then(setSuggestions)
  }, [tripId, currency])

  function openNewForm() {
    setShowNewForm(true)
    setNewLabel('')
    setPrefillTouched(false)
    onChange({ mode: 'none' })
    if (currency.length === 3) {
      setFetchingRef(true)
      fetchReferenceRate(currency, homeCurrency).then((r) => {
        setFetchingRef(false)
        if (r != null) setNewRate(r.toFixed(4))
      })
    }
  }

  function commitNewRate(label: string, rateStr: string, touched: boolean) {
    const r = parseFloat(rateStr)
    if (!label.trim() || !r) {
      onChange({ mode: 'none' })
      return
    }
    onChange({
      mode: 'new',
      label: label.trim(),
      rate: r,
      source: touched ? 'api_edited' : 'api_accepted',
    })
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {topEntries.map((e) => {
          const isSelected = value.mode === 'existing' && value.entryId === e.id
          return (
            <button
              type="button"
              key={e.id}
              onClick={() => { setShowNewForm(false); onChange({ mode: 'existing', entryId: e.id, rate: e.rate }) }}
              className={`rounded-full px-2.5 py-1.5 text-[11.5px] border tabular ${
                isSelected ? 'bg-plan/10 border-plan text-plan font-semibold' : 'bg-card border-line text-[#57534E]'
              }`}
            >
              {e.label} {e.rate}
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

      {showNewForm && (
        <div className="mt-2 bg-card border border-line rounded-xl p-2.5 flex flex-col gap-2">
          <div>
            <input
              value={newLabel}
              onChange={(e) => {
                setNewLabel(e.target.value)
                commitNewRate(e.target.value, newRate, prefillTouched)
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
                commitNewRate(newLabel, e.target.value, true)
              }}
              inputMode="decimal"
              placeholder={`1 ${currency} = 多少 ${homeCurrency}`}
              className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm tabular outline-none focus:border-plan"
            />
            <div className="text-[10.5px] text-muted mt-1">
              {fetchingRef ? '正在获取参考汇率…' : !prefillTouched && newRate ? '参考汇率（可直接改）' : ' '}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
