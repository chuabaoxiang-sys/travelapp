// Vercel Edge Function：解析一个Google Maps分享链接，摘出精确的经纬度。
//
// 为什么需要这个：免费地理编码服务（Nominatim/OpenStreetMap）覆盖率有限，小型
// 酒店/民宿/餐厅这类商家经常没被收录，搜不到或者搜出来驴唇不对马嘴。但用户
// 往往已经在Google Maps上找到了这个地方、手上有一个分享链接——直接解析链接里
// 已经带着的精确坐标，比重新搜索可靠得多，而且完全不需要申请任何第三方API key，
// 不产生任何费用，纯粹是"跟着链接跳转一次，看最后停在哪"。
//
// 为什么要走服务端而不是前端直接fetch：Google Maps的短链接（maps.app.goo.gl）
// 是跨域的，浏览器里直接fetch短链接、想读取跳转后的最终网址会被CORS挡住；
// 服务端fetch不受这个限制。
//
// 安全考虑：这个函数会用服务端环境去请求"用户传入的任意网址"，如果不限制能传
// 什么网址，等于给了一个开放的服务端fetch代理（SSRF风险）。这里严格限制只能是
// Google Maps相关域名，其他域名一律拒绝。
export const config = { runtime: 'edge' }

export function isAllowedMapsUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase()
  return host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'google.com' || host.endsWith('.google.com')
}

// 从网址里的 /place/xxx 片段拿地点名字/地址——跟坐标提取是两回事，即使下面两种
// 坐标格式都没匹配到，这个字段往往还在，可以喂给 geocodeAddress() 兜底
export function extractNameFromUrl(finalUrl: string): string | null {
  const nameMatch = finalUrl.match(/\/place\/([^/@]+)/)
  return nameMatch ? decodeURIComponent(nameMatch[1]).replace(/\+/g, ' ') : null
}

// 优先找 !3d<lat>!4d<lng>——这是地图上具体那个标记点的精确坐标；
// 找不到才退而求其次用 @lat,lng（当前地图视野的中心点，可能因为缩放层级
// 差出去好几公里，不如标记点准，只在没有标记点信息时才用）
export function extractPlaceFromUrl(finalUrl: string): { lat: number; lng: number; name: string | null } | null {
  const pinMatch = finalUrl.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/)
  const centerMatch = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
  const match = pinMatch ?? centerMatch
  if (!match) return null

  return { lat: parseFloat(match[1]), lng: parseFloat(match[2]), name: extractNameFromUrl(finalUrl) }
}

// 兜底：网址本身没有坐标的分享链接（比如Google用内部编号指代地点、而不是
// 直接把经纬度写进网址的那种款式），改用Google自己的Geocoding API按地址查一次。
// 免费额度每月10,000次，这个功能只在前两种坐标格式都提取失败时才会调用，
// 实际调用量远低于此，不会真的产生费用——没配置 GOOGLE_GEOCODING_API_KEY 时
// 直接跳过这一步，不报错，只是退回"没找到坐标"的原有结果
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY
  if (!apiKey) return null

  const params = new URLSearchParams({ address, key: apiKey })
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`)
    if (!res.ok) return null
    const data = await res.json()
    const location = data?.results?.[0]?.geometry?.location
    if (typeof location?.lat !== 'number' || typeof location?.lng !== 'number') return null
    return { lat: location.lat, lng: location.lng }
  } catch {
    return null
  }
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    })
  }

  let url: unknown
  try {
    const body = await request.json()
    url = body?.url
  } catch {
    return new Response(JSON.stringify({ error: '请求体不是合法JSON' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (typeof url !== 'string' || !isAllowedMapsUrl(url)) {
    return new Response(JSON.stringify({ error: '只支持Google Maps的链接' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  let finalUrl: string
  try {
    const res = await fetch(url, { redirect: 'follow' })
    finalUrl = res.url
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: '打开链接失败', detail: message }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }

  const place = extractPlaceFromUrl(finalUrl)
  if (place) {
    return new Response(JSON.stringify(place), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  // 网址本身没带坐标（比如Google用内部编号指代这个地点的那种分享链接款式）——
  // 退而求其次，把网址里认得出来的地址交给Geocoding API再查一次
  const name = extractNameFromUrl(finalUrl)
  if (name) {
    if (!process.env.GOOGLE_GEOCODING_API_KEY) {
      // 单独判断一次而不是让 geocodeAddress 静默返回null——这样"key没配置"和
      // "Google也没查到"这两种情况在detail里能分清楚，方便部署后排查
      return new Response(JSON.stringify({ error: '这个链接里没有找到坐标信息', detail: 'GOOGLE_GEOCODING_API_KEY 未配置，跳过了兜底查询' }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      })
    }
    const geocoded = await geocodeAddress(name)
    if (geocoded) {
      return new Response(JSON.stringify({ ...geocoded, name }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  }

  return new Response(JSON.stringify({ error: '这个链接里没有找到坐标信息' }), {
    status: 422,
    headers: { 'content-type': 'application/json' },
  })
}
