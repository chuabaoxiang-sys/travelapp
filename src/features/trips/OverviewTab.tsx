import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { ListChecks, MapPin, ChevronRight } from 'lucide-react'
import { db } from '../../db/dexie'
import type { Trip } from '../../types'
import { resolveTripPhase, daysUntil, currentDayIndex } from '../../domain/tripPhase'
import { resolveAllowance } from '../../domain/dailyAllowance'
import { spentOnDate } from '../../domain/dayAllocations'
import { getOverallBudget } from '../../domain/budgets'
import { listWishlistPlaces, usageByWishlistEntry } from '../../domain/wishlist'
import { daysInclusive, formatTimeHM } from '../../lib/dates'
import { dateChipParts } from '../../lib/dateChip'
import type { ResolvedLocale } from '../../lib/locale'
import { relativeTime } from '../../lib/relativeTime'
import { Avatar } from '../../components/Avatar'
import { SpendHero } from '../expenses/SpendHero'
import { RetrospectiveContent } from './RetrospectiveContent'
import { useActivityEntries, activityKindLabel, ACTIVITY_KIND_CLASS } from '../activity/useActivityEntries'
import { WishlistScreen } from '../wishlist/WishlistScreen'
import { ActivityFeed } from '../activity/ActivityFeed'

// 「概览」——四个功能tab时代根本不存在的东西。这个APP一直假设用户"想用某个功能"，
// 但真实情况是用户处在某个时刻：出发前、旅途中、回家后，而这三个时刻需要看的东西
// 几乎不重叠。这个tab取代原来的"行程"作为默认首页，随阶段换内容，标签本身不变——
// 标签跟着阶段变会让人找不到东西，温度放在内容里就够了。
//
// 三种形态用的数据全部来自已有的地方，这里没有新算什么：
//   出发前 → bookingStatus/心愿单/行程安排完整度
//   旅途中 → 复用第一步做的 resolveAllowance + 第二步顺带抽出来的 useActivityEntries
//   回家后 → 直接渲染 RetrospectiveContent（第二步"旅程回顾"的内容本体）

export function OverviewTab({ trip, currentMemberId }: { trip: Trip; currentMemberId: string }) {
  const todayISO = new Date().toLocaleDateString('sv-SE')
  const phase = resolveTripPhase(todayISO, trip.startDate, trip.endDate)

  if (phase === 'after') {
    return (
      <div className="px-5 pt-3 pb-safe-fab-clearance overflow-y-auto no-scrollbar h-full">
        <RetrospectiveContent trip={trip} />
      </div>
    )
  }

  if (phase === 'during') {
    return <DuringTrip trip={trip} todayISO={todayISO} />
  }

  return <BeforeTrip trip={trip} todayISO={todayISO} currentMemberId={currentMemberId} />
}

function Card({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'accent' | 'warn' }) {
  const border = tone === 'accent' ? 'border-plan/40 bg-plan/[.05]' : tone === 'warn' ? 'border-spend/50 bg-spend/[.05]' : 'border-line bg-card'
  return <div className={`rounded-2xl border px-3.5 py-2.5 ${border}`}>{children}</div>
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] text-muted mb-2 mt-1">{children}</div>
}

