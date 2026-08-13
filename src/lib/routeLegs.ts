import { useEffect, useMemo, useState } from 'react'
import { db } from '../db/dexie'
import type { ItineraryItem, LatLng, RouteLeg, RouteLegCacheEntry } from '../types'

interface DirectionsLeg {
  distanceMeters: number
  durationSeconds: number
}

// 超过这个直线换算不到的真实距离，就不再建议"步行"——152公里那种跨城市的真实路线
// 算出来的步行时长（可能上千分钟）对用户没有实际意义，只显示距离本身
const WALK_SUGGESTION_MAX_METERS = 3000

// RouteLeg 的存储形状每次变了都要改这个版本号——不然已经缓存在用户本地Dexie里的
// 旧格式条目（比如没有 from/to 字段的老版本 'unavailable'）会命中签名相同直接复用，
// 但新代码假设字段一定存在，读取时崩溃。塞进签名里最简单：版本号一变签名必然不同，
// 旧缓存自动作废重新请求，不需要写专门的迁移代码
const CACHE_FORMAT_VERSION = 'v2'

// 当天行程项的顺序+坐标拼出来的签名——只要任何一项的位置或顺序变了，签名就变，
// 缓存自然失效重新请求；没变就直接用 Dexie 里存的结果，不重复调用API
export function buildDaySignature(items: ItineraryItem[]): string {
  return `${CACHE_FORMAT_VERSION}|${items.map((it) => `${it.id}:${it.lat ?? ''},${it.lng ?? ''}`).join('|')}`
}

async function fetchRunLegs(coords: { lat: number; lng: number }[]): Promise<DirectionsLeg[] | null> {
  try {
    const res = await fetch('/api/route-directions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coords }),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data.legs)) return null
    return data.legs
  } catch {
    return null
  }
}

// 把一天的行程项按"是否有有效坐标"切成若干连续区间——一旦中间夹了一个没坐标的项，
// 前后两侧就不再是"相邻可导航"的关系，不该被当成一段路线去调用API
function buildCoordRuns(items: ItineraryItem[]) {
  const runs: { startIndex: number; coords: LatLng[] }[] = []
  let current: { startIndex: number; coords: LatLng[] } | null = null
  items.forEach((it, i) => {
    if (it.lat != null && it.lng != null) {
      if (!current) current = { startIndex: i, coords: [] }
      current.coords.push({ lat: it.lat, lng: it.lng })
    } else {
      if (current) runs.push(current)
      current = null
    }
  })
  if (current) runs.push(current)
  return runs
}

// 返回长度为 items.length - 1 的数组，legs[i] 对应 items[i] 到 items[i+1] 这一段
export async function getDayRouteLegs(dayId: string, items: ItineraryItem[]): Promise<RouteLeg[]> {
  if (items.length < 2) return []

  const signature = buildDaySignature(items)
  const cached = await db.routeLegCache.get(dayId)
  if (cached && cached.signature === signature) return cached.legs

  const legs: RouteLeg[] = items.slice(0, -1).map((it, i) => {
    const next = items[i + 1]
    if (it.lat == null || it.lng == null || next.lat == null || next.lng == null) {
      return { kind: 'missing-coords' }
    }
    // 占位，下面按连续区间批量请求真实结果；先带上坐标，即使请求失败也能降级成地图跳转链接
    return { kind: 'unavailable', from: { lat: it.lat, lng: it.lng }, to: { lat: next.lat, lng: next.lng } }
  })

  const runs = buildCoordRuns(items)
  for (const run of runs) {
    if (run.coords.length < 2) continue
    const directionsLegs = await fetchRunLegs(run.coords)
    if (!directionsLegs) continue // 保持 'unavailable'（已经带着坐标），对应的行会降级成纯跳转链接
    directionsLegs.forEach((leg, i) => {
      const gapIndex = run.startIndex + i
      legs[gapIndex] = {
        kind: 'ok',
        distanceMeters: leg.distanceMeters,
        durationSeconds: leg.durationSeconds,
        from: run.coords[i],
        to: run.coords[i + 1],
      }
    })
  }

  const entry: RouteLegCacheEntry = { dayId, signature, legs, fetchedAt: Date.now() }
  await db.routeLegCache.put(entry)
  return legs
}

// 展示文案：真实路线距离超过 WALK_SUGGESTION_MAX_METERS 时不再建议步行时长（比如跨城市的
// 152公里"步行1817分钟"毫无意义），只显示"相距X公里"。API失败（'unavailable'）没有距离/时长
// 数据可显示，返回null——这种情况下 RouteLegHint 只渲染一个跳转图标，不硬凑文字
export function formatRouteLeg(leg: RouteLeg | undefined): string | null {
  if (!leg) return null
  if (leg.kind === 'missing-coords') return '位置未知'
  if (leg.kind === 'unavailable') return null
  const distanceText =
    leg.distanceMeters >= 1000 ? `${(leg.distanceMeters / 1000).toFixed(1)}公里` : `${leg.distanceMeters}米`
  if (leg.distanceMeters > WALK_SUGGESTION_MAX_METERS) return `相距${distanceText}`
  const minutes = Math.round(leg.durationSeconds / 60)
  return `步行${minutes}分钟 · ${distanceText}`
}

// 是否应该渲染成可点击跳转地图的链接——'missing-coords' 没有可用坐标，没法生成链接
export function isLegLinkable(leg: RouteLeg | undefined): leg is Extract<RouteLeg, { kind: 'ok' | 'unavailable' }> {
  return !!leg && (leg.kind === 'ok' || leg.kind === 'unavailable')
}

// 不锁定 travelmode——用户在 Google Maps 里自己选步行/开车/公交，这是用户明确要求的行为
export function buildMapsUrl(from: LatLng, to: LatLng): string {
  const params = new URLSearchParams({
    api: '1',
    origin: `${from.lat},${from.lng}`,
    destination: `${to.lat},${to.lng}`,
  })
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

// dayId 为空（比如日历视图还没选中某一天）时不发请求，直接返回空数组
export function useDayRouteLegs(dayId: string | undefined, items: ItineraryItem[]): RouteLeg[] {
  const [legs, setLegs] = useState<RouteLeg[]>([])
  const signature = useMemo(() => buildDaySignature(items), [items])

  useEffect(() => {
    if (!dayId || items.length < 2) {
      setLegs([])
      return
    }
    let cancelled = false
    getDayRouteLegs(dayId, items).then((result) => {
      if (!cancelled) setLegs(result)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 特意用 signature（内容签名）代替 items（每次渲染都是新数组引用）做依赖，否则每次渲染都会重新请求
  }, [dayId, signature])

  return legs
}
