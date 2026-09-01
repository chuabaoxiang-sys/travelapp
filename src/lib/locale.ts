import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie'
import i18n from './i18n'

export type ResolvedLocale = 'zh' | 'en'
export type LocalePreference = ResolvedLocale | null

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
  const resolved = memberId ? resolveLocale(member?.preferredLocale ?? null) : detectDeviceLocale()

  useEffect(() => {
    if (i18n.language !== resolved) void i18n.changeLanguage(resolved)
  }, [resolved])
}