function BeforeTrip({ trip, todayISO, currentMemberId }: { trip: Trip; todayISO: string; currentMemberId: string }) {
  const { t, i18n } = useTranslation()
  const locale: ResolvedLocale = i18n.language === 'en' ? 'en' : 'zh'
  const [wishlistOpen, setWishlistOpen] = useState(false)

  const items = useLiveQuery(() => db.itineraryItems.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const itineraryDays = useLiveQuery(() => db.itineraryDays.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const wishlist = useLiveQuery(() => listWishlistPlaces()) ?? []
  const wishlistUsage = useLiveQuery(() => usageByWishlistEntry()) ?? new Map()

  const daysLeft = trip.startDate ? daysUntil(todayISO, trip.startDate) : null
  const sortedDays = [...itineraryDays].sort((a, b) => a.date.localeCompare(b.date))
  const dayIndexOf = (dayId: string) => sortedDays.findIndex((d) => d.id === dayId) + 1
  // "还没订"这几张卡片给的是完整日期而不是"第N天"——第几天要在脑子里对着
  // 出发日期换算才知道具体是哪天，日期直接就是使用者平时想事情用的那个格式。
  // 用完整日期（不是切过的"MM-DD"）是因为日期方块要分月/日两行显示，
  // 英文月份缩写还得用Date对象自己算，不能像以前那样直接切字符串
  const fullDateOfDay = (dayId: string) => sortedDays.find((d) => d.id === dayId)?.date
  // 按第几天排序，同一天再按时间排——不然"还没订"这个列表跟着items查询原始
  // 顺序走（大致是创建顺序），第13天排在第3天前面，看着很乱，跟"离出发还有
  // 几天"这种时间线视角完全对不上
  const needsBooking = items
    .filter((it) => it.bookingStatus === 'needed')
    .sort((a, b) => dayIndexOf(a.dayId) - dayIndexOf(b.dayId) || (a.time ?? '').localeCompare(b.time ?? ''))

  const totalDays = trip.startDate && trip.endDate ? daysInclusive(trip.startDate, trip.endDate) : 0
  const daysWithItems = new Set(items.map((it) => it.dayId)).size
  const itineraryDone = totalDays > 0 && daysWithItems >= totalDays

  const notYetUsed = wishlist.filter((w) => !wishlistUsage.has(w.id)).length

  // 这个tab是条件渲染（TripShell里`tab === 'overview' && <OverviewTab/>`），
  // 不是CSS隐藏，每次切回"概览"都是重新mount——挂载后下一帧触发一次进场
  // 动效就够，不用像列表内容变化那样费心判断"要不要重播"。双重RAF跟预算页
  // 那套一致：等首帧真的画完（倒计时数字/还没订/进度条都还在"隐藏"状态），
  // 下一帧再翻转，CSS transition/文字滚动才有起点
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    let raf1 = 0
    let raf2 = 0
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntered(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [])

  const daysNumRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = daysNumRef.current
    if (!el || daysLeft == null || daysLeft <= 0) return
    if (!entered) {
      el.textContent = t('overview.daysLeft', { count: 0 })
      return
    }
    const start = performance.now()
    const duration = 900
    let raf = 0
    function tick(now: number) {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - progress) ** 3
      el!.textContent = t('overview.daysLeft', { count: Math.round(daysLeft! * eased) })
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // t进依赖数组——切换语言时"3 天"要变成"3 days"，光靠entered/daysLeft
    // 不会重新跑这个effect，因为这两个值切语言时并没有变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entered, daysLeft, t])

  const itinNumRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = itinNumRef.current
    if (!el || !totalDays) return
    if (!entered) {
      el.textContent = t('overview.itineraryPlanned', { withItems: 0, total: totalDays })
      return
    }
    const start = performance.now()
    const duration = 700
    let raf = 0
    function tick(now: number) {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - progress) ** 3
      el!.textContent = t('overview.itineraryPlanned', { withItems: Math.round(daysWithItems * eased), total: totalDays })
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // t同理进依赖数组，见上面daysNumRef那个effect的注释
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entered, totalDays, daysWithItems, t])

  return (
    <div className="px-5 pt-3 pb-safe-fab-clearance overflow-y-auto no-scrollbar h-full flex flex-col gap-3.5">
      <div className="bg-surface-strong rounded-[20px] px-[18px] pt-[18px] pb-4 text-on-dark">
        <div className="text-[11px] tracking-wider text-on-dark/55">{t('overview.untilDeparture')}</div>
        <div className="font-bold tracking-tight tabular text-[30px] leading-none mt-1.5">
          {daysLeft == null ? t('overview.noDateSet') : daysLeft <= 0 ? t('overview.today') : <span ref={daysNumRef} />}
        </div>
        <div className="mt-2 text-[11px] text-on-dark/50">
          {trip.startDate ? t('overview.departsOn', { trip: trip.name, date: trip.startDate }) : trip.name}
        </div>
      </div>

      {needsBooking.length > 0 && (
        <div>
          <SectionLabel>
            {t('overview.notReservedCount', { count: needsBooking.length })}
          </SectionLabel>
          <div className="flex flex-col gap-2">
            {needsBooking.slice(0, 4).map((it, i) => {
              const fullDate = fullDateOfDay(it.dayId)
              const chip = fullDate ? dateChipParts(fullDate, locale) : null
              return (
                <div
                  key={it.id}
                  className={`flex items-center gap-2.5 rounded-2xl border border-spend/50 bg-spend/[.05] px-3 py-2.5 transition-[opacity,transform] duration-300 ease-out ${entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}`}
                  style={{ transitionDelay: `${i * 90}ms` }}
                >
                  {chip ? (
                    <div className="w-9 flex-shrink-0 rounded-[9px] text-center py-1 border border-spend/40 bg-spend/10">
                      <div className="text-[8px] tracking-wide text-spend-text uppercase leading-tight">{chip.month}</div>
                      <div className="text-[15px] font-extrabold text-spend-text tabular leading-tight">{chip.day}</div>
                    </div>
                  ) : (
                    <div className="text-[10.5px] text-muted flex-shrink-0">{t('overview.dateUnknown')}</div>
                  )}
                  <div className="flex-1 min-w-0 text-[13px] font-medium truncate">{it.title}</div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-spend/15 text-spend flex-shrink-0">{t('itemForm.bookingNeeded')}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {(totalDays > 0 || notYetUsed > 0) && (
        <div>
          <SectionLabel>{t('overview.gettingReady')}</SectionLabel>
          <div className="rounded-2xl border border-line bg-card px-3.5">
            {totalDays > 0 && (
              <div className="py-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-[26px] h-[26px] rounded-[9px] flex items-center justify-center flex-shrink-0"
                    style={
                      itineraryDone
                        ? { background: 'color-mix(in srgb, var(--color-positive) 15%, var(--color-card))', color: 'var(--color-positive)' }
                        : { background: 'color-mix(in srgb, var(--color-plan) 13%, var(--color-card))', color: 'var(--color-plan)' }
                    }
                  >
                    <ListChecks className="w-3.5 h-3.5" strokeWidth={2.2} />
                  </span>
                  <span className="flex-1 text-[13px] font-medium">{t('nav.itinerary')}</span>
                  <span className="text-[12px] tabular text-muted font-semibold">
                    <span ref={itinNumRef} />
                  </span>
                </div>
                <div className="h-[5px] rounded-full bg-line overflow-hidden mt-2 ml-[35px]">
                  <div
                    className="bar-fill h-full rounded-full"
                    style={{
                      width: entered ? `${(daysWithItems / totalDays) * 100}%` : '0%',
                      background: itineraryDone ? 'var(--color-positive)' : 'var(--color-plan)',
                    }}
                  />
                </div>
              </div>
            )}
            {notYetUsed > 0 && (
              <button
                onClick={() => setWishlistOpen(true)}
                className={`w-full flex items-center gap-2.5 py-3 text-left ${totalDays > 0 ? 'border-t border-dashed border-line' : ''}`}
              >
                <span
                  className="w-[26px] h-[26px] rounded-[9px] flex items-center justify-center flex-shrink-0"
                  style={{ background: 'color-mix(in srgb, var(--color-plan) 13%, var(--color-card))', color: 'var(--color-plan)' }}
                >
                  <MapPin className="w-3.5 h-3.5" strokeWidth={2.2} />
                </span>
                <span className="flex-1 text-[13px] font-medium text-plan">{t('overview.placesNotAdded', { count: notYetUsed })}</span>
                <ChevronRight className="w-4 h-4 text-muted flex-shrink-0" strokeWidth={1.8} />
              </button>
            )}
          </div>
        </div>
      )}

      {!needsBooking.length && !totalDays && !notYetUsed && (
        <div className="text-[13px] text-muted text-center py-10">
          {t('overview.emptyBeforeTrip')}
        </div>
      )}

      {wishlistOpen && <WishlistScreen currentMemberId={currentMemberId} onClose={() => setWishlistOpen(false)} />}
    </div>
  )
}

function DuringTrip({ trip, todayISO }: { trip: Trip; todayISO: string }) {
  const { t } = useTranslation()
  const [activityOpen, setActivityOpen] = useState(false)

  const expenses = useLiveQuery(() => db.expenses.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const dayAllocations = useLiveQuery(() => db.expenseDayAllocations.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const overallBudget = useLiveQuery(() => getOverallBudget(trip.id), [trip.id])
  const total = expenses.reduce((a, e) => a + e.homeAmount, 0)
  const todaySpent = spentOnDate(expenses, dayAllocations, todayISO)
  const allowance = resolveAllowance({
    todayISO, startDate: trip.startDate, endDate: trip.endDate, budget: overallBudget?.amount ?? null, total, todaySpent,
  })
  const currencyLabel = trip.homeCurrency === 'MYR' ? 'RM' : trip.homeCurrency

  const itineraryDays = useLiveQuery(() => db.itineraryDays.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const todayDay = itineraryDays.find((d) => d.date === todayISO)
  const todayItems = useLiveQuery(async () => {
    if (!todayDay) return []
    return db.itineraryItems.where('dayId').equals(todayDay.id).toArray()
  }, [todayDay?.id]) ?? []
  const nowHM = new Date().toTimeString().slice(0, 5)
  const upcoming = [...todayItems]
    .filter((it) => !it.time || it.time >= nowHM)
    .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))

  const { entries, members } = useActivityEntries(trip)
  const now = Date.now()
  const dayIndex = trip.startDate ? currentDayIndex(todayISO, trip.startDate) : null

  return (
    <div className="px-5 pt-3 pb-safe-fab-clearance overflow-y-auto no-scrollbar h-full flex flex-col gap-3.5">
      <div>
        {dayIndex != null && (
          <div className="text-[11px] text-muted mb-1.5">{t('overview.dayIndex', { day: dayIndex, date: todayISO.slice(5) })}</div>
        )}
        <SpendHero state={allowance} currency={currencyLabel} />
      </div>

      <div>
        <SectionLabel>{t('overview.upNext')}</SectionLabel>
        {upcoming.length ? (
          <div className="flex flex-col gap-2">
            {upcoming.slice(0, 3).map((it) => (
              <Card key={it.id} tone="accent">
                <div className="flex items-center gap-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate">{it.title}</div>
                    {it.locationName && <div className="text-[10.5px] text-muted mt-0.5 truncate">{it.locationName}</div>}
                  </div>
                  <span className="text-[12px] tabular text-muted flex-shrink-0">{formatTimeHM(it.time) || t('overview.noTimeSet')}</span>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <div className="text-[12.5px] text-muted">{t('overview.todayDone')}</div>
          </Card>
        )}
      </div>

      <div>
        <div className="flex items-center">
          <SectionLabel>{t('overview.recentActivity')}</SectionLabel>
          {entries.length > 2 && (
            <button onClick={() => setActivityOpen(true)} className="ml-auto text-[11px] text-plan mb-2">
              {t('overview.viewAll')}
            </button>
          )}
        </div>
        {entries.length ? (
          <div className="flex flex-col gap-2">
            {entries.slice(0, 2).map((en) => {
              const author = en.authorId ? members.find((m) => m.id === en.authorId) : undefined
              return (
                <Card key={en.id}>
                  <div className="flex items-start gap-2.5">
                    <Avatar member={author} size={22} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[12px] font-medium">{author?.displayName ?? t('activity.someone')}</span>
                        <span className={`text-[9.5px] px-1.5 py-0.5 rounded-full ${ACTIVITY_KIND_CLASS[en.kind]}`}>
                          {activityKindLabel(en.kind, t)}
                        </span>
                      </div>
                      <div className="text-[12px] text-ink/85 mt-0.5 break-words">{en.text}</div>
                    </div>
                    <div className="text-[10px] text-muted flex-shrink-0 pt-0.5">{relativeTime(en.at, now, t)}</div>
                  </div>
                </Card>
              )
            })}
          </div>
        ) : (
          <Card>
            <div className="text-[12.5px] text-muted">{t('overview.emptyDuringTrip')}</div>
          </Card>
        )}
      </div>

      {activityOpen && <ActivityFeed trip={trip} onClose={() => setActivityOpen(false)} />}
    </div>
  )
}
