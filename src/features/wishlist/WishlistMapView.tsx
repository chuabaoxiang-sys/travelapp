import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapContainer, TileLayer, Marker, Popup, ZoomControl, useMap } from 'react-leaflet'
import { MapPin, ChevronRight } from 'lucide-react'
import L from 'leaflet'
import type { WishlistPlace } from '../../types'

// 跟MapView.tsx（行程页地图）里的水滴图钉是同一个SVG形状，但这里的颜色语义
// 不一样——不是"第几天"，是"去过/还没去"，特意没有抽成共用函数：两边各自
// 独立维护，万一以后哪边样式要单独改，不用担心牵动另一边
function statusPinIcon(visited: boolean) {
  const color = visited ? 'var(--color-positive)' : 'var(--color-plan)'
  return L.divIcon({
    className: '',
    html: `<div style="width:34px;height:42px;filter:drop-shadow(0 3px 5px rgba(31,20,10,.38));position:relative;">
      <svg viewBox="0 0 34 42" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:100%;">
        <path d="M17 0C7.6 0 0 7.5 0 16.8c0 11.3 15 23.6 16.3 24.7.4.3 1 .3 1.4 0C19 40.4 34 28.1 34 16.8 34 7.5 26.4 0 17 0z" fill="${color}"/>
      </svg>
    </div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 42],
    popupAnchor: [0, -40],
  })
}

// 一进来把地图缩放/移动到刚好框住所有带定位的点——跟MapView.tsx同样的
// animate:false也是同样的原因（真机复现过缩放动画卡住导致图钉停在旧位置）
function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (!positions.length) return
    if (positions.length === 1) {
      map.setView(positions[0], 13, { animate: false })
    } else {
      map.fitBounds(L.latLngBounds(positions), { padding: [40, 40], animate: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

export function WishlistMapView({ places }: { places: WishlistPlace[] }) {
  const { t } = useTranslation()
  const [showUnlocated, setShowUnlocated] = useState(false)

  const pinned = useMemo(() => places.filter((p) => p.lat != null && p.lng != null), [places])
  const unlocated = useMemo(() => places.filter((p) => p.lat == null || p.lng == null), [places])

  const center: [number, number] = pinned.length
    ? [pinned[0].lat as number, pinned[0].lng as number]
    : [35.0, 135.7] // 兜底：日本关西附近，跟MapView.tsx同一个兜底值

  if (!pinned.length) {
    return (
      <div className="px-5 pt-3 h-full flex flex-col items-center justify-center text-center gap-2">
        <div className="w-[60px] h-[60px] rounded-full bg-segment flex items-center justify-center text-muted">
          <MapPin className="w-6 h-6" strokeWidth={1.8} />
        </div>
        <div className="font-serif-sc text-[15px] mt-2">{t('wishlist.mapEmptyTitle')}</div>
        <div className="text-[12.5px] text-muted max-w-[220px]">{t('wishlist.mapEmptyHint')}</div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 relative">
        <MapContainer center={center} zoom={12} scrollWheelZoom zoomControl={false} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ZoomControl position="bottomright" />
          <FitBounds positions={pinned.map((p) => [p.lat as number, p.lng as number])} />
          {pinned.map((p) => (
            <Marker key={p.id} position={[p.lat as number, p.lng as number]} icon={statusPinIcon(p.visited)}>
              <Popup>
                <div style={{ fontSize: 13 }}>
                  <b>{p.name}</b>
                  {p.notes && <div style={{ color: 'var(--color-muted)', fontSize: 11, marginTop: 2 }}>{p.notes}</div>}
                  <div style={{ color: p.visited ? 'var(--color-positive)' : 'var(--color-muted)', fontSize: 11, marginTop: 3, fontWeight: 600 }}>
                    {p.visited ? t('wishlist.visited') : t('wishlist.notVisited')}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      {unlocated.length > 0 && (
        <div className="flex-shrink-0 bg-card border-t border-line">
          <button
            onClick={() => setShowUnlocated((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-2.5 text-[11px] text-muted"
          >
            <span>{t('wishlist.unlocatedCount', { count: unlocated.length })}</span>
            <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${showUnlocated ? 'rotate-90' : ''}`} strokeWidth={1.8} />
          </button>
          {showUnlocated && (
            <div className="px-5 pb-3 flex flex-col gap-1.5">
              {unlocated.map((p) => (
                <div key={p.id} className="text-[12.5px] flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: p.visited ? 'var(--color-positive)' : 'var(--color-plan)' }} />
                  <span className="truncate">{p.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
