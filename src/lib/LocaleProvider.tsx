import type { ReactNode } from 'react'
import { useSyncResolvedLocale } from './locale'

// react-i18next的useTranslation()本身就是个全局订阅——语言一变，所有用它的组件
// 自动重渲染，不需要再另外包一层自己的Context去广播。这个组件只负责"该由谁来决定
// 现在生效的是哪个语言"这一件事：身份选定前用设备语言，选定后跟着当前这个人的
// 偏好走，effectiveMemberId变化（切换"你是谁"）时重新解析并调用i18n.changeLanguage
export function LocaleProvider({ memberId, children }: { memberId: string | null; children: ReactNode }) {
  useSyncResolvedLocale(memberId)
  return <>{children}</>
}
