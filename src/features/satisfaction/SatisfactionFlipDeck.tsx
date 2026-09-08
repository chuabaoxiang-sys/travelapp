import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { X, Smile, Meh, Frown, SkipForward } from 'lucide-react'
import type { Trip, SatisfactionRating } from '../../types'
import { pendingDaysForMember, setDaySatisfaction } from '../../domain/satisfaction'

function formatShortDate(iso: string) {
  const parts = iso.split('-')
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : iso
}

const RATING_COLOR: Record<SatisfactionRating, string> = {
  worth: 'var(--color-positive)',
  neutral: 'var(--color-muted)',
  regret: 'var(--color-negative)',
}
const RATING_ICON: Record<SatisfactionRating, typeof Smile> = { worth: Smile, neutral: Meh, regret: Frown }

// 翻卡片仪式——只翻"天"，不翻账目（账目笔数可能有几百笔，翻不完会把仪式感
// 变成家务事，见本次会话讨论）。只操作"当前身份"自己的队列，不是在一个界面
// 里切换成别的家庭成员帮他们翻——每个人翻自己的，要用哪个身份就在设置里切换
// 身份、自己打开这个入口，这里没有额外的"选身份"UI。
export function SatisfactionFlipDeck({ trip, currentMemberId, onClose }: { trip: Trip; currentMemberId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const todayISO = new Date().toLocaleDateString('sv-SE')
  const pending = useLiveQuery(
    () => pendingDaysForMember(trip.id, currentMemberId, todayISO),
    [trip.id, currentMemberId, todayISO],
  ) ?? []
  const top = pending[0]

  async function pick(rating: SatisfactionRating | null) {
    if (!top) return
    await setDaySatisfaction(trip.id, top.id, currentMemberId, rating)
  }

  return (
    <div className="absolute inset-0 z-30 bg-paper flex flex-col">
      <div className="flex items-center justify-between px-5 pt-4 pb-2 flex-shrink-0 border-b border-line">
        <span className="font-serif-sc text-[15px] font-semibold">{t('satisfaction.deckTitle')}</span>
        <button onClick={onClose} className="text-muted" title={t('satisfaction.close')}>
          <X className="w-[15px] h-[15px]" strokeWidth={1.8} />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
        {top ? (
          <>
            <div className="w-full max-w-[260px] min-h-[130px] bg-card border border-line rounded-2xl p-5 flex flex-col items-center justify-center text-center">
              <div className="text-[11px] text-muted mb-1.5">{t('satisfaction.askDay')}</div>
              <div className="font-serif-sc text-[16px]">
                {formatShortDate(top.date)}
                {top.title ? ` · ${top.title}` : ''}
              </div>
            </div>

            <div className="flex gap-3">
              {(['worth', 'neutral', 'regret'] as const).map((r) => {
                const Icon = RATING_ICON[r]
                return (
                  <button
                    key={r}
                    onClick={() => pick(r)}
                    title={t(`satisfaction.rating${r.charAt(0).toUpperCase()}${r.slice(1)}`)}
                    className="w-[46px] h-[46px] rounded-full border border-line bg-card flex items-center justify-center"
                  >
                    <Icon className="w-5 h-5" strokeWidth={2} style={{ color: RATING_COLOR[r] }} />
                  </button>
                )
              })}
              <button
                onClick={() => pick(null)}
                title={t('satisfaction.skip')}
                className="w-[46px] h-[46px] rounded-full border border-line bg-card flex items-center justify-center"
              >
                <SkipForward className="w-[18px] h-[18px] text-muted" strokeWidth={2} />
              </button>
            </div>

            {pending.length > 1 && (
              <div className="text-[11.5px] text-faint">{t('satisfaction.remaining', { count: pending.length - 1 })}</div>
            )}
          </>
        ) : (
          <div className="text-center text-[13px] text-muted leading-relaxed max-w-[260px]">
            {t('satisfaction.allDone')}
          </div>
        )}
      </div>
    </div>
  )
}
