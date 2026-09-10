import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { X, SkipForward } from 'lucide-react'
import type { Trip, SatisfactionRating } from '../../types'
import { db } from '../../db/dexie'
import { pendingDaysForMember, setDaySatisfaction } from '../../domain/satisfaction'
import { resolveDayTitle } from '../../domain/itinerary'
import { Stamp } from './SatisfactionStampBadge'
import { RATING_COLOR, RATING_STAMP_KEY } from './stampVisuals'
import { useStampSlam } from '../../hooks/useStampSlam'

function formatShortDate(iso: string) {
  const parts = iso.split('-')
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : iso
}

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
  // 标题跟行程页头部走同一个resolveDayTitle——没手动编辑过就用行程记录的地点
  // 自动拼一个，两处不会显示不一致的结果（见2026-09-10讨论）
  const topItems = useLiveQuery(async () => {
    if (!top) return []
    return db.itineraryItems.where('dayId').equals(top.id).toArray()
  }, [top?.id]) ?? []
  const topTitle = top ? resolveDayTitle(top, topItems) : null
  // 选了值/一般/后悔之后不立刻写库——先播落章动效（useStampSlam），播完了才
  // 真正提交。commit闭包里的top是effect真正跑起来那一刻捕获的那个值，不受
  // 动效播放期间后续渲染影响（跟原来用ref记day id是同一个考虑）
  const { animating: animatingRating, jolt, trigger } = useStampSlam<SatisfactionRating>((r) => {
    if (top) void setDaySatisfaction(trip.id, top.id, currentMemberId, r)
  })

  // 跳过不用等，直接提交——跳过本来就不代表"盖了一个章"，没有落章这个动作
  async function skip() {
    if (!top) return
    await setDaySatisfaction(trip.id, top.id, currentMemberId, null)
  }

  function selectRating(r: SatisfactionRating) {
    if (!top) return
    trigger(r)
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
            <div
              className={`relative w-full max-w-[260px] min-h-[130px] bg-card border border-line rounded-2xl p-5 flex flex-col items-center justify-center text-center overflow-visible ${jolt ? 'stamp-jolt' : ''}`}
            >
              <div className="text-[11px] text-muted mb-1.5">{t('satisfaction.askDay')}</div>
              <div className="font-serif-sc text-[16px]">
                {formatShortDate(top.date)}
                {topTitle ? ` · ${topTitle}` : ''}
              </div>
              {/* 落章动效——只在选完评分、动效还没播完的这段时间存在。旋转角度
                  由Stamp组件自己的inline transform负责，这层absolute容器只管
                  位置和stamp-slam的缩放/位移，两层transform天然叠加 */}
              {animatingRating && (
                // opacity不写inline style——.stamp-slam的0%关键帧本来就是opacity:0，
                // prefers-reduced-motion那边又把.stamp-slam覆盖成opacity:1不播动画，
                // inline style的优先级会盖过这层媒体查询覆盖，两种情况都得靠class自己管
                <div className="absolute left-1/2 top-[38%] stamp-slam">
                  <Stamp rating={animatingRating} size={100} wordSize={22} word={t(RATING_STAMP_KEY[animatingRating])} />
                </div>
              )}
              {animatingRating && (
                <div
                  className="absolute left-1/2 top-[38%] w-5 h-5 rounded-full stamp-ripple pointer-events-none"
                  style={{ backgroundColor: RATING_COLOR[animatingRating], transform: 'translate(-50%, -50%)' }}
                />
              )}
            </div>

            <div className={`flex gap-3 transition-opacity ${animatingRating ? 'opacity-0 pointer-events-none' : ''}`}>
              {(['worth', 'neutral', 'regret'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => selectRating(r)}
                  title={t(`satisfaction.rating${r.charAt(0).toUpperCase()}${r.slice(1)}`)}
                >
                  <Stamp rating={r} size={46} wordSize={11} word={t(RATING_STAMP_KEY[r])} />
                </button>
              ))}
              <button
                onClick={skip}
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
