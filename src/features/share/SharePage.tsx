import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import { fetchSharedTrip } from './shareApi'
import { getTemplate } from './templates/registry'
import type { SharedTripData } from '../../types'

type LoadState = { status: 'loading' } | { status: 'notfound' } | { status: 'ready'; data: SharedTripData }

// 装成主屏幕独立APP之后，iOS连Safari自带的"边缘滑动返回"手势都没有了——
// 这个手势是Safari浏览器外壳提供的，standalone模式下整层外壳都不在，页面
// 自己不给条退路，用户就真的卡死在预览页出不去。只在"从APP内部点预览"这个
// 场景出现（分享设置那个预览链接自己加的?preview=1标记），朋友收到的正式
// 分享链接不带这个参数，不会看到——他们没有"返回APP"这回事。样式故意不跟
// 任何一套模板的配色走，读起来像浮在内容上面的系统控件，不是模板本身的一部分
function BackToAppChip() {
  const { t } = useTranslation()
  return (
    <button
      onClick={() => window.history.back()}
      className="fixed z-30 flex items-center gap-0.5 rounded-full text-white text-[12px] font-medium pl-2 pr-3.5 py-1.5 shadow-lg"
      style={{
        top: 'calc(env(safe-area-inset-top, 0px) + 14px)',
        left: 14,
        background: 'rgba(20,18,14,0.62)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      <ChevronLeft className="w-[15px] h-[15px]" strokeWidth={2.4} />
      {t('sharePage.backToApp')}
    </button>
  )
}

// 完全独立于登录/household逻辑的公开只读页面——不用任何App.tsx里的状态，
// 直接拿URL里的token去调用get_shared_trip，这个组件本身也不该假设访客已经登录过。
// 语言判断走LazySharePage外面套的LocaleProvider（跟App.tsx用的是同一个组件，
// memberId传null=只做设备语言探测）——访问这个链接的往往是真正的外部访客
// （"没装APP的亲戚朋友"），不能假设他们看得懂中文
export function SharePage() {
  const { t } = useTranslation()
  const { token } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()
  const showBackChip = searchParams.get('preview') === '1'
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    if (!token) {
      setState({ status: 'notfound' })
      return
    }
    fetchSharedTrip(token).then((data) => {
      if (cancelled) return
      setState(data ? { status: 'ready', data } : { status: 'notfound' })
    })
    return () => {
      cancelled = true
    }
  }, [token])

  if (state.status === 'loading') {
    return (
      <>
        {showBackChip && <BackToAppChip />}
        <div className="min-h-screen bg-paper flex items-center justify-center text-muted text-sm">
          {t('sharePage.loading')}
        </div>
      </>
    )
  }

  if (state.status === 'notfound') {
    return (
      <>
        {showBackChip && <BackToAppChip />}
        <div className="min-h-screen bg-paper flex flex-col items-center justify-center gap-2 px-6 text-center">
          <div className="font-serif-sc text-lg text-ink">{t('sharePage.linkBrokenTitle')}</div>
          <div className="text-[13px] text-muted max-w-[280px]">
            {t('sharePage.linkBrokenDesc')}
          </div>
        </div>
      </>
    )
  }

  const template = getTemplate(state.data.template)
  if (!template) {
    return (
      <>
        {showBackChip && <BackToAppChip />}
        <div className="min-h-screen bg-paper flex items-center justify-center text-muted text-sm px-6 text-center">
          {t('sharePage.noTemplate')}
        </div>
      </>
    )
  }

  const Component = template.component
  return (
    <>
      {showBackChip && <BackToAppChip />}
      <Component data={state.data} />
    </>
  )
}
