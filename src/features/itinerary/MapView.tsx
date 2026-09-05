import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapContainer, TileLayer, Marker, Polyline, Popup, ZoomControl, useMap } from 'react-leaflet'
import { Map as MapIcon, Heart } from 'lucide-react'
import L from 'leaflet'
import type { ItineraryDay, ItineraryItem, WishlistPlace } from '../../types'
import { formatTimeHM } from '../../lib/dates'
import { sortItineraryItems } from '../../domain/itinerary'

// 图钉按"第几天"上色。行程可以有很多天，颜色要足够多才不会撞色——
// 均匀分布色相、固定饱和度和明度，保证颜色彼此好区分，又不会跳成荧光色
const DAY_COLOR_COUNT = 30
const DAY_COLORS = Array.from(
  { length: DAY_COLOR_COUNT },
  (_, i) => `hsl(${Math.round((360 / DAY_COLOR_COUNT) * i)}, 60%, 40%)`
)

// react-leaflet 在 Vite 下用默认 marker 图标会因为资源路径解析不到而报 404，
// 干脆不用默认图标，改成跟设计语言一致的自绘水滴图钉
function pinIcon(label: string, color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:34px;height:42px;filter:drop-shadow(0 3px 5px rgba(31,20,10,.38));position:relative;">
      <svg viewBox="0 0 34 42" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:100%;">
        <path d="M17 0C7.6 0 0 7.5 0 16.8c0 11.3 15 23.6 16.3 24.7.4.3 1 .3 1.4 0C19 40.4 34 28.1 34 16.8 34 7.5 26.4 0 17 0z" fill="${color}"/>
        <circle cx="17" cy="16.5" r="11.5" fill="var(--color-card)" opacity="0.16"/>
      </svg>
      <div style="position:absolute;top:5px;left:0;right:0;text-align:center;font:700 12.5px 'Noto Serif SC',serif;color:var(--color-card);">${label}</div>
    </div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 42],
    popupAnchor: [0, -40],
  })
}

// "想去的地点"图层用的空心图钉——跟按天上色的实心图钉刻意长得不一样：这些地点
// 还没排进行程，不该看起来像"已经定下来的安排"。心形图标呼应"想去/收藏"这个
// 概念，颜色固定用强调色，不跟着"第几天"的颜色走（它们本来就不属于任何一天）
function wishlistPinIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="width:34px;height:42px;filter:drop-shadow(0 3px 5px rgba(31,20,10,.38));position:relative;">
      <svg viewBox="0 0 34 42" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:100%;">
        <path d="M17 0C7.6 0 0 7.5 0 16.8c0 11.3 15 23.6 16.3 24.7.4.3 1 .3 1.4 0C19 40.4 34 28.1 34 16.8 34 7.5 26.4 0 17 0z" fill="var(--color-card)" stroke="var(--color-plan)" stroke-width="2.4"/>
      </svg>
      <div style="position:absolute;top:6px;left:0;right:0;text-align:center;color:var(--color-plan);font-size:13px;line-height:1;">&#9829;</div>
    </div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 42],
    popupAnchor: [0, -40],
  })
}

// 连线中点上的小箭头，指向下一站——光有连线看不出方向，图钉上的数字又要凑近了才看得到
function arrowIcon(angleDeg: number, color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;transform:rotate(${angleDeg}deg);">
      <svg viewBox="0 0 16 16" width="16" height="16"><polygon points="2,3 14,8 2,13" fill="${color}" stroke="var(--color-card)" stroke-width="1.2" stroke-linejoin="round"/></svg>
    </div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
}

