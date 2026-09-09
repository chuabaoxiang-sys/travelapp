import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchSharedTrip } from './shareApi'
import { getTemplate } from './templates/registry'
import type { SharedTripData } from '../../types'

type LoadState = { status: 'loading' } | { status: 'notfound' } | { status: 'ready'; data: SharedTripData }

// 完全独立于登录/household逻辑的公开只读页面——不用任何App.tsx里的状态，
// 直接拿URL里的token去调用get_shared_trip，这个组件本身也不该假设访客已经登录过。
// 语言判断走LazySharePage外面套的LocaleProvider（跟App.tsx用的是同一个组件，
// memberId传null=只做设备语言探测）——访问这个链接的往往是真正的外部访客
// （"没装APP的亲戚朋友"），不能假设他们看得懂中文
export function SharePage() {
  const { t } = useTranslation()
  const { token } = useParams<{ token: string }>()
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
      <div className="min-h-screen bg-paper flex items-center justify-center text-muted text-sm">
        {t('sharePage.loading')}
      </div>
    )
  }

  if (state.status === 'notfound') {
    return (
      <div className="min-h-screen bg-paper flex flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="font-serif-sc text-lg text-ink">{t('sharePage.linkBrokenTitle')}</div>
        <div className="text-[13px] text-muted max-w-[280px]">
          {t('sharePage.linkBrokenDesc')}
        </div>
      </div>
    )
  }

  const template = getTemplate(state.data.template)
  if (!template) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center text-muted text-sm px-6 text-center">
        {t('sharePage.noTemplate')}
      </div>
    )
  }

  const Component = template.component
  return <Component data={state.data} />
}
