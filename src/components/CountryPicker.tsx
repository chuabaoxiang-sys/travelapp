import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { searchCountries, countryByCode } from '../lib/countries'
import { useEscapeKey } from '../hooks/useEscapeKey'

export function CountryPicker({
  value,
  onChange,
}: {
  value: string[]
  onChange: (codes: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEscapeKey(open, () => setOpen(false))

  const results = searchCountries(query).filter((c) => !value.includes(c.code))

  function add(code: string) {
    onChange([...value, code])
    setQuery('')
    setOpen(false)
  }
  function remove(code: string) {
    onChange(value.filter((c) => c !== code))
  }

  return (
    <div className="relative" ref={wrapRef}>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {value.map((code) => {
          const c = countryByCode(code)
          return (
            <span key={code} className="inline-flex items-center gap-1 rounded-full bg-plan/10 text-plan text-[11.5px] px-2.5 py-1">
              {c?.nameZh ?? code}
              <button type="button" onClick={() => remove(code)} className="text-plan/60 hover:text-plan" title="移除">
                <X className="w-2.5 h-2.5" strokeWidth={2} />
              </button>
            </span>
          )
        })}
      </div>
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="搜索目的地国家（可选，可多选）"
        className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-plan"
      />
      {open && results.length > 0 && (
        <div className="absolute z-40 mt-1 w-full rounded-xl border border-line bg-card shadow-lg overflow-hidden max-h-[180px] overflow-y-auto no-scrollbar">
          {results.map((c) => (
            <button
              type="button"
              key={c.code}
              onClick={() => add(c.code)}
              className="w-full text-left px-3 py-2 text-[12.5px] text-ink hover:bg-paper border-b border-line last:border-0"
            >
              {c.nameZh}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
