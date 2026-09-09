import { Suspense, lazy } from 'react'
import { useTranslation } from 'react-i18next'
import { LocaleProvider } from '../../lib/LocaleProvider'

// SharePage拉进10套分享页模板的完整渲染组件，只有走/share/:token的访客用得到——
// 懒加载，绝大多数打开主APP的家庭成员完全不用下载这部分代码。单独拆一个文件
// （而不是直接在main.tsx里定义lazy组件）是因为main.tsx本身没有导出，
// oxlint的react(only-export-components)规则会认为这是个"定义了组件但没导出"
// 的文件，跟这个项目之前categoryVisuals.tsx/heroRawValue的拆分是同一个原因
const SharePage = lazy(() => import('./SharePage.tsx').then((m) => ({ default: m.SharePage })))

// /share/:token是main.tsx里独立于<App/>的一条路由，不会经过App.tsx外层包的
// LocaleProvider——之前这里完全没做语言判断，i18n初始化时硬编码的lng:'zh'
// 就是访客看到的最终语言，跟设备语言是中文还是英文无关。这里套上跟App.tsx
// 同一个LocaleProvider（memberId传null，永远走"设备语言探测"这条路径，
// 公开页面没有"当前是谁"的概念）
export function LazySharePage() {
  const { t } = useTranslation()
  return (
    <LocaleProvider memberId={null}>
      <Suspense fallback={<div className="min-h-screen bg-paper flex items-center justify-center text-muted text-sm">{t('sharePage.loading')}</div>}>
        <SharePage />
      </Suspense>
    </LocaleProvider>
  )
}
