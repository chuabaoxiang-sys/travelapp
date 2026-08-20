import type { LatLng } from '../types'

// 两点间的直线距离（球面近似），单位米。跟 lib/routeLegs.ts 里的 distanceMeters 不是
// 一回事——那个是调用 OpenRouteService 拿到的真实步行路网距离，这里只是"大概有多近"
// 的粗略几何计算，不发起任何网络请求，供"附近想去的地点"这类轻量匹配用
const EARTH_RADIUS_METERS = 6371000

function toRad(deg: number) {
  return (deg * Math.PI) / 180
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h))
}
