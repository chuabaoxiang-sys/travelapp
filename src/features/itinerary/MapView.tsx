import { useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import type { ItineraryDay, ItineraryItem } from '../../types'
import { formatTimeHM } from '../../lib/dates'

// react-leaflet 在 Vite 下用默认 marker 图标会因为资源路径解析不到而报 404，
// 干脆不用默认图标，改成跟设计语言一致的自绘紫色圆形数字徽章
function pinIcon(label: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:28px;height:28px;border-radius:50%;background:#4C1D95;color:#FFFDF9;display:flex;align-items:center;justify-content:center;font:600 12px 'Noto Serif SC',serif;box-shadow:0 2px 6px rgba(31,27,22,.35);border:2px solid #FFFDF9;">${label}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  })
}

export function MapView({ days, items }: { days: ItineraryDay[]; items: ItineraryItem[] }) {
  const pinned = useMemo(() => items.filter((it) => it.lat != null && it.lng != null), [items])

  const dayIndexByDate = useMemo(() => {
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
    const map = new Map<string, number>()
    sorted.forEach((d, i) => map.set(d.id, i + 1))
    return map
  }, [days])

  const center: [number, number] = pinned.length
    ? [pinned[0].lat as number, pinned[0].lng as number]
    : [35.0, 135.7] // 兜底：日本关西附近，避免没有定位点时地图空白无从对焦

  if (!pinned.length) {
    return (
      <div className="px-5 pt-3 pb-24 h-full flex flex-col items-center justify-center text-center gap-2">
        <div className="w-[60px] h-[60px] rounded-full bg-[#EDE6DA] flex items-center justify-center font-serif-sc text-2xl text-muted">
          图
        </div>
        <div className="font-serif-sc text-[15px] mt-2">还没有带地点的行程项</div>
        <div className="text-[12.5px] text-muted max-w-[220px]">
          在"时间线"里添加行程项时，搜索并选择一个地点，这里就会出现对应的图钉。
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 relative">
        <MapContainer center={center} zoom={12} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {pinned.map((it) => {
            const dayNum = dayIndexByDate.get(it.dayId) ?? '?'
            return (
              <Marker key={it.id} position={[it.lat as number, it.lng as number]} icon={pinIcon(String(dayNum))}>
                <Popup>
                  <div style={{ fontSize: 13 }}>
                    <b>Day{dayNum} · {formatTimeHM(it.time)}</b>
                    <div>{it.title}</div>
                    {it.locationName && <div style={{ color: '#8A8177', fontSize: 11 }}>{it.locationName}</div>}
                  </div>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
      </div>
      <div className="px-4 py-2 text-[10.5px] text-muted text-center flex-shrink-0 bg-paper">
        © OpenStreetMap contributors · 图钉数字代表行程第几天
      </div>
    </div>
  )
}
