// Vercel Edge Function：代理调用 OpenRouteService 的步行路线API。
//
// 为什么需要这一层代理而不是前端直接调 ORS：ORS的免费API key如果直接放进前端
// （VITE_ 前缀环境变量），会被打进公开的JS包里——虽然旅记整站有 middleware.ts 的
// 密码墙挡着，但用户明确要求这个key完全不进前端bundle，所以走一个单独的服务端
// 函数，key只存在 Vercel 后台的 ORS_API_KEY 环境变量（不带 VITE_ 前缀，不会被
// Vite 打进客户端代码）。
//
// 输入：一天里"连续且都有经纬度"的一段地点坐标（由前端 src/lib/routeLegs.ts 负责切分）。
// 输出：这段路线里每一段相邻地点之间的真实步行距离(米)和时长(秒)。
export const config = { runtime: 'edge' }

interface Coord {
  lat: number
  lng: number
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    })
  }

  const apiKey = process.env.ORS_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ORS_API_KEY 未配置' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  let coords: Coord[]
  try {
    const body = await request.json()
    coords = body?.coords
  } catch {
    return new Response(JSON.stringify({ error: '请求体不是合法JSON' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (!Array.isArray(coords) || coords.length < 2) {
    return new Response(JSON.stringify({ error: '至少需要2个坐标点' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  let orsRes: Response
  try {
    orsRes = await fetch('https://api.openrouteservice.org/v2/directions/foot-walking', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      // ORS 要求坐标顺序是 [经度, 纬度]，跟旅记内部 {lat, lng} 的顺序相反
      body: JSON.stringify({ coordinates: coords.map((c) => [c.lng, c.lat]) }),
    })
  } catch (err) {
    // 之前排查这一步的失败花了不少时间，因为原来只返回一句笼统的"网络失败"——
    // 实际上这一类 catch 也会接住 fetch() 本身抛出的同步错误（比如 Vercel 环境变量
    // 值本身带了不可见字符导致构造 Headers 失败，这个项目就真的踩过一次），
    // 跟真正的网络问题完全是两回事。把 err.message 打进日志 + 返回体，下次
    // 再出问题不用像这次一样靠猜，直接在 Vercel Runtime Logs 里能看到具体原因
    const message = err instanceof Error ? err.message : String(err)
    console.error('[route-directions] fetch to ORS threw before getting a response:', message)
    return new Response(JSON.stringify({ error: 'ORS请求失败（发送阶段）', detail: message }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (!orsRes.ok) {
    // ORS 出错时通常会在响应体里给出具体原因（比如坐标非法、key无效、额度用完），
    // 之前这里直接丢弃了响应体，只留了个 status 数字，等于把最有用的信息扔了
    const detail = await orsRes.text().catch(() => '')
    console.error('[route-directions] ORS responded with an error:', orsRes.status, detail)
    return new Response(JSON.stringify({ error: 'ORS请求失败', status: orsRes.status, detail }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }

  const data = await orsRes.json()
  const segments = data?.routes?.[0]?.segments ?? []
  const legs = segments.map((s: { distance: number; duration: number }) => ({
    distanceMeters: Math.round(s.distance),
    durationSeconds: Math.round(s.duration),
  }))

  return new Response(JSON.stringify({ legs }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
