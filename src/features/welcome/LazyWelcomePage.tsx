import { Suspense, lazy } from 'react'
import { useTranslation } from 'react-i18next'
import { LocaleProvider } from '../../lib/LocaleProvider'

// 跟 LazySharePage 同一个理由拆成单独文件：main.tsx 本身没有导出，
// oxlint的react(only-export-components)规则会认为这是"定义了组件但没导出"
const WelcomePage = lazy(() => import('./WelcomePage.tsx').then((m) => ({ default: m.WelcomePage })))

// /welcome是main.tsx里独立于<App/>的公开路由（社媒/推广链接用），访客大概率
// 还没登录、也没有memberId——跟LazySharePage一样套LocaleProvider(memberId=null)
// 做"设备语言探测"当默认值，页面自己的中/英按钮再用i18n.changeLanguage()覆盖
export function LazyWelcomePage() {
  const { t } = useTranslation()
  return (
    <LocaleProvider memberId={null}>
      <Suspense fallback={<div className="min-h-screen bg-paper flex items-center justify-center text-muted text-sm">{t('common.appName')}</div>}>
        <WelcomePage />
      </Suspense>
    </LocaleProvider>
  )
}
