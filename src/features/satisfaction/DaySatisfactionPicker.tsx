import { useTranslation } from 'react-i18next'
import type { SatisfactionRating } from '../../types'
import { setDaySatisfaction } from '../../domain/satisfaction'
import { CenteredModal } from '../../components/CenteredModal'
import { Stamp } from './SatisfactionStampBadge'
import { RATING_STAMP_KEY } from './stampVisuals'

// 点心情曲线上已经打过分的一天——跟账目页盖章徽标（SatisfactionStampBadge）
// 同一套"随时可以改，不进翻卡队列"的交互，只是挂在天上。MoodCurveCard自己
// 控制什么时候允许点开（只有"我的"视图、已经过去的天），这里只管选完写库。
export function DaySatisfactionPicker({
  tripId,
  dayId,
  date,
  title,
  currentMemberId,
  currentRating,
  onClose,
}: {
  tripId: string
  dayId: string
  date: string
  title: string | null
  currentMemberId: string
  currentRating: SatisfactionRating | null
  onClose: () => void
}) {
  const { t } = useTranslation()

  async function pick(rating: SatisfactionRating | null) {
    await setDaySatisfaction(tripId, dayId, currentMemberId, rating)
    onClose()
  }

  return (
    <CenteredModal onClose={onClose}>
      <div className="text-[14px] font-semibold text-center mb-0.5">{t('satisfaction.askDay')}</div>
      <div className="text-[11px] text-muted text-center mb-3">
        {date}
        {title ? ` · ${title}` : ''}
      </div>
      <div className="flex justify-center gap-3.5 mb-2">
        {(['worth', 'neutral', 'regret'] as const).map((r) => {
          const active = !currentRating || currentRating === r
          return (
            <button
              key={r}
              onClick={() => pick(r)}
              className="flex flex-col items-center gap-1.5 transition-opacity"
              style={{ opacity: active ? 1 : 0.45 }}
            >
              <Stamp rating={r} size={52} wordSize={13} word={t(RATING_STAMP_KEY[r])} />
              <span className={`text-[10.5px] ${active ? 'text-ink font-semibold' : 'text-muted'}`}>
                {t(`satisfaction.rating${r.charAt(0).toUpperCase()}${r.slice(1)}`)}
              </span>
            </button>
          )
        })}
      </div>
      {currentRating && (
        <button onClick={() => pick(null)} className="block mx-auto mt-2 text-[12px] text-muted underline">
          {t('satisfaction.clearMine')}
        </button>
      )}
    </CenteredModal>
  )
}
