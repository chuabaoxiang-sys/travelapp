import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tag } from 'lucide-react'
import type { Trip } from '../../types'
import { buildRetrospective, type TripRetrospective } from '../../domain/retrospective'
import { formatMoney, formatMoneyFixed } from '../../lib/money'
import { useAnimatedNumber } from '../../hooks/useAnimatedNumber'
import { useStaggerEntrance } from '../../hooks/useStaggerEntrance'
import { MoodCurveCard } from '../satisfaction/MoodCurveCard'
import { EstimatePill } from '../../components/EstimatePill'

// 旅程回顾的内容本体，不含任何"这是一个可关闭弹层"的外壳——这一段现在是
// 「概览」tab"回家后"形态的正文，跟别的tab内容一样常驻显示，不是弹出来再关掉的东西。
//
// 数字都来自 domain/retrospective.ts，这里只负责画。
//
// 2026-09-05：这个页面原来从头到尾都是静态直出，连Bar自带的CSS过渡都从来没被
// 触发过（宽度一开始就是最终值，没有"从0变化到目标值"这个变化过程可过渡）。
// 现在补上跟"出发前"/记账页大数字同一套动效：总花费数字滚入、分类占比条从0
// 滚到目标宽度、各张卡片错开时间淡入+上移——手法都是抄现成的，不是新发明

function Bar({ pct, color, entered, delayMs }: { pct: number; color: string; entered: boolean; delayMs: number }) {
  return (
    <div className="h-1.5 rounded-full bg-line overflow-hidden">
      {/* 下限 2% 是为了让金额很小的分类也留下一道可见的痕迹，而不是一条看不见的线 */}
      <div
        className="bar-fill h-full rounded-full"
        style={{
          width: entered ? `${Math.min(100, Math.max(2, pct))}%` : '0%',
          background: color,
          transitionDelay: `${delayMs}ms`,
        }}
      />
    </div>
  )
}

