import { Suspense, lazy } from 'react'

// SharePage拉进10套分享页模板的完整渲染组件，只有走/share/:token的访客用得到——
// 懒加载，绝大多数打开主APP的家庭成员完全不用下载这部分代码。单独拆一个文件
// （而不是直接在main.tsx里定义lazy组件）是因为main.tsx本身没有导出，
// oxlint的react(only-export-components)规则会认为这是个"定义了组件但没导出"
// 的文件，跟这个项目之前categoryVisuals.tsx/heroRawValue的拆分是同一个原因
const SharePage = lazy(() => import('./SharePage.tsx').then((m) => ({ default: m.SharePage })))

export function LazySharePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper flex items-center justify-center text-muted text-sm">加载中…</div>}>
      <SharePage />
    </Suspense>
  )
}