// 选中某一天时，把地图缩放/移动到刚好框住那天的所有点——不然默认视角还停在
// 第一天的位置，选中的那天如果离得远（比如跨城市的一日游），线会拉到屏幕外看不全
//
// 两处都显式关掉动画（animate:false），这是这次真机复现出来的真正病因：
// Leaflet默认会把这种跨度较大的缩放变化做成动画过渡，但只要这次过渡卡住
// 没有真正完成（用生产构建反复实测出来的，不是猜的——getZoom()/getCenter()
// 在调用fitBounds/setView之后、甚至过了500ms之后，读出来的还是动画开始前的
// 旧值，图钉自然还留在按旧视角算出来的老位置），地图看起来就是"卡住了、
// 没跳到新一天"。改成瞬间跳转，不指望这个过渡动画一定能顺利播完
//
// 切换日期前先关掉还开着的地点弹窗——不然Leaflet弹窗自带的"自动挪动地图
// 让弹窗保持可见"会跟这里的挪动抢地图控制权
function FitBounds({ positions, boundsKey }: { positions: [number, number][]; boundsKey: string }) {
  const map = useMap()
  useEffect(() => {
    map.closePopup()
    if (!positions.length) return
    if (positions.length === 1) {
      map.setView(positions[0], 14, { animate: false })
    } else {
      map.fitBounds(L.latLngBounds(positions), { padding: [40, 40], animate: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey])
  return null
}

export function MapView({
  days,
  items,
  selectedDate,
  wishlistPlaces,
}: {
  days: ItineraryDay[]
  items: ItineraryItem[]
  selectedDate?: string
  wishlistPlaces: WishlistPlace[]
}) {
  const { t } = useTranslation()
  // 从时间线切过来时，直接以时间线正看着的那天开局，不要每次都从"什么都没选"
  // 重新来——地图有自己的一套日期chip可以再改选，这里只管初始值。MapView在
  // 切出"地图"这个视图时会整个卸载，回来时重新走这个初始化，不需要额外的
  // useEffect去同步selectedDate变化
  const [activeDayId, setActiveDayId] = useState<string | null>(
    () => days.find((d) => d.date === selectedDate)?.id ?? null,
  )

  // 默认关——"看行程排得怎么样"是这个视图本来的主场景，想去的地点是可选的
  // 叠加信息，不该一进来就多一堆额外图钉。同样MapView整个切出去会卸载，
  // 每次进来都是重新从关掉开始，不需要额外记住上次的选择
  const [showWishlist, setShowWishlist] = useState(false)

  // 已经排进这趟行程（任意一天）的想去地点不用再画一次——它已经以"实心图钉"的
  // 身份出现了。判断用sourceWishlistId这个纯追溯字段，跟WishlistScreen里
  // "全部想去的地点"用的是同一套判断逻辑（usageByWishlistEntry），只是这里
  // 只关心"在这趟行程"而不是"在任意一趟行程"，直接用当前的items算就够了，
  // 不用另外查usage
  const wishlistPins = useMemo(() => {
    const linkedIds = new Set(items.map((it) => it.sourceWishlistId).filter((id): id is string => !!id))
    return wishlistPlaces.filter((p) => p.lat != null && p.lng != null && !linkedIds.has(p.id))
  }, [wishlistPlaces, items])

  // items 是 Dexie 查询的原始顺序，不代表实际时间顺序——图钉编号和连线走向
  // 都要按时间排，不排序的话同一天的点会按插入顺序连线，跟真实行程顺序对不上
  const pinned = useMemo(
    () => sortItineraryItems(items).filter((it) => it.lat != null && it.lng != null),
    [items]
  )

  const dayIndexByDate = useMemo(() => {
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
    const map = new Map<string, number>()
    sorted.forEach((d, i) => map.set(d.id, i + 1))
    return map
  }, [days])

  // 图例用"月-日"而不是图钉上那个"第几天"序号——序号在长行程里连续两位数
  // 视觉上不够好区分（"第11天"和"第21天"共享数字1，一眼扫过去容易看错），
  // 完整日期多了月份和分隔符，反而更好认，也是用户平时记行程时脑子里想的
  // 那个"几号"
  const dateByDayId = useMemo(() => {
    const map = new Map<string, string>()
    days.forEach((d) => map.set(d.id, d.date.slice(5)))
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

  // 选中一天就框住那天，没选中就框住全部有定位的点
  const fitPositions: [number, number][] = useMemo(() => {
    const source = activeDayId ? dayGroups.get(activeDayId) ?? [] : pinned
    return source.map((it) => [it.lat as number, it.lng as number])
  }, [activeDayId, dayGroups, pinned])

  if (!pinned.length) {
    return (
      <div className="px-5 pt-3 pb-safe-fab-clearance h-full flex flex-col items-center justify-center text-center gap-2">
        <div className="w-[60px] h-[60px] rounded-full bg-segment flex items-center justify-center text-muted">
          <MapIcon className="w-6 h-6" strokeWidth={1.8} />
        </div>
        <div className="font-serif-sc text-[15px] mt-2">{t('mapView.emptyTitle')}</div>
        <div className="text-[12.5px] text-muted max-w-[220px]">
          {t('mapView.emptyHint')}
        </div>
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
          <FitBounds positions={fitPositions} boundsKey={activeDayId ?? 'all'} />
          {activeDayId &&
            (() => {
              const dayItems = dayGroups.get(activeDayId) ?? []
              if (dayItems.length < 2) return null
              const dayNum = dayIndexByDate.get(activeDayId) ?? 1
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
                    key={`arrow-${activeDayId}-${i}`}
                    position={[midLat, midLng]}
                    icon={arrowIcon(angle, color)}
                    interactive={false}
                    keyboard={false}
                  />
                )
              })
              return (
                <>
                  <Polyline
                    key={`halo-${activeDayId}`}
                    positions={positions}
                    pathOptions={{ color: 'var(--color-card)', weight: 6, opacity: 0.9, lineCap: 'round' }}
                    interactive={false}
                  />
                  <Polyline
                    key={`line-${activeDayId}`}
                    positions={positions}
                    pathOptions={{ color, weight: 3, opacity: 0.92, lineCap: 'round' }}
                    interactive={false}
                  />
                  {arrows}
                </>
              )
            })()}
          {pinned.map((it) => {
            const dayNum = dayIndexByDate.get(it.dayId) ?? 1
            const color = DAY_COLORS[(dayNum - 1) % DAY_COLORS.length]
            const dayItems = dayGroups.get(it.dayId) ?? []
            const orderInDay = dayItems.findIndex((d) => d.id === it.id) + 1
            // 选中某一天时，其他天的图钉变浅——更看得出到底在看哪天，别的天不用先视觉上排除掉
            const dimmed = activeDayId != null && it.dayId !== activeDayId
            return (
              <Marker
                key={it.id}
                position={[it.lat as number, it.lng as number]}
                icon={pinIcon(String(orderInDay), color)}
                opacity={dimmed ? 0.35 : 1}
              >
                <Popup>
                  <div style={{ fontSize: 13 }}>
                    <b>{t('mapView.dayLabel', { day: dayNum })} · {formatTimeHM(it.time)}</b>
                    <div>{it.title}</div>
                    {it.locationName && <div style={{ color: 'var(--color-muted)', fontSize: 11 }}>{it.locationName}</div>}
                  </div>
                </Popup>
              </Marker>
            )
          })}
          {showWishlist &&
            wishlistPins.map((p) => (
              <Marker key={p.id} position={[p.lat as number, p.lng as number]} icon={wishlistPinIcon()}>
                <Popup>
                  <div style={{ fontSize: 13 }}>
                    <div style={{ color: 'var(--color-plan)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' }}>
                      {t('wishlist.title')}
                    </div>
                    <b>{p.name}</b>
                    {p.notes && <div style={{ color: 'var(--color-muted)', fontSize: 11, marginTop: 2 }}>{p.notes}</div>}
                  </div>
                </Popup>
              </Marker>
            ))}
        </MapContainer>
        <button
          type="button"
          onClick={() => setShowWishlist((v) => !v)}
          title={t('mapView.wishlistLayerToggle')}
          className="absolute top-3 right-3 w-[34px] h-[34px] rounded-full flex items-center justify-center shadow-sm"
          style={
            showWishlist
              ? { background: 'var(--color-plan)', color: 'var(--color-card)', zIndex: 1000 }
              : { background: 'color-mix(in srgb, var(--color-card) 90%, transparent)', color: 'var(--color-muted)', zIndex: 1000 }
          }
        >
          <Heart className="w-[15px] h-[15px]" strokeWidth={2} fill={showWishlist ? 'currentColor' : 'none'} />
        </button>
        <div className="absolute top-3 left-3 right-[52px] flex gap-1.5 overflow-x-auto no-scrollbar" style={{ zIndex: 1000 }}>
          {[...dayGroups.keys()]
            .sort((a, b) => (dayIndexByDate.get(a) ?? 0) - (dayIndexByDate.get(b) ?? 0))
            .map((dayId) => {
              const dayNum = dayIndexByDate.get(dayId) ?? 1
              const color = DAY_COLORS[(dayNum - 1) % DAY_COLORS.length]
              const active = activeDayId === dayId
              return (
                <button
                  key={dayId}
                  type="button"
                  onClick={() => setActiveDayId((cur) => (cur === dayId ? null : dayId))}
                  className="flex items-center gap-1.5 rounded-full pl-1.5 pr-2.5 py-1 text-[10.5px] font-semibold shadow-sm transition-colors flex-shrink-0"
                  style={
                    active
                      ? { background: color, color: 'var(--color-card)' }
                      : { background: 'color-mix(in srgb, var(--color-card) 90%, transparent)', color: 'var(--color-ink)' }
                  }
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: active ? 'var(--color-card)' : color }}
                  />
                  {dateByDayId.get(dayId)}
                </button>
              )
            })}
        </div>
      </div>
      {showWishlist && wishlistPins.length > 0 && (
        <div className="px-4 py-2 flex items-center justify-center gap-4 text-[10.5px] text-muted flex-shrink-0 bg-paper border-t border-line">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm bg-muted flex-shrink-0" />
            {t('mapView.itineraryLegend')}
          </span>
          <span className="flex items-center gap-1.5">
            <Heart className="w-2.5 h-2.5 text-plan flex-shrink-0" strokeWidth={2.4} />
            {t('mapView.wishlistLegend')}
          </span>
        </div>
      )}
      <div className="px-4 py-2 text-[10.5px] text-muted text-center flex-shrink-0 bg-paper">
        © OpenStreetMap contributors · {t('mapView.attributionHint')}
      </div>
    </div>
  )
}
