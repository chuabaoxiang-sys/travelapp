import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { X, SkipForward } from 'lucide-react'
import type { Trip, SatisfactionRating } from '../../types'
import { pendingDaysForMember, setDaySatisfaction } from '../../domain/satisfaction'
import { Stamp } from './SatisfactionStampBadge'
import { RATING_COLOR, RATING_STAMP_KEY } from './stampVisuals'

function formatShortDate(iso: string) {
  const parts = iso.split('-')
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : iso
}

// 选完评分之后到真正写进数据库之间，先播一段"盖章"落章动效——时间轴跟
// 出图确认过的原型一致：260ms时卡片震一下，1050ms时落章动作播完才提交，
// 提交完立刻清掉动效状态，露出live query带出来的下一天
const JOLT_START_MS = 260
const JOLT_DURATION_MS = 500
const COMMIT_DELAY_MS = 1050

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
  // 选了值/一般/后悔之后不立刻写库——先播落章动效，播完了才真正提交。
  // 用ref记住动效开始那一刻是给哪一天评分的，不依赖动效播放期间top有没有
  // 变化（正常不会变，因为按钮在动效期间是禁用的，但commit的时候用当时
  // 捕获的dayId比重新读一遍闭包里的top更可靠）
  const [animatingRating, setAnimatingRating] = useState<SatisfactionRating | null>(null)
  const [jolt, setJolt] = useState(false)
  const animatingDayIdRef = useRef<string | null>(null)

  // 跳过不用等，直接提交——跳过本来就不代表"盖了一个章"，没有落章这个动作
  async function skip() {
    if (!top) return
    await setDaySatisfaction(trip.id, top.id, currentMemberId, null)
  }

  function selectRating(r: SatisfactionRating) {
    if (!top || animatingRating) return
    animatingDayIdRef.current = top.id
    setAnimatingRating(r)
  }

  useEffect(() => {
    if (!animatingRating) return
    const dayId = animatingDayIdRef.current
    const joltOnTimer = setTimeout(() => setJolt(true), JOLT_START_MS)
    const joltOffTimer = setTimeout(() => setJolt(false), JOLT_START_MS + JOLT_DURATION_MS)
    const commitTimer = setTimeout(() => {
      if (dayId) void setDaySatisfaction(trip.id, dayId, currentMemberId, animatingRating)
      setAnimatingRating(null)
    }, COMMIT_DELAY_MS)
    return () => {
      clearTimeout(joltOnTimer)
      clearTimeout(joltOffTimer)
      clearTimeout(commitTimer)
    }
  }, [animatingRating, trip.id, currentMemberId])

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
                {top.title ? ` · ${top.title}` : ''}
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
