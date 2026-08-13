import { useEffect, useRef, useState } from 'react'
import { searchPlaces, type GeocodeResult } from '../api/geocoding'
import { countryByCode } from '../lib/countries'
import { useEscapeKey } from '../hooks/useEscapeKey'

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
  // 每次发起新搜索、或者用户主动关闭下拉时都递增，防抖请求真正返回结果时
  // 拿自己发起时的编号跟这个最新值比对——不一致就说明用户已经关掉了下拉，
  // 或者已经又输入了新的关键词，这次姗姗来迟的结果就该被丢弃，不能再把
  // 下拉重新弹出来（之前这里没做这个检查，会出现"关掉下拉后过一会儿又
  // 自己弹出来"的bug）
  const requestIdRef = useRef(0)

  useEffect(() => {
    setQuery(value.name)
  }, [value.name])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        requestIdRef.current++
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEscapeKey(open, () => {
    requestIdRef.current++
    setOpen(false)
  })

  function handleType(text: string) {
    setQuery(text)
    onChange({ name: text, lat: null, lng: null }) // 手动打字视为纯文字地点，坐标先清空
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (text.trim().length < 2) {
      requestIdRef.current++
      setResults([])
      return
    }
    // Nominatim 使用政策不允许高频调用，这里用 600ms 防抖
    const requestId = ++requestIdRef.current
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await searchPlaces(text, countryCodes)
        if (requestIdRef.current !== requestId) return // 已经过期的结果，不再生效
        setResults(r)
        setOpen(true)
      } catch {
        if (requestIdRef.current === requestId) setResults([])
      } finally {
        if (requestIdRef.current === requestId) setLoading(false)
      }
    }, 600)
  }

  function pick(r: GeocodeResult) {
    requestIdRef.current++
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
