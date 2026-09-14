import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie'
import i18n from './i18n'

export type ResolvedLocale = 'zh' | 'en'
export type LocalePreference = ResolvedLocale | null

const PRE_LOGIN_LOCALE_KEY = 'trip-journal:pre-login-locale'

// 官网落地页跳过来的链接会带 ?lang=zh|en（对应访客在官网上选的语言）——记一份到
// localStorage，登录前几屏（EmailLogin/NoHouseholdScreen/MemberGate，这几屏都还没
// memberId）优先认这个，而不是设备语言。跳去邮箱点magic link经常会开新标签页，
// sessionStorage 关联的是同一个标签页、跳转后可能读不到，所以选 localStorage。
// 只在URL真的带着这个参数时才写，不带就完全不碰，不影响原有"跟随系统"行为；
// 一旦选定身份（有member记录了），语言就完全交给该member自己的preferredLocale，
// 不再看这份值——避免这个官网来源的旧信号，把之后新建的其他家庭成员也一起带偏
export function captureLocaleFromUrl(search: string) {
  try {
    const param = new URLSearchParams(search).get('lang')
    if (param === 'zh' || param === 'en') {
      localStorage.setItem(PRE_LOGIN_LOCALE_KEY, param)
    }
  } catch {
    // localStorage 不可用（隐私模式等）时静默忽略，不影响其余功能
  }
}
if (typeof window !== 'undefined') {
  captureLocaleFromUrl(window.location.search)
}

// 只分中文/英文两桶——浏览器语言标签五花八门（zh-CN/zh-Hant-TW/en-GB…），
// 这里不需要真的区分地区，只要判断是不是中文
export function detectDeviceLocale(): ResolvedLocale {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language]
  return langs.some((l) => l?.toLowerCase().startsWith('zh')) ? 'zh' : 'en'
}

// preferred为null（"跟随系统"）时实时读设备语言；有明确选择时直接用那个值，
// 不受设备语言变化影响
export function resolveLocale(preferred: LocalePreference): ResolvedLocale {
  return preferred ?? detectDeviceLocale()
}

// 选身份之前（EmailLogin、"你是谁"）没有memberId可查，直接用这个
export function useDeviceLocale(): ResolvedLocale {
  return detectDeviceLocale()
}

// 登录前几屏专用：优先看官网带过来的语言，没有才落回真实设备语言
export function resolvePreLoginLocale(): ResolvedLocale {
  try {
    const stored = localStorage.getItem(PRE_LOGIN_LOCALE_KEY)
    if (stored === 'zh' || stored === 'en') return stored
  } catch {
    // localStorage 不可用时静默忽略，落回设备语言
  }
  return detectDeviceLocale()
}

// 选定身份之后：读这个人存的语言偏好，解析出实际生效的语言，并提供改偏好的setter。
// 形状照抄 theme.ts 的 useThemePreference——区别是这个值存在Dexie（会同步），
// 不是localStorage（纯设备级）
export function useLocalePreference(memberId: string | null) {
  const member = useLiveQuery(() => (memberId ? db.members.get(memberId) : undefined), [memberId])
  const preference: LocalePreference = member?.preferredLocale ?? null
  const resolved = resolveLocale(preference)

  async function setPreference(next: LocalePreference) {
    if (!memberId) return
    await db.members.update(memberId, { preferredLocale: next })
  }

  return [preference, resolved, setPreference] as const
}

// 把i18next的当前语言实时同步成"这个人应该看到的语言"——挂在App.tsx顶层，
// 身份选定前用设备语言、选定后跟着这个人的偏好走，切换"你是谁"时立刻生效
export function useSyncResolvedLocale(memberId: string | null) {
  const member = useLiveQuery(() => (memberId ? db.members.get(memberId) : undefined), [memberId])
  const resolved = memberId ? resolveLocale(member?.preferredLocale ?? null) : resolvePreLoginLocale()

  useEffect(() => {
    if (i18n.language !== resolved) void i18n.changeLanguage(resolved)
  }, [resolved])
}
