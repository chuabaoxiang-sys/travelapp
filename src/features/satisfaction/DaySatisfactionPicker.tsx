import { useTranslation } from 'react-i18next'
import type { SatisfactionRating } from '../../types'
import { setDaySatisfaction } from '../../domain/satisfaction'
import { CenteredModal } from '../../components/CenteredModal'
import { useStampSlam } from '../../hooks/useStampSlam'
import { Stamp } from './SatisfactionStampBadge'
import { RATING_COLOR, RATING_STAMP_KEY } from './stampVisuals'

// 点心情曲线上已经打过分的一天——跟账目页盖章徽标（SatisfactionStampBadge）
// 同一套"随时可以改，不进翻卡队列"的交互，只是挂在天上。MoodCurveCard自己
// 控制什么时候允许点开（只有"我的"视图、已经过去的天），这里只管选完写库。
// 2026-09-11：选完接上跟翻卡回顾/账目盖章同一套落章动效（useStampSlam）。
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

  const { animating, jolt, trigger } = useStampSlam<SatisfactionRating>((r) => {
    void setDaySatisfaction(tripId, dayId, currentMemberId, r).then(onClose)
  })

  // 清除不算盖章这个动作，没有落章动效，直接提交——跟翻卡回顾的"跳过"、
  // 账目盖章的"清除我的标记"是同一个道理
  async function clear() {
    await setDaySatisfaction(tripId, dayId, currentMemberId, null)
    onClose()
  }

  return (
    <CenteredModal onClose={onClose}>
      <div className={`relative ${jolt ? 'stamp-jolt' : ''}`}>
        <div className="text-[14px] font-semibold text-center mb-0.5">{t('satisfaction.askDay')}</div>
        <div className="text-[11px] text-muted text-center mb-3">
          {date}
          {title ? ` · ${title}` : ''}
        </div>
        <div className={`flex justify-center gap-3.5 mb-2 transition-opacity ${animating ? 'opacity-0 pointer-events-none' : ''}`}>
          {(['worth', 'neutral', 'regret'] as const).map((r) => {
            const active = !currentRating || currentRating === r
            return (
              <button
                key={r}
                onClick={() => trigger(r)}
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
          <button
            onClick={clear}
            className={`block mx-auto mt-2 text-[12px] text-muted underline transition-opacity ${animating ? 'opacity-0 pointer-events-none' : ''}`}
          >
            {t('satisfaction.clearMine')}
          </button>
        )}
        {animating && (
          <>
            <div className="absolute left-1/2 top-[68%] stamp-slam">
              <Stamp rating={animating} size={64} wordSize={15} word={t(RATING_STAMP_KEY[animating])} />
            </div>
            <div
              className="absolute left-1/2 top-[68%] w-5 h-5 rounded-full stamp-ripple pointer-events-none"
              style={{ backgroundColor: RATING_COLOR[animating], transform: 'translate(-50%, -50%)' }}
            />
          </>
        )}
      </div>
    </CenteredModal>
  )
}
