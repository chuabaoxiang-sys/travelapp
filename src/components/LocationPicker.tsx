import { useEffect, useRef, useState } from 'react'
import { searchPlaces, type GeocodeResult } from '../api/geocoding'
import { countryByCode } from '../lib/countries'

export interface LocationValue {
  name: string
  lat: number | null
  lng: number | null
}

export function LocationPicker({
  value,
  onChange,
  countryCodes,
}: {
  value: LocationValue
  onChange: (v: LocationValue) => void
  countryCodes?: string[]
}) {
  const [query, setQuery] = useState(value.name)
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery(value.name)
  }, [value.name])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function handleType(text: string) {
    setQuery(text)
    onChange({ name: text, lat: null, lng: null }) // 手动打字视为纯文字地点，坐标先清空
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (text.trim().length < 2) {
      setResults([])
      return
    }
    // Nominatim 使用政策不允许高频调用，这里用 600ms 防抖
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await searchPlaces(text, countryCodes)
        setResults(r)
        setOpen(true)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 600)
  }

  function pick(r: GeocodeResult) {
    const shortName = r.displayName.split(',')[0]
    setQuery(shortName)
    onChange({ name: shortName, lat: r.lat, lng: r.lng })
    setOpen(false)
    setResults([])
  }

  return (
    <div className="relative" ref={wrapRef}>
      <input
        value={query}
        onChange={(e) => handleType(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="地点（可搜索选点，也可以直接打字）"
        className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-plan"
      />
      {value.lat != null && (
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-positive">📍已定位</span>
      )}
      {!!countryCodes?.length && (
        <div className="text-[10px] text-muted mt-1">
          搜索范围已限定：{countryCodes.map((c) => countryByCode(c)?.nameZh ?? c).join('、')}
        </div>
      )}
      {open && (loading || results.length > 0) && (
        <div className="absolute z-40 mt-1 w-full rounded-xl border border-line bg-card shadow-lg overflow-hidden max-h-[180px] overflow-y-auto no-scrollbar">
          {loading && <div className="px-3 py-2 text-xs text-muted">搜索中…</div>}
          {!loading && results.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => pick(r)}
              className="w-full text-left px-3 py-2 text-[12.5px] text-ink hover:bg-paper border-b border-line last:border-0"
            >
              {r.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
