import { describe, it, expect } from 'vitest'
import { looksLikeGoogleMapsUrl } from './geocoding'

describe('looksLikeGoogleMapsUrl', () => {
  it('识别Google Maps短链接', () => {
    expect(looksLikeGoogleMapsUrl('https://maps.app.goo.gl/TYsyHBpsS7f49tm48')).toBe(true)
  })

  it('识别完整的google.com/maps网址', () => {
    expect(looksLikeGoogleMapsUrl('https://www.google.com/maps/place/Asakusa-home/@35.7,139.8,12z')).toBe(true)
  })

  it('不是网址的普通文字返回false', () => {
    expect(looksLikeGoogleMapsUrl('浅草寺')).toBe(false)
  })

  it('其他网站的网址返回false', () => {
    expect(looksLikeGoogleMapsUrl('https://example.com/maps/foo')).toBe(false)
  })

  it('前后带空格也能识别', () => {
    expect(looksLikeGoogleMapsUrl('  https://maps.app.goo.gl/abc123  ')).toBe(true)
  })
})
