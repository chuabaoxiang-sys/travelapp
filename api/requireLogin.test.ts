import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import routeDirections, { isValidCoordList, MAX_ROUTE_COORDS } from './route-directions'
import resolveLinkPreview, { isAllowedLinkUrl, MAX_LINK_URL_LENGTH } from './resolve-link-preview'
import resolveMapsLink, { isAllowedMapsUrl, MAX_MAPS_URL_LENGTH } from './resolve-maps-link'

// 2026-10 安全检查：这三个接口以前谁都能直接调用，可以拿它们刷 ORS / Google Geocoding /
// Vercel 的额度。现在必须带有效的登录 token，这组测试锁定"没带 token 一律 401、
// 而且在碰任何第三方服务之前就被挡掉"
describe('三个代理接口都要求登录', () => {
  const fetchSpy = vi.fn()

  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-test')
    vi.stubEnv('ORS_API_KEY', 'ors-key-for-test')
    fetchSpy.mockReset()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  function post(body: unknown, headers: Record<string, string> = {}) {
    return new Request('https://app.example/api/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  }

  it('步行路线：没带 token 返回 401，不会去调 ORS', async () => {
    const res = await routeDirections(post({ coords: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }] }))
    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('链接预览：没带 token 返回 401，不会去抓页面', async () => {
    const res = await resolveLinkPreview(post({ url: 'https://www.bilibili.com/video/BV1xx' }))
    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('地图链接解析：没带 token 返回 401，不会去打开链接', async () => {
    const res = await resolveMapsLink(post({ url: 'https://maps.app.goo.gl/abc123' }))
    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('只有 "Bearer " 没有实际 token 也算没登录', async () => {
    const res = await routeDirections(post({ coords: [] }, { authorization: 'Bearer   ' }))
    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('isValidCoordList', () => {
  const p = (lat: number, lng: number) => ({ lat, lng })

  it('2 到 50 个合法坐标点才算数', () => {
    expect(isValidCoordList([p(35.7, 139.7), p(35.6, 139.8)])).toBe(true)
    expect(isValidCoordList(Array.from({ length: MAX_ROUTE_COORDS }, () => p(1, 1)))).toBe(true)
    expect(isValidCoordList([p(1, 1)])).toBe(false)
    expect(isValidCoordList(Array.from({ length: MAX_ROUTE_COORDS + 1 }, () => p(1, 1)))).toBe(false)
    expect(isValidCoordList(null)).toBe(false)
  })

  it('经纬度超出范围、不是数字、NaN 都不行', () => {
    expect(isValidCoordList([p(91, 0), p(0, 0)])).toBe(false)
    expect(isValidCoordList([p(0, 181), p(0, 0)])).toBe(false)
    expect(isValidCoordList([p(Number.NaN, 0), p(0, 0)])).toBe(false)
    expect(isValidCoordList([{ lat: '1', lng: 2 }, p(0, 0)])).toBe(false)
    expect(isValidCoordList([null, p(0, 0)])).toBe(false)
  })
})

describe('链接长度上限', () => {
  it('超过 2000 字符的链接直接拒绝，即使域名合法', () => {
    const longLink = 'https://www.youtube.com/watch?v=abc&x=' + 'a'.repeat(MAX_LINK_URL_LENGTH)
    expect(isAllowedLinkUrl(longLink)).toBe(false)
    const longMaps = 'https://maps.app.goo.gl/' + 'a'.repeat(MAX_MAPS_URL_LENGTH)
    expect(isAllowedMapsUrl(longMaps)).toBe(false)
  })

  it('正常长度的照常放行', () => {
    expect(isAllowedLinkUrl('https://www.youtube.com/watch?v=abc')).toBe(true)
    expect(isAllowedMapsUrl('https://maps.app.goo.gl/abc123')).toBe(true)
  })
})
