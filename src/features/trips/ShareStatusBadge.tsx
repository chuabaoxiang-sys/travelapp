import { useTranslation } from 'react-i18next'
import { Link2 } from 'lucide-react'
import { effectiveShareScope } from '../../domain/share'
import type { Trip } from '../../types'

// 顶部常驻的分享状态入口——之前"分享设置"只藏在"···"更多菜单里，容易忘记
// 自己开着分享；这个徽章无论开没开都常驻在identity切换旁边，开着的时候变成
// 显眼的"分享中"标签，一直提醒你，点一下也能直接管理，不用先钻进更多菜单
export function ShareStatusBadge({ trip, onOpen }: { trip: Trip; onOpen: () => void }) {
  const { t } = useTranslation()
  const sharing = effectiveShareScope(trip) !== 'none'

  if (sharing) {
    return (
      <button
        onClick={onOpen}
        className="inline-flex items-center gap-1 rounded-full bg-plan/[0.14] border border-plan/35 text-plan px-2.5 py-0.5 text-[10.5px] font-semibold"
        title={t('tripHeader.sharingTitle')}
      >
        <Link2 className="w-3 h-3" strokeWidth={2.2} />
        {t('tripHeader.sharing')}
      </button>
    )
  }

  return (
    <button onClick={onOpen} className="text-muted/70 flex items-center justify-center" title={t('tripHeader.shareSettingsTitle')}>
      <Link2 className="w-3.5 h-3.5" strokeWidth={2} />
    </button>
  )
}
