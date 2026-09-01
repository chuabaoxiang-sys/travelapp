import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ItineraryDay, ItineraryItem, Expense, ExpenseDayAllocation } from '../../types'
import { formatMoney } from '../../lib/money'
import { formatTimeHM } from '../../lib/dates'
import { sortItineraryItems } from '../../domain/itinerary'
import { spendByDate as computeSpendByDate } from '../../domain/dayAllocations'
import { useDayRouteLegs } from '../../lib/routeLegs'
import { RouteLegHint } from '../../components/RouteLegHint'
import { monthYearLabel } from '../../lib/calendarFormat'

function daysInMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate()
}
function mondayOffset(y: number, m: number) {
  const dow = new Date(y, m - 1, 1).getDay()
  return (dow + 6) % 7
}
function toISO(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function CalendarView({
  tripDates,
  itineraryDays,
  items,
  expenses,
  dayAllocations,
  selected,
  onSelect,
  onJumpToTimeline,
}: {
  tripDates: string[]
  itineraryDays: ItineraryDay[]
  items: ItineraryItem[]
  expenses: Expense[]
  dayAllocations: ExpenseDayAllocation[]
  // "当前日期"跟时间线视图、底部FAB添加行程项用的是同一份状态（在ItineraryTab里），
  // 不再是这个组件自己关起来维护的一份——不然日历上点了某天，"+"加的却是另一天，
  // 两边对不上
  selected: string
  onSelect: (date: string) => void
  onJumpToTimeline: () => void
}) {
  const { t, i18n } = useTranslation()
  const dow = t('datePicker.dow', { returnObjects: true }) as string[]
  const months = t('datePicker.months', { returnObjects: true }) as string[]
  const initial = new Date(selected + 'T00:00:00')
  const [viewY, setViewY] = useState(initial.getFullYear())
  const [viewM, setViewM] = useState(initial.getMonth() + 1)

  // 住宿/周游券这类跨天开销不能整笔算在某一天头上——computeSpendByDate 会把
  // 单日开销和"这一天分摊到多少"两条路径合起来算（见 domain/dayAllocations.ts）
  const spendByDate = useMemo(
    () => computeSpendByDate(expenses, dayAllocations, itineraryDays),
    [itineraryDays, expenses, dayAllocations],
  )

  function shiftMonth(delta: number) {
    let m = viewM + delta
    let y = viewY
    if (m < 1) { m = 12; y -= 1 }
    if (m > 12) { m = 1; y += 1 }
    setViewM(m)
    setViewY(y)
  }

  const offset = mondayOffset(viewY, viewM)
  const total = daysInMonth(viewY, viewM)
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)]

  const selectedDay = itineraryDays.find((d) => d.date === selected)
  const selectedItems = selectedDay ? sortItineraryItems(items.filter((it) => it.dayId === selectedDay.id)) : []
  const routeLegs = useDayRouteLegs(selectedDay?.id, selectedItems)

  return (
    <div className="px-5 pt-3 pb-safe-fab-clearance overflow-y-auto no-scrollbar h-full">
      <div className="bg-card border border-line rounded-2xl p-3.5 mb-3.5">
        <div className="flex items-center justify-between mb-2.5">
          <button type="button" onClick={() => shiftMonth(-1)} className="w-7 h-7 rounded-full hover:bg-paper text-muted flex items-center justify-center">
            <ChevronLeft className="w-4 h-4" strokeWidth={1.8} />
          </button>
          <span className="font-serif-sc text-sm font-semibold">{monthYearLabel(viewY, viewM, i18n.language, months)}</span>
          <button type="button" onClick={() => shiftMonth(1)} className="w-7 h-7 rounded-full hover:bg-paper text-muted flex items-center justify-center">
            <ChevronRight className="w-4 h-4" strokeWidth={1.8} />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 mb-1">
          {dow.map((d) => <div key={d} className="text-center text-[10px] text-muted">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (d === null) return <div key={i} />
            const iso = toISO(viewY, viewM, d)
            const inTrip = tripDates.includes(iso)
            const isSelected = iso === selected
            const spend = spendByDate.get(iso)
            return (
              <button
                type="button"
                key={i}
                disabled={!inTrip}
                onClick={() => onSelect(iso)}
                className={`aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 text-[11px] ${
                  isSelected
                    ? 'bg-plan text-card'
                    : inTrip
                      ? 'bg-plan/10 text-plan'
                      : 'text-faint'
                }`}
              >
                <span>{d}</span>
                {/* 0 不显示——自定义分摊时某一天可以填0，格子里挂个"0"只是噪音 */}
                {!!spend && <span className="text-[7.5px] tabular leading-none">{formatMoney(spend, '')}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {selectedDay ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="font-serif-sc text-sm">{selected} {selectedDay.title ? `· ${selectedDay.title}` : ''}</span>
            <button
              type="button"
              onClick={() => onJumpToTimeline()}
              className="text-[11.5px] text-plan"
            >
              {t('calendarView.jumpToTimeline')}
            </button>
          </div>
          {selectedItems.map((it, i) => (
            <Fragment key={it.id}>
              <div className="bg-card border border-line rounded-2xl p-3">
                <div className="flex items-center gap-1.5">
                  <div className="text-sm font-medium">{it.time ? `${formatTimeHM(it.time)} ` : ''}{it.title}</div>
                  {it.bookingStatus && (
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                        it.bookingStatus === 'needed' ? 'bg-spend/10 text-spend' : 'bg-positive/10 text-positive'
                      }`}
                    >
                      {it.bookingStatus === 'needed' ? t('itemForm.bookingNeeded') : t('itemForm.bookingBooked')}
                    </span>
                  )}
                </div>
                {it.locationName && <div className="text-[11.5px] text-muted mt-1">{it.locationName}</div>}
              </div>
              {i < selectedItems.length - 1 && <RouteLegHint leg={routeLegs[i]} />}
            </Fragment>
          ))}
          {!selectedItems.length && (
            <div className="text-[13px] text-muted py-3 text-center">{t('calendarView.emptyDay')}</div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="font-serif-sc text-sm">{selected}</div>
          <div className="text-[13px] text-muted py-3 text-center">{t('calendarView.emptyDay')}</div>
          <button type="button" onClick={() => onJumpToTimeline()} className="text-[11.5px] text-plan text-center">
            {t('calendarView.jumpToTimelineAdd')}
          </button>
        </div>
      )}
    </div>
  )
}
