// Vercel Edge Function：抓一个YouTube/Facebook/Bilibili/小红书链接的缩略图和标题，
// 给"想去的地点"下面挂的参考链接用。
//
// 为什么要走服务端而不是前端直接fetch：这几个平台的页面在浏览器里直接fetch会被
// CORS挡住；服务端fetch不受这个限制。
//
// 为什么统一用抓og:image/og:title的办法，不是每个平台单独接一次官方API：
// Facebook要走Graph API+开发者权限申请，很多帖子类型申请了也拿不到；小红书
// 完全没有公开接口。抓公开页面自带的Open Graph标签是唯一一套对四个平台都通用
// 的办法——YouTube/Bilibili基本都能成功，Facebook/小红书抓不到就返回null，
// 前端走降级样式，不当成错误处理。
//
// 为什么用手机Safari的User-Agent：真机测试过，同一条Facebook分享链接用桌面
// Chrome的UA会被直接拒绝（HTTP 400），换成手机Safari风格的UA才能拿到完整页面。
//
// 安全考虑：跟 resolve-maps-link.ts 同样的SSRF顾虑——只允许这四个平台的域名，
// 其他域名一律拒绝，不做开放的服务端fetch代理。
export const config = { runtime: 'edge' }

export type LinkPlatform = 'youtube' | 'facebook' | 'bilibili' | 'xiaohongshu' | 'other'

const ALLOWED_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be',
  'facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.watch',
  'bilibili.com', 'www.bilibili.com', 'm.bilibili.com', 'b23.tv',
  'xiaohongshu.com', 'www.xiaohongshu.com', 'xhslink.com',
])

const MOBILE_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'

export function isAllowedLinkUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  return ALLOWED_HOSTS.has(u.hostname.toLowerCase())
}

export function detectPlatform(raw: string): LinkPlatform {
  let host: string
  try {
    host = new URL(raw).hostname.toLowerCase()
  } catch {
    return 'other'
  }
  if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'youtube'
  if (host === 'fb.watch' || host.endsWith('facebook.com')) return 'facebook'
  if (host === 'b23.tv' || host.endsWith('bilibili.com')) return 'bilibili'
  if (host === 'xhslink.com' || host.endsWith('xiaohongshu.com')) return 'xiaohongshu'
  return 'other'
}

// 拿视频ID直接拼缩略图网址，不用等页面抓取——更快，也不受Facebook那种
// UA拦截问题影响。覆盖三种常见款式：youtu.be/ID、?v=ID、/shorts/ID
export function extractYouTubeVideoId(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  if (host === 'youtu.be') {
    return u.pathname.slice(1).split('/')[0] || null
  }
  const v = u.searchParams.get('v')
  if (v) return v
  const shortsMatch = u.pathname.match(/^\/shorts\/([^/]+)/)
  if (shortsMatch) return shortsMatch[1]
  const embedMatch = u.pathname.match(/^\/embed\/([^/]+)/)
  if (embedMatch) return embedMatch[1]
  return null
}

export function extractYouTubeThumbnail(raw: string): string | null {
  const id = extractYouTubeVideoId(raw)
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null
}

// 标题里常见emoji是数字字符引用（比如&#x1f631;），不解码的话会在卡片上
// 原样显示这串乱码，所以数字引用（十六进制/十进制）也要处理，不只是几个
// 常见命名实体
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
}

// 正则抠<meta property="og:xxx" content="...">，两种属性顺序都试一遍（真实
// 页面大多数是property在前，但不是所有平台都保证顺序）。抠不到就是null，
// 不算错误
export function parseOgTags(html: string): { title: string | null; image: string | null } {
  function extract(property: string): string | null {
    const propFirst = new RegExp(`<meta[^>]+property=["']og:${property}["'][^>]*content=["']([^"']*)["']`, 'i')
    const match = html.match(propFirst)
    if (match) return decodeHtmlEntities(match[1])
    const contentFirst = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:${property}["']`, 'i')
    const match2 = html.match(contentFirst)
    return match2 ? decodeHtmlEntities(match2[1]) : null
  }
  return { title: extract('title'), image: extract('image') }
}

export interface LinkPreviewResult {
  platform: LinkPlatform
  title: string | null
  thumbnailUrl: string | null
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

  if (typeof url !== 'string' || !isAllowedLinkUrl(url)) {
    return new Response(JSON.stringify({ error: '只支持YouTube/Facebook/Bilibili/小红书的链接' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const platform = detectPlatform(url)

  if (platform === 'youtube') {
    const result: LinkPreviewResult = { platform, title: null, thumbnailUrl: extractYouTubeThumbnail(url) }
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  // 抓失败（网络错误/平台拦截/HTTP非200）不当成接口错误——HTTP照常返回200，
  // title/thumbnailUrl留空，前端走降级样式，不弹错误提示
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': MOBILE_SAFARI_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
    if (!res.ok) {
      const result: LinkPreviewResult = { platform, title: null, thumbnailUrl: null }
      return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const html = await res.text()
    const { title, image } = parseOgTags(html)
    const result: LinkPreviewResult = { platform, title, thumbnailUrl: image }
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } })
  } catch {
    const result: LinkPreviewResult = { platform, title: null, thumbnailUrl: null }
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}