export function RetrospectiveContent({ trip, currentMemberId, refreshKey }: { trip: Trip; currentMemberId: string; refreshKey?: number }) {
  const { t } = useTranslation()
  const [data, setData] = useState<TripRetrospective | null>(null)

  useEffect(() => {
    const todayISO = new Date().toLocaleDateString('sv-SE')
    buildRetrospective(trip.id, todayISO, t, currentMemberId).then(setData)
  }, [trip.id, t, currentMemberId, refreshKey])

  // 这个tab是条件渲染，每次切回"概览"都是重新mount——挂载后下一帧触发一次
  // 进场动效就够，跟BeforeTrip那套双重RAF一致：等首帧真的画完（数字/占比条
  // 都还在"隐藏"状态），下一帧再翻转，CSS transition才有起点
  const { entered, enterClass, nextDelayMs, delayStyle } = useStaggerEntrance()

  // Hook不能在下面两个提前return之后才调用，所以放在这里、用data?.total ?? 0
  // 兜底——data还没查完时hook收到的是0，真实总额一到，会自然从0滚上去，
  // 跟useAnimatedNumber自己注释里说的"挂载瞬间的变化也一视同仁滚动"是同一件事
  const animatedTotal = useAnimatedNumber(data?.actual ?? 0)

  const currency = trip.homeCurrency === 'MYR' ? 'RM' : trip.homeCurrency
  const money = (n: number) => formatMoney(n, currency)
  const maxCat = data?.categories[0]?.total ?? 0

  if (!data) {
    return <div className="text-[13px] text-muted py-10 text-center">{t('retrospective.loading')}</div>
  }

  if (data.total === 0 && data.itemCount === 0) {
    return (
      <div className="text-[13px] text-muted py-10 text-center leading-relaxed">
        {t('retrospective.empty')}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 主卡：整趟总花费 */}
      <div className={`bg-surface-strong rounded-[20px] px-[18px] pt-[18px] pb-4 text-on-dark ${enterClass()}`} style={delayStyle(nextDelayMs())}>
        <div className="text-[11px] tracking-wider text-on-dark/55">
          {data.proxyTotal > 0 || data.cashbackTotal > 0 || data.refundTotal > 0 ? t('retrospective.heroLabelActual', { name: trip.name }) : trip.name}
        </div>
        <div className="flex items-baseline gap-2 mt-1.5">
          <div className="font-bold tracking-tight tabular text-[32px] leading-none">{money(animatedTotal)}</div>
          {data.estimateCount > 0 && <EstimatePill tone="dark" />}
        </div>
        <div className="mt-2.5 text-[11px] text-on-dark/50 leading-relaxed">
          {[
            data.dayCount > 0 ? t('retrospective.summaryDays', { count: data.dayCount }) : null,
            data.memberCount > 0 ? t('retrospective.summaryPeopleAvg', { count: data.memberCount, amount: money(data.perPerson) }) : null,
            data.placeCount > 0 ? t('retrospective.summaryPlaces', { count: data.placeCount }) : null,
          ].filter(Boolean).join(' · ')}
        </div>
        {/* 实际花费的算式一直摊开（2026-11-07）：跟黑卡点开后同一套算法；没有代购和返现就不出现 */}
        {(data.proxyTotal > 0 || data.cashbackTotal > 0 || data.refundTotal > 0) && (
          <div className="mt-3 border-t border-on-dark/12 pt-2.5 flex flex-col gap-[5px] text-[11.5px] tabular">
            <div className="flex justify-between text-on-dark/75">
              <span>{t('spendHero.formula.spent')}</span>
              <span>{money(data.total)}</span>
            </div>
            {data.proxyTotal > 0 && (
              <div className="flex justify-between gap-2 text-plan-on-dark">
                <span>− {t('spendHero.formula.proxy')}<span className="text-on-dark/50">{t('retrospective.proxyOwedHint')}</span></span>
                <span>{money(data.proxyTotal)}</span>
              </div>
            )}
            {data.cashbackTotal > 0 && (
              <div className="flex justify-between text-plan-on-dark">
                <span>− {t('spendHero.formula.cashback')}</span>
                <span>{money(data.cashbackTotal)}</span>
              </div>
            )}
            {data.refundTotal > 0 && (
              <div className="flex justify-between gap-2 text-plan-on-dark">
                <span>− {t('spendHero.formula.refund')}{data.refundPending > 0 && <span className="text-on-dark/50">{t('spendHero.formula.refundPending', { amount: money(data.refundPending) })}</span>}</span>
                <span>{money(data.refundTotal)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-on-dark/12 pt-1.5 mt-px font-bold text-on-dark text-[13px]">
              <span>= {t('spendHero.formula.actual')}</span>
              <span>{money(data.actual)}</span>
            </div>
          </div>
        )}
        {data.discount.count > 0 && (
          <div className="mt-2.5 text-[11px] text-plan-on-dark flex items-center gap-1.5">
            <Tag className="w-3 h-3 flex-shrink-0" strokeWidth={1.8} />
            {t(data.proxyTotal > 0 || data.cashbackTotal > 0 || data.refundTotal > 0 ? 'retrospective.discountLineAlso' : 'retrospective.discountLine', { amount: money(data.discount.total), count: data.discount.count })}
          </div>
        )}
      </div>

      {/* 还没结清——放在最前面，因为这是这个APP最不可替代的价值 */}
      {data.unsettledCount > 0 && (
        <div className={`rounded-2xl border border-spend/60 bg-spend/[.06] px-3.5 py-3 ${enterClass()}`} style={delayStyle(nextDelayMs())}>
          <div className="text-[13px] font-medium text-ink">
            {t('retrospective.unsettledCount', { count: data.unsettledCount })}
          </div>
          <div className="text-[11px] text-muted mt-0.5">
            {t('retrospective.unsettledDetail', { amount: money(data.unsettledTotal) })}
          </div>
        </div>
      )}

      <div className={enterClass()} style={delayStyle(nextDelayMs())}>
        <MoodCurveCard satisfaction={data.satisfaction} tripId={trip.id} currentMemberId={currentMemberId} />
      </div>

      {data.categories.length > 0 && (() => {
        const sectionDelay = nextDelayMs()
        return (
          <div className={enterClass()} style={delayStyle(sectionDelay)}>
            <div className="text-[11px] text-muted mb-2">{t('retrospective.whereItWent')}</div>
            <div className="flex flex-col gap-2.5">
              {data.categories.map((c, i) => (
                <div key={c.name}>
                  <div className="flex items-baseline text-[12px] mb-1">
                    <span>{c.name}</span>
                    {/* 2026-11-10 跟「这趟花在哪」卡片同一套：金额是主角（深色加粗）、固定两位小数上下对齐 */}
                    <span className="ml-auto tabular font-semibold">{formatMoneyFixed(c.total, currency)}</span>
                  </div>
                  <Bar
                    pct={maxCat > 0 ? (c.total / maxCat) * 100 : 0}
                    color={c.color}
                    entered={entered}
                    delayMs={sectionDelay + i * 60}
                  />
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {data.topDay && (
        <div className={`rounded-2xl border border-line bg-card px-3.5 py-2.5 flex items-center ${enterClass()}`} style={delayStyle(nextDelayMs())}>
          <span className="text-[12.5px]">{t('retrospective.priciestDay')}</span>
          <span className="ml-auto text-[12.5px] tabular">
            {data.topDay.date} · {money(data.topDay.total)}
          </span>
        </div>
      )}

      {data.people.length > 0 && (() => {
        const sectionDelay = nextDelayMs()
        return (
          <div className={enterClass()} style={delayStyle(sectionDelay)}>
            <div className="text-[11px] text-muted mb-2">{t('retrospective.byPerson')}</div>
            <div className="flex flex-col gap-1.5">
              {data.people.map((p) => (
                <div key={p.memberName} className="rounded-2xl border border-line bg-card px-3.5 py-2.5 flex items-center">
                  <span className="text-[12.5px]">{p.memberName}</span>
                  <span className="ml-auto text-[11px] text-muted tabular">
                    {t('retrospective.personLine', { paid: money(p.paid), owed: money(p.owed) })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
