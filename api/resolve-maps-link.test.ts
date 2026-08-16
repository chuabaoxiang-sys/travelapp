import { describe, it, expect } from 'vitest'
import { isAllowedMapsUrl, extractPlaceFromUrl } from './resolve-maps-link'

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
})
