import { useEffect, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'
import { searchPlaces, looksLikeGoogleMapsUrl, resolveMapsLink, type GeocodeResult, type ResolvedMapsLink } from '../api/geocoding'
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
  // 免费地理编码搜不到/搜错小型商家时的兜底——粘贴一个Google Maps链接，直接解析
  // 出精确坐标，不用重新搜索。跟普通搜索结果是两条独立的展示路径，不共用 results
  const [mapsLink, setMapsLink] = useState<{ status: 'loading' } | { status: 'ok'; result: ResolvedMapsLink } | { status: 'error'; message: string } | null>(null)
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
    setMapsLink(null)

    // 贴的是Google Maps链接——免费搜索搜不到/搜错的小型商家兜底方案，
    // 走单独一条路径解析坐标，不跟下面的普通搜索防抖混在一起
    if (looksLikeGoogleMapsUrl(text)) {
      requestIdRef.current++
      setResults([])
      setOpen(false)
      const requestId = ++requestIdRef.current
      setMapsLink({ status: 'loading' })
      resolveMapsLink(text.trim()).then((r) => {
        if (requestIdRef.current !== requestId) return
        setMapsLink(r ? { status: 'ok', result: r } : { status: 'error', message: '解析失败，确认链接有效或稍后重试' })
      })
      return
    }

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

  function pickMapsLink(r: ResolvedMapsLink) {
    requestIdRef.current++
    const name = r.name ?? query
    setQuery(name)
    onChange({ name, lat: r.lat, lng: r.lng })
    setMapsLink(null)
  }

  return (
    <div className="relative" ref={wrapRef}>
      {/* 输入框和"已定位"标签单独包一层relative——之前跟下面的提示文字共用
      同一个relative容器，标签的top-1/2是相对"输入框+提示文字"的总高度居中，
      导致标签往下偏，看起来吊在输入框下边缘、跟提示文字重叠（真机反馈过的
      "定位标签错位"问题） */}
      <div className="relative">
        <input
          value={query}
          onChange={(e) => handleType(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="地点"
          className={`w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-plan ${value.lat != null ? 'pr-16' : ''}`}
        />
        {value.lat != null && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-positive whitespace-nowrap">📍已定位</span>
        )}
      </div>
      <div className="text-[10px] text-muted mt-1">
        可搜索选点，搜不到也可以直接贴Google Maps链接定位
        {!!countryCodes?.length && (
          <> · 搜索范围已限定：{countryCodes.map((c) => countryByCode(c)?.nameZh ?? c).join('、')}</>
        )}
      </div>

      {mapsLink && (
        <div className="mt-1.5 rounded-xl border border-line bg-card overflow-hidden">
          {mapsLink.status === 'loading' && <div className="px-3 py-2 text-xs text-muted">解析链接中…</div>}
          {mapsLink.status === 'error' && <div className="px-3 py-2 text-xs text-negative">{mapsLink.message}</div>}
          {mapsLink.status === 'ok' && (
            <button
              type="button"
              onClick={() => pickMapsLink(mapsLink.result)}
              className="w-full flex items-center gap-2 text-left px-3 py-2.5 hover:bg-paper"
            >
              <MapPin className="w-4 h-4 text-positive flex-shrink-0" strokeWidth={1.8} />
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium truncate">{mapsLink.result.name ?? '识别到的地点'}</div>
                <div className="text-[10.5px] text-muted">来自Google Maps链接，点击使用这个精确位置</div>
              </div>
            </button>
          )}
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
