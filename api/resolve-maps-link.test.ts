import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isAllowedMapsUrl, extractPlaceFromUrl, extractNameFromUrl, geocodeAddress } from './resolve-maps-link'

describe('isAllowedMapsUrl', () => {
  it('接受 maps.app.goo.gl 短链接', () => {
    expect(isAllowedMapsUrl('https://maps.app.goo.gl/abc123')).toBe(true)
  })

  it('接受 goo.gl 短链接', () => {
    expect(isAllowedMapsUrl('https://goo.gl/maps/abc123')).toBe(true)
  })

  it('接受 www.google.com/maps 完整链接', () => {
    expect(isAllowedMapsUrl('https://www.google.com/maps/place/Asakusa-home')).toBe(true)
  })

  it('拒绝非https协议（即使域名合法）', () => {
    expect(isAllowedMapsUrl('http://www.google.com/maps')).toBe(false)
  })

  it('拒绝非Google域名', () => {
    expect(isAllowedMapsUrl('https://evil.com/maps')).toBe(false)
  })

  it('拒绝不合法的URL字符串', () => {
    expect(isAllowedMapsUrl('not a url')).toBe(false)
  })
})

describe('extractPlaceFromUrl', () => {
  it('优先取!3d!4d标记点坐标，而不是@视野中心点（真实案例：中心点跟标记点能差出9公里）', () => {
    const url = 'https://www.google.com/maps/place/Asakusa-home/@35.6269394,139.6816956,12z/data=!4m11!3m10!1s0x60188ece5c8b11f9:0x8b9d47f66340bf9d!5m4!1s2026-10-21!2i5!4m1!1i2!8m2!3d35.7061325!4d139.8014925!16s%2Fg%2F11flxcxkpv?entry=tts'
    const place = extractPlaceFromUrl(url)
    expect(place).toEqual({ lat: 35.7061325, lng: 139.8014925, name: 'Asakusa-home' })
  })

  it('没有!3d!4d标记点时，退回用@视野中心点', () => {
    const url = 'https://www.google.com/maps/place/某餐厅/@3.139,101.6869,15z'
    const place = extractPlaceFromUrl(url)
    expect(place).toEqual({ lat: 3.139, lng: 101.6869, name: '某餐厅' })
  })

  it('两种坐标模式都没有时返回null', () => {
    expect(extractPlaceFromUrl('https://www.google.com/maps/search/coffee')).toBeNull()
  })

  it('没有/place/片段时name为null，但坐标仍然能提取', () => {
    const url = 'https://www.google.com/maps/@3.139,101.6869,15z'
    expect(extractPlaceFromUrl(url)).toEqual({ lat: 3.139, lng: 101.6869, name: null })
  })

  it('q=参数直接就是"纬度,经度"的纯坐标分享（没有/place/也没有!3d!4d/@）时，坐标仍能提取', () => {
    const url = 'https://www.google.com/maps?q=35.6812,139.7671&entry=gps'
    expect(extractPlaceFromUrl(url)).toEqual({ lat: 35.6812, lng: 139.7671, name: null })
  })
})

describe('extractNameFromUrl', () => {
  it('两种坐标格式都没有时，仍然能单独取出/place/片段里的地址', () => {
    // 真实案例：Google用内部编号指代地点的分享链接款式，data=里没有!3d!4d也没有@lat,lng，
    // 但/place/片段里的地址还在——这是 geocodeAddress 兜底能用上的唯一线索
    const url = 'https://www.google.com/maps/place/Futaba,+2+Chome-2-9+Sarugakucho,+Chiyoda+City,+Tokyo+101-0064,+Japan/data=!4m2!3m1!1s0x60188c166308e715:0x7f5757cbb9a7bef4!18m1!1e1'
    expect(extractNameFromUrl(url)).toBe('Futaba, 2 Chome-2-9 Sarugakucho, Chiyoda City, Tokyo 101-0064, Japan')
  })

  it('没有/place/片段时返回null', () => {
    expect(extractNameFromUrl('https://www.google.com/maps/@3.139,101.6869,15z')).toBeNull()
  })

  it('第三种款式（常见于iPhone分享）：没有/place/片段，地址整个塞进q=参数里', () => {
    // 真实案例：iPhone上从Google Maps App分享出来的链接，跳转后长这样，
    // 既没有/place/片段、也没有!3d!4d/@坐标，只有q=里的完整地址
    const url = 'https://www.google.com/maps?q=Soup+Curry+Begirama,+10-2+Matsukazecho,+Hakodate,+Hokkaido+040-0035,+Japan&ftid=0x5f9ef3200d849c95:0xa28073a4f78e3925&entry=gps&g_st=ic'
    expect(extractNameFromUrl(url)).toBe('Soup Curry Begirama, 10-2 Matsukazecho, Hakodate, Hokkaido 040-0035, Japan')
  })

  it('q=参数是纯"纬度,经度"坐标时，不当作地址文本返回（交给extractPlaceFromUrl处理坐标）', () => {
    const url = 'https://www.google.com/maps?q=35.6812,139.7671&entry=gps'
    expect(extractNameFromUrl(url)).toBeNull()
  })
})

describe('geocodeAddress', () => {
  const originalKey = process.env.GOOGLE_GEOCODING_API_KEY
  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.GOOGLE_GEOCODING_API_KEY = 'test-key'
  })
  afterEach(() => {
    process.env.GOOGLE_GEOCODING_API_KEY = originalKey
    global.fetch = originalFetch
  })

  it('没配置API key时直接返回失败原因，不发请求', async () => {
    delete process.env.GOOGLE_GEOCODING_API_KEY
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
    expect(await geocodeAddress('随便一个地址')).toEqual({ ok: false, reason: 'no_api_key' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('Geocoding API返回正常结果时提取lat/lng', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ geometry: { location: { lat: 35.7, lng: 139.77 } } }] }),
    }) as unknown as typeof fetch
    expect(await geocodeAddress('某个地址')).toEqual({ ok: true, lat: 35.7, lng: 139.77 })
  })

  it('Geocoding API查不到结果时，reason带上Google自己的status（比如ZERO_RESULTS）方便排查', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [], status: 'ZERO_RESULTS' }),
    }) as unknown as typeof fetch
    expect(await geocodeAddress('查不到的地址')).toEqual({ ok: false, reason: 'ZERO_RESULTS' })
  })

  it('key配置错误等场景（REQUEST_DENIED）也能在reason里看到，而不是笼统地返回null', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [], status: 'REQUEST_DENIED', error_message: 'API key not valid' }),
    }) as unknown as typeof fetch
    expect(await geocodeAddress('某个地址')).toEqual({ ok: false, reason: 'REQUEST_DENIED: API key not valid' })
  })

  it('请求失败（网络错误/非200）时返回失败原因，不抛出异常', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch
    expect(await geocodeAddress('某个地址')).toEqual({ ok: false, reason: 'http_500' })

    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    expect(await geocodeAddress('某个地址')).toEqual({ ok: false, reason: 'network down' })
  })
})
