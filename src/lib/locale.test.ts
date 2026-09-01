import { describe, it, expect, afterEach, vi } from 'vitest'
import { detectDeviceLocale, resolveLocale } from './locale'

function mockNavigatorLanguages(languages: string[]) {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages)
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(languages[0])
}

describe('detectDeviceLocale', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('zh-CN、zh-Hant-TW这类以zh开头的标签都算中文', () => {
    mockNavigatorLanguages(['zh-CN', 'en-US'])
    expect(detectDeviceLocale()).toBe('zh')
    mockNavigatorLanguages(['zh-Hant-TW'])
    expect(detectDeviceLocale()).toBe('zh')
  })

  it('不是zh开头的一律归为英文，不细分英式/美式', () => {
    mockNavigatorLanguages(['en-GB'])
    expect(detectDeviceLocale()).toBe('en')
    mockNavigatorLanguages(['ja-JP'])
    expect(detectDeviceLocale()).toBe('en')
  })
})

describe('resolveLocale', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('有明确选择时直接用那个值，不管设备语言是什么', () => {
    mockNavigatorLanguages(['en-US'])
    expect(resolveLocale('zh')).toBe('zh')
    mockNavigatorLanguages(['zh-CN'])
    expect(resolveLocale('en')).toBe('en')
  })

  it('偏好是null（跟随系统）时实时读设备语言', () => {
    mockNavigatorLanguages(['zh-CN'])
    expect(resolveLocale(null)).toBe('zh')
    mockNavigatorLanguages(['en-US'])
    expect(resolveLocale(null)).toBe('en')
  })
})
