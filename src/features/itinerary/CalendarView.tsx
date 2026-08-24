import { Fragment, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ItineraryDay, ItineraryItem, Expense, ExpenseDayAllocation } from '../../types'
import { formatMoney } from '../../lib/money'
import { formatTimeHM } from '../../lib/dates'
import { sortItineraryItems } from '../../domain/itinerary'
import { spendByDate as computeSpendByDate } from '../../domain/dayAllocations'
import { useDayRouteLegs } from '../../lib/routeLegs'
import { RouteLegHint } from '../../components/RouteLegHint'

const DOW = ['一', '二', '三', '四', '五', '六', '日']
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

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
  onJumpToTimeline,
}: {
  tripDates: string[]
  itineraryDays: ItineraryDay[]
  items: ItineraryItem[]
  expenses: Expense[]
  dayAllocations: ExpenseDayAllocation[]
  onJumpToTimeline: (date: string) => void
}) {
  const initial = tripDates[0] ? new Date(tripDates[0] + 'T00:00:00') : new Date()
  const [viewY, setViewY] = useState(initial.getFullYear())
  const [viewM, setViewM] = useState(initial.getMonth() + 1)
  const [selected, setSelected] = useState<string | null>(null)

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

  const selectedDay = selected ? itineraryDays.find((d) => d.date === selected) : undefined
  const selectedItems = selectedDay ? sortItineraryItems(items.filter((it) => it.dayId === selectedDay.id)) : []
  const routeLegs = useDayRouteLegs(selectedDay?.id, selectedItems)

  return (
    <div className="px-5 pt-3 pb-safe-fab-clearance overflow-y-auto no-scrollbar h-full">
      <div className="bg-card border border-line rounded-2xl p-3.5 mb-3.5">
        <div className="flex items-center justify-between mb-2.5">
          <button type="button" onClick={() => shiftMonth(-1)} className="w-7 h-7 rounded-full hover:bg-paper text-muted flex items-center justify-center">
            <ChevronLeft className="w-4 h-4" strokeWidth={1.8} />
          </button>
          <span className="font-serif-sc text-sm font-semibold">{viewY}年 {MONTH_NAMES[viewM - 1]}</span>
          <button type="button" onClick={() => shiftMonth(1)} className="w-7 h-7 rounded-full hover:bg-paper text-muted flex items-center justify-center">
            <ChevronRight className="w-4 h-4" strokeWidth={1.8} />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DOW.map((d) => <div key={d} className="text-center text-[10px] text-muted">{d}</div>)}
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
                onClick={() => setSelected(iso)}
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
              onClick={() => onJumpToTimeline(selected!)}
              className="text-[11.5px] text-plan"
            >
              在时间线中编辑 ›
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
                      {it.bookingStatus === 'needed' ? '待预约' : '已预约'}
                    </span>
                  )}
                </div>
                {it.locationName && <div className="text-[11.5px] text-muted mt-1">{it.locationName}</div>}
              </div>
              {i < selectedItems.length - 1 && <RouteLegHint leg={routeLegs[i]} />}
            </Fragment>
          ))}
          {!selectedItems.length && (
            <div className="text-[13px] text-muted py-3 text-center">这天还没有安排的行程项</div>
          )}
        </div>
      ) : selected && !selectedDay ? (
        <div className="flex flex-col gap-2">
          <div className="font-serif-sc text-sm">{selected}</div>
          <div className="text-[13px] text-muted py-3 text-center">这天还没有安排的行程项</div>
          <button type="button" onClick={() => onJumpToTimeline(selected)} className="text-[11.5px] text-plan text-center">
            去时间线添加 ›
          </button>
        </div>
      ) : (
        <div className="text-[13px] text-muted py-4 text-center">点日历上的日期，查看当天安排</div>
      )}
    </div>
  )
}
