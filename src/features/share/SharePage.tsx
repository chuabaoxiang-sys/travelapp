import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchSharedTrip } from './shareApi'
import { getTemplate } from './templates/registry'
import type { SharedTripData } from '../../types'

type LoadState = { status: 'loading' } | { status: 'notfound' } | { status: 'ready'; data: SharedTripData }

// 完全独立于登录/household逻辑的公开只读页面——不用任何App.tsx里的状态，
// 直接拿URL里的token去调用get_shared_trip，这个组件本身也不该假设访客已经登录过
export function SharePage() {
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
        加载中…
      </div>
    )
  }

  if (state.status === 'notfound') {
    return (
      <div className="min-h-screen bg-paper flex flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="font-serif-sc text-lg text-ink">这个链接打不开</div>
        <div className="text-[13px] text-muted max-w-[280px]">
          可能是分享已经关闭，或者链接不对。跟分享的人确认一下。
        </div>
      </div>
    )
  }

  const template = getTemplate(state.data.template)
  if (!template) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center text-muted text-sm px-6 text-center">
        这个行程还没选定分享模板，请分享的人重新设置一下。
      </div>
    )
  }

  const Component = template.component
  return <Component data={state.data} />
}
