import { useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet'
import L from 'leaflet'
import type { ItineraryDay, ItineraryItem } from '../../types'
import { formatTimeHM } from '../../lib/dates'

// 图钉按"第几天"上色，直接借用记账那套分类配色（跟花费类型没关系，纯粹是
// 这套颜色已经调好、彼此足够好区分，不用再挑一套新的）
const DAY_COLORS = ['#0f766e', '#7c3aed', '#c2410c', '#b45309', '#be123c', '#57534e']

// react-leaflet 在 Vite 下用默认 marker 图标会因为资源路径解析不到而报 404，
// 干脆不用默认图标，改成跟设计语言一致的自绘圆形数字徽章
function pinIcon(label: string, color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};color:#FFFDF9;display:flex;align-items:center;justify-content:center;font:600 12px 'Noto Serif SC',serif;box-shadow:0 2px 6px rgba(31,27,22,.35);border:2px solid #FFFDF9;">${label}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  })
}

// 连线中点上的小箭头，指向下一站——光有连线看不出方向，图钉上的数字又要凑近了才看得到
function arrowIcon(angleDeg: number, color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;transform:rotate(${angleDeg}deg);">
      <svg viewBox="0 0 16 16" width="16" height="16"><polygon points="2,3 14,8 2,13" fill="${color}" stroke="#FFFDF9" stroke-width="1.2" stroke-linejoin="round"/></svg>
    </div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
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

  // 同一天的图钉按顺序连成一条线；分组和图钉上的序号都只算"当天有定位的点"，
  // 没有定位的行程项本来就不在地图上，不占序号
  const dayGroups = useMemo(() => {
    const byDay = new Map<string, ItineraryItem[]>()
    pinned.forEach((it) => {
      const arr = byDay.get(it.dayId) ?? []
      arr.push(it)
      byDay.set(it.dayId, arr)
    })
    return byDay
  }, [pinned])

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
          {[...dayGroups.entries()].flatMap(([dayId, dayItems]) => {
            if (dayItems.length < 2) return []
            const dayNum = dayIndexByDate.get(dayId) ?? 1
            const color = DAY_COLORS[(dayNum - 1) % DAY_COLORS.length]
            const positions: [number, number][] = dayItems.map((it) => [it.lat as number, it.lng as number])
            const arrows = dayItems.slice(0, -1).map((a, i) => {
              const b = dayItems[i + 1]
              const midLat = ((a.lat as number) + (b.lat as number)) / 2
              const midLng = ((a.lng as number) + (b.lng as number)) / 2
              const dLat = (b.lat as number) - (a.lat as number)
              const dLng = ((b.lng as number) - (a.lng as number)) * Math.cos((midLat * Math.PI) / 180)
              const angle = (Math.atan2(-dLat, dLng) * 180) / Math.PI
              return (
                <Marker
                  key={`arrow-${dayId}-${i}`}
                  position={[midLat, midLng]}
                  icon={arrowIcon(angle, color)}
                  interactive={false}
                  keyboard={false}
                />
              )
            })
            return [
              <Polyline
                key={`halo-${dayId}`}
                positions={positions}
                pathOptions={{ color: '#FBF7EE', weight: 6, opacity: 0.9, lineCap: 'round' }}
                interactive={false}
              />,
              <Polyline
                key={`line-${dayId}`}
                positions={positions}
                pathOptions={{ color, weight: 3, opacity: 0.92, lineCap: 'round' }}
                interactive={false}
              />,
              ...arrows,
            ]
          })}
          {pinned.map((it) => {
            const dayNum = dayIndexByDate.get(it.dayId) ?? 1
            const color = DAY_COLORS[(dayNum - 1) % DAY_COLORS.length]
            const dayItems = dayGroups.get(it.dayId) ?? []
            const orderInDay = dayItems.findIndex((d) => d.id === it.id) + 1
            return (
              <Marker key={it.id} position={[it.lat as number, it.lng as number]} icon={pinIcon(String(orderInDay), color)}>
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
        <div className="absolute top-3 left-3 right-3 flex flex-wrap gap-1.5 pointer-events-none" style={{ zIndex: 1000 }}>
          {[...dayGroups.keys()]
            .sort((a, b) => (dayIndexByDate.get(a) ?? 0) - (dayIndexByDate.get(b) ?? 0))
            .map((dayId) => {
              const dayNum = dayIndexByDate.get(dayId) ?? 1
              const color = DAY_COLORS[(dayNum - 1) % DAY_COLORS.length]
              return (
                <div
                  key={dayId}
                  className="flex items-center gap-1.5 bg-card/90 rounded-full pl-1.5 pr-2.5 py-1 text-[10.5px] font-semibold text-ink shadow-sm"
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                  第{dayNum}天
                </div>
              )
            })}
        </div>
      </div>
      <div className="px-4 py-2 text-[10.5px] text-muted text-center flex-shrink-0 bg-paper">
        © OpenStreetMap contributors · 颜色代表第几天 · 箭头指向下一站
      </div>
    </div>
  )
}
