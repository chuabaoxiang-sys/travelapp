import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import {
  isAllowedLinkUrl,
  detectPlatform,
  extractYouTubeVideoId,
  extractYouTubeThumbnail,
  parseOgTags,
} from './resolve-link-preview'

describe('isAllowedLinkUrl', () => {
  it('接受YouTube/Facebook/Bilibili/小红书的域名', () => {
    expect(isAllowedLinkUrl('https://www.youtube.com/watch?v=abc')).toBe(true)
    expect(isAllowedLinkUrl('https://youtu.be/abc')).toBe(true)
    expect(isAllowedLinkUrl('https://www.facebook.com/share/r/abc')).toBe(true)
    expect(isAllowedLinkUrl('https://fb.watch/abc')).toBe(true)
    expect(isAllowedLinkUrl('https://www.bilibili.com/video/abc')).toBe(true)
    expect(isAllowedLinkUrl('https://b23.tv/abc')).toBe(true)
    expect(isAllowedLinkUrl('https://www.xiaohongshu.com/discovery/item/abc')).toBe(true)
    expect(isAllowedLinkUrl('https://xhslink.com/abc')).toBe(true)
  })

  it('拒绝非https协议（即使域名合法）', () => {
    expect(isAllowedLinkUrl('http://www.youtube.com/watch?v=abc')).toBe(false)
  })

  it('拒绝不在名单里的域名——这是SSRF防护，不是漏看', () => {
    expect(isAllowedLinkUrl('https://evil.com/watch?v=abc')).toBe(false)
    expect(isAllowedLinkUrl('https://internal-service.local/admin')).toBe(false)
  })

  it('拒绝不合法的URL字符串', () => {
    expect(isAllowedLinkUrl('not a url')).toBe(false)
  })
})

describe('detectPlatform', () => {
  it('按域名分辨四个平台', () => {
    expect(detectPlatform('https://www.youtube.com/watch?v=abc')).toBe('youtube')
    expect(detectPlatform('https://youtu.be/abc')).toBe('youtube')
    expect(detectPlatform('https://www.facebook.com/share/r/abc')).toBe('facebook')
    expect(detectPlatform('https://fb.watch/abc')).toBe('facebook')
    expect(detectPlatform('https://www.bilibili.com/video/abc')).toBe('bilibili')
    expect(detectPlatform('https://b23.tv/abc')).toBe('bilibili')
    expect(detectPlatform('https://www.xiaohongshu.com/discovery/item/abc')).toBe('xiaohongshu')
  })

  it('识别不出来的域名归到other，不是报错', () => {
    expect(detectPlatform('https://example.com/whatever')).toBe('other')
    expect(detectPlatform('not a url')).toBe('other')
  })
})

describe('extractYouTubeVideoId / extractYouTubeThumbnail', () => {
  it('从youtu.be短链接取ID', () => {
    expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('从?v=参数取ID', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s')).toBe('dQw4w9WgXcQ')
  })

  it('从/shorts/路径取ID', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('拼出来的缩略图网址不用等页面抓取，直接可用', () => {
    expect(extractYouTubeThumbnail('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    )
  })

  it('取不到ID时返回null，不抛错误', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/')).toBeNull()
    expect(extractYouTubeThumbnail('https://www.youtube.com/')).toBeNull()
  })
})

describe('parseOgTags', () => {
  // 这份HTML是真实测试时用手机Safari UA抓下来的Facebook Reel分享链接响应
  // （桌面Chrome UA会被Facebook直接拒绝，见resolve-link-preview.ts顶部注释），
  // 不是编出来的假数据
  const facebookHtml = readFileSync(
    fileURLToPath(new URL('./__fixtures__/facebook-reel.html', import.meta.url)),
    'utf-8'
  )

  it('从真实抓到的Facebook页面里抠出og:image', () => {
    const { image } = parseOgTags(facebookHtml)
    expect(image).toContain('scontent.fkul10-2.fna.fbcdn.net')
    expect(image).toContain('758564263_18606362185022918_478585693803853661_n.jpg')
    // 真实响应里网址的&是HTML实体&amp;，抠出来必须解码成&，不然这个网址打不开
    expect(image).not.toContain('&amp;')
    expect(image).toContain('&')
  })

  it('从真实抓到的Facebook页面里抠出og:title，emoji数字实体也要正确解码', () => {
    const { title } = parseOgTags(facebookHtml)
    expect(title).toContain('4 Tourist traps you MUST avoid in Japan')
    // 原始HTML里emoji是&#x1f631;这种数字字符引用，解码后应该是真emoji字符，
    // 不能原样把&#x1f631;这串文字留在标题里
    expect(title).not.toContain('&#x')
    expect(title).toContain('😱')
  })

  it('完全没有og标签的页面，两个字段都是null', () => {
    const { title, image } = parseOgTags('<html><head><title>随便一个页面</title></head><body></body></html>')
    expect(title).toBeNull()
    expect(image).toBeNull()
  })

  it('content在前、property在后的属性顺序也能抠到', () => {
    const html = '<meta content="标题文字" property="og:title">'
    expect(parseOgTags(html).title).toBe('标题文字')
  })
})
