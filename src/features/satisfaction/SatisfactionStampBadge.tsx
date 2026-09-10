import { useState, type CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { db } from '../../db/dexie'
import type { SatisfactionRating } from '../../types'
import { expenseSatisfactionsFor, setExpenseSatisfaction } from '../../domain/satisfaction'
import { CenteredModal } from '../../components/CenteredModal'
import { useStampSlam } from '../../hooks/useStampSlam'
import { RATING_COLOR, RATING_ROTATE, RATING_STAMP_KEY } from './stampVisuals'

// 盖章视觉——双环+旋转+衬线粗体短词，不是图标。双环用两层div实现
// （外层的border+内层absolute定位的一圈inset border），不是CSS
// ::before伪元素，React行内样式没法干净地写伪元素
export function Stamp({ rating, size, wordSize, word }: { rating: SatisfactionRating; size: number; wordSize: number; word: string }) {
  const color = RATING_COLOR[rating]
  return (
    <div
      className="relative rounded-full border-2 flex items-center justify-center flex-shrink-0"
      style={{
        width: size,
        height: size,
        borderColor: color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        transform: `rotate(${RATING_ROTATE[rating]})`,
      }}
    >
      <div className="absolute rounded-full pointer-events-none" style={{ inset: Math.max(2, size * 0.06), border: `1px solid ${color}`, opacity: 0.55 }} />
      <span className="relative font-serif-sc font-bold leading-none" style={{ fontSize: wordSize, color }}>
        {word}
      </span>
    </div>
  )
}

// 账目卡片上的"盖章"——不进翻卡片流程，谁都能随时点一下加自己的一份，
// 不同人标的各自独立，互不覆盖。整个印章堆叠区域只有一个点击目标：
// 打开"设置我自己的评分"弹层，不能通过点别人的章去改别人的
export function SatisfactionStampBadge({ expenseId, tripId, currentMemberId }: { expenseId: string; tripId: string; currentMemberId: string }) {
  const { t } = useTranslation()
  const [pickerOpen, setPickerOpen] = useState(false)
  const stamps = useLiveQuery(() => expenseSatisfactionsFor(expenseId), [expenseId]) ?? []
  const members = useLiveQuery(() => db.members.toArray()) ?? []
  const mine = stamps.find((s) => s.memberId === currentMemberId)

  // 2026-09-11：选完之后接上跟翻卡回顾同一套落章动效（useStampSlam），不再
  // 选完立刻写库关弹层。"清除我的标记"不算盖章这个动作，跳过动效直接提交，
  // 跟翻卡回顾的"跳过"是同一个道理
  const { animating, jolt, trigger } = useStampSlam<SatisfactionRating>((r) => {
    void setExpenseSatisfaction(tripId, expenseId, currentMemberId, r).then(() => setPickerOpen(false))
  })

  async function clearMine() {
    await setExpenseSatisfaction(tripId, expenseId, currentMemberId, null)
    setPickerOpen(false)
  }

  // 只有一枚章时给个大一点的尺寸（40px，跟单人标记的草图一致），2枚以上
  // 叠在一起才收紧到30px——不然好几枚章叠加起来会占掉太宽的一截
  const badgeCount = stamps.length + (mine ? 0 : 1)
  const size = badgeCount <= 1 ? 40 : 30
  const wordSize = badgeCount <= 1 ? 11 : 8
  const overlap = badgeCount <= 1 ? 0 : -9

  return (
    <>
      <div
        onClick={(e) => { e.stopPropagation(); setPickerOpen(true) }}
        className="flex items-center flex-shrink-0"
        title={t('satisfaction.stampZoneTitle')}
      >
        {stamps.map((s, i) => {
          const style: CSSProperties = { marginLeft: i > 0 ? overlap : 0 }
          return (
            <div key={s.id} title={members.find((m) => m.id === s.memberId)?.displayName} style={style}>
              <Stamp rating={s.rating} size={size} wordSize={wordSize} word={t(RATING_STAMP_KEY[s.rating])} />
            </div>
          )
        })}
        {!mine && (
          <div
            className="rounded-full border-[1.5px] border-dashed border-faint flex items-center justify-center flex-shrink-0 text-faint"
            style={{ width: size, height: size, marginLeft: stamps.length > 0 ? overlap : 0 }}
          >
            <Plus className={badgeCount <= 1 ? 'w-[18px] h-[18px]' : 'w-[13px] h-[13px]'} strokeWidth={2} />
          </div>
        )}
      </div>

      {pickerOpen && (
        // CenteredModal的遮罩层用position:fixed盖满全屏，但在真实DOM里它还是嵌套在
        // 这个账目行内部的——点遮罩关闭弹层这个点击事件会继续往上冒泡，穿透到账目行
        // 自己的onClick，误触发"打开这笔账目详情页"（真机复现过的真bug）。这层div
        // 拦住冒泡，不改CenteredModal本身——其他地方也在用它，不该为这一处特例
        // 改公共组件的行为
        <div onClick={(e) => e.stopPropagation()}>
          <CenteredModal onClose={() => setPickerOpen(false)}>
            <div className={`relative ${jolt ? 'stamp-jolt' : ''}`}>
              <div className="text-[14px] font-semibold text-center mb-3">{t('satisfaction.pickerTitle')}</div>
              <div className={`flex justify-center gap-3.5 mb-2 transition-opacity ${animating ? 'opacity-0 pointer-events-none' : ''}`}>
                {(['worth', 'neutral', 'regret'] as const).map((r) => {
                  // 还没标过时（mine不存在）三个选项都用满亮度，不无端压暗——
                  // 只有已经选过一个之后，才把没选中的两个压暗，用来衬托选中的那个
                  const active = !mine || mine.rating === r
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
              {mine && (
                <button
                  onClick={clearMine}
                  className={`block mx-auto mt-2 text-[12px] text-muted underline transition-opacity ${animating ? 'opacity-0 pointer-events-none' : ''}`}
                >
                  {t('satisfaction.clearMine')}
                </button>
              )}
              {/* 落章动效——位置对准上面的印章选择那一排（题目行下方约六成高度处），
                  跟翻卡回顾同一份.stamp-slam/.stamp-ripple，只是这里的"信息卡"
                  换成了整个弹层内容区 */}
              {animating && (
                <>
                  <div className="absolute left-1/2 top-[58%] stamp-slam">
                    <Stamp rating={animating} size={64} wordSize={15} word={t(RATING_STAMP_KEY[animating])} />
                  </div>
                  <div
                    className="absolute left-1/2 top-[58%] w-5 h-5 rounded-full stamp-ripple pointer-events-none"
                    style={{ backgroundColor: RATING_COLOR[animating], transform: 'translate(-50%, -50%)' }}
                  />
                </>
              )}
            </div>
          </CenteredModal>
        </div>
      )}
    </>
  )
}
