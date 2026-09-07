import type { WishlistPlaceLinkPlatform } from '../types'

// 粘贴的文字是不是一个支持抓预览的链接——覆盖YouTube/Facebook/Bilibili/小红书
// 的常见域名，跟服务端 api/resolve-link-preview.ts 的allowlist保持一致
export function looksLikeSupportedLink(text: string): boolean {
  return /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be|facebook\.com|fb\.watch|bilibili\.com|b23\.tv|xiaohongshu\.com|xhslink\.com)\//i.test(
    text.trim()
  )
}

export interface LinkPreviewResult {
  platform: WishlistPlaceLinkPlatform
  title: string | null
  thumbnailUrl: string | null
}

// 交给服务端抓缩略图/标题（见 api/resolve-link-preview.ts）——这几个平台的页面
// 直接在浏览器里fetch会被CORS挡住。抓失败（网络问题/平台拦截）统一返回null，
// 调用方（domain/wishlist.ts 的 addWishlistPlaceLink）照样把链接存下来，
// 只是没有预览图，不是不给存
export async function resolveLinkPreview(url: string): Promise<LinkPreviewResult | null> {
  try {
    const res = await fetch('/api/resolve-link-preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}
