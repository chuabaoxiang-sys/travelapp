import { db } from '../db/dexie'
import { getCurrentHouseholdId } from './household'
import { haversineMeters } from '../lib/geo'
import { resolveLinkPreview } from '../api/linkPreview'
import type { WishlistPlace, WishlistPlaceLink, ItineraryItem } from '../types'

export async function listWishlistPlaces(): Promise<WishlistPlace[]> {
  const all = await db.wishlistPlaces.toArray()
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export async function createWishlistPlace(params: {
  name: string
  lat: number | null
  lng: number | null
  notes: string | null
  createdBy: string | null
}): Promise<WishlistPlace> {
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('No household found')
  const id = crypto.randomUUID()
  const now = Date.now()
  const place: WishlistPlace = {
    id,
    householdId,
    name: params.name,
    lat: params.lat,
    lng: params.lng,
    notes: params.notes,
    visited: false,
    createdBy: params.createdBy,
    createdAt: now,
    updatedAt: now,
  }
  await db.wishlistPlaces.add(place)
  return place
}

export async function updateWishlistPlace(
  id: string,
  updates: { name: string; lat: number | null; lng: number | null; notes: string | null },
) {
  await db.wishlistPlaces.update(id, { ...updates, updatedAt: Date.now() })
}

export async function toggleWishlistVisited(id: string, visited: boolean) {
  await db.wishlistPlaces.update(id, { visited, updatedAt: Date.now() })
}

// 硬删除——已经加进某趟行程的行程项自己拷贝了一份名字/坐标（sourceWishlistId 只是
// 追溯指针），不依赖这条收藏继续存在，删掉不影响已经排好的行程
export async function deleteWishlistPlace(id: string) {
  await db.wishlistPlaces.delete(id)
  // 远端数据库层on delete cascade会自动清掉挂在下面的链接，但本地Dexie这边
  // 两张表是各自独立同步的，不会自动级联——手动清一次，避免残留孤儿数据
  await db.wishlistPlaceLinks.where('wishlistPlaceId').equals(id).delete()
}

// 贴一条YouTube/Facebook/Bilibili/小红书链接，服务端抓一次缩略图/标题存下来。
// 抓不到（resolveLinkPreview返回null，或者平台字段缺失）不算失败——链接本身
// 照样存，title/thumbnailUrl留空，UI走降级样式，用户随时能点开原链接
export async function addWishlistPlaceLink(wishlistPlaceId: string, url: string, createdBy: string | null): Promise<WishlistPlaceLink> {
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('No household found')
  const preview = await resolveLinkPreview(url)
  const link: WishlistPlaceLink = {
    id: crypto.randomUUID(),
    wishlistPlaceId,
    householdId,
    url,
    platform: preview?.platform ?? 'other',
    title: preview?.title ?? null,
    thumbnailUrl: preview?.thumbnailUrl ?? null,
    createdBy,
    createdAt: Date.now(),
  }
  await db.wishlistPlaceLinks.add(link)
  return link
}

// 硬删除——链接本身没有其他数据依赖它，删了大不了重贴一条，不需要二次确认
export async function deleteWishlistPlaceLink(id: string) {
  await db.wishlistPlaceLinks.delete(id)
}

// 一次查出当前团队所有链接、按地点分组——照抄 usageByWishlistEntry 的做法，
// 现查不存计数器，供 WishlistScreen 一次性拿到"每个地点分别挂了哪些链接"
export async function linksByWishlistPlace(): Promise<Map<string, WishlistPlaceLink[]>> {
  const links = await db.wishlistPlaceLinks.toArray()
  const byPlace = new Map<string, WishlistPlaceLink[]>()
  for (const link of links) {
    const arr = byPlace.get(link.wishlistPlaceId) ?? []
    arr.push(link)
    byPlace.set(link.wishlistPlaceId, arr)
  }
  for (const arr of byPlace.values()) arr.sort((a, b) => a.createdAt - b.createdAt)
  return byPlace
}

export interface WishlistUsage {
  tripNames: string[]
}

// 这条想去的地点有没有被排入过行程——现查现算，绝不在 WishlistPlace 上存计数器/布尔值。
// 本次会话刚把 rateBookEntries.useCount 这种存法整个移除换成现查（见 domain/rates.ts 的
// usageByEntry），因为存起来的标记会在引用行被删除/改动后跟事实脱节——这里从一开始就
// 不重蹈覆辙
export async function usageByWishlistEntry(): Promise<Map<string, WishlistUsage>> {
  const items = await db.itineraryItems.toArray()
  const tripIdsByWishlistId = new Map<string, Set<string>>()
  for (const it of items) {
    if (!it.sourceWishlistId) continue
    const set = tripIdsByWishlistId.get(it.sourceWishlistId) ?? new Set<string>()
    set.add(it.tripId)
    tripIdsByWishlistId.set(it.sourceWishlistId, set)
  }
  if (tripIdsByWishlistId.size === 0) return new Map()

  const allTripIds = [...new Set([...tripIdsByWishlistId.values()].flatMap((s) => [...s]))]
  const trips = await db.trips.where('id').anyOf(allTripIds).toArray()
  const tripNameById = new Map(trips.map((t) => [t.id, t.name]))

  const usage = new Map<string, WishlistUsage>()
  for (const [wishlistId, tripIdSet] of tripIdsByWishlistId) {
    const tripNames = [...tripIdSet].map((id) => tripNameById.get(id)).filter((n): n is string => !!n)
    usage.set(wishlistId, { tripNames })
  }
  return usage
}

// "反向提醒"用的匹配半径——够覆盖同一个城市/都会圈，又不至于把完全不相关的地方拉进来
const NEARBY_THRESHOLD_METERS = 50_000

// 这趟行程还没关联过的想去地点里，哪些"看起来跟当前这一天有关"（离当前这一天已经
// 排上时间线的某个行程项足够近）。纯几何计算，不调用任何地图API、不新增存储字段。
//
// 距离锚点故意只用"当前这一天"的行程项，不是整趟行程的——像"东京北海道"这种跨城市
// 的行程，如果拿整趟行程的点当锚点，东京附近的地点会在看北海道那几天时也被推荐出来，
// 隔着几百公里毫无意义。但"是否已经排入过"这件事要看整趟行程：已经在任何一天用过的
// 地点，换到别的天看也不该重复推荐，所以这两个用途各传各的行程项列表
export function nearbyWishlistSuggestions(
  places: WishlistPlace[],
  dayItineraryItems: ItineraryItem[],
  tripItineraryItems: ItineraryItem[],
): WishlistPlace[] {
  const alreadyLinkedIds = new Set(
    tripItineraryItems.map((it) => it.sourceWishlistId).filter((id): id is string => !!id),
  )
  const anchors = dayItineraryItems.filter(
    (it): it is ItineraryItem & { lat: number; lng: number } => it.lat != null && it.lng != null,
  )
  if (!anchors.length) return []

  return places.filter((p) => {
    if (p.lat == null || p.lng == null) return false
    if (alreadyLinkedIds.has(p.id)) return false
    const point = { lat: p.lat, lng: p.lng }
    return anchors.some((a) => haversineMeters(point, { lat: a.lat, lng: a.lng }) <= NEARBY_THRESHOLD_METERS)
  })
}
