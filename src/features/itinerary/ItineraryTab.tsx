import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, ensureItineraryDay } from '../../db/dexie'
import type { Trip, ItineraryItem } from '../../types'
import { formatMoney } from '../../lib/money'
import { TimePicker } from '../../components/TimePicker'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { LocationPicker, type LocationValue } from '../../components/LocationPicker'
import { CalendarView } from './CalendarView'
import { MapView } from './MapView'
import { dateRange } from '../../lib/dates'

const DOW = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
type ViewMode = 'timeline' | 'calendar' | 'map'

export function ItineraryTab({ trip }: { trip: Trip }) {
  const days = trip.startDate && trip.endDate ? dateRange(trip.startDate, trip.endDate) : []
  const [viewMode, setViewMode] = useState<ViewMode>('timeline')
  const [selected, setSelected] = useState(days[0] ?? '')

  const itineraryDays = useLiveQuery(() => db.itineraryDays.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const currentDay = itineraryDays.find((d) => d.date === selected)

  // 时间线只需要当天的行程项；日历/地图视图要看到整趟行程所有天的行程项，所以两份查询都留着
  const items = useLiveQuery(async () => {
    if (!currentDay) return []
    const raw = await db.itineraryItems.where('dayId').equals(currentDay.id).toArray()
    return raw.sort((a, b) => {
      if (!a.time && !b.time) return a.orderIndex - b.orderIndex
      if (!a.time) return 1
      if (!b.time) return -1
      return a.time.localeCompare(b.time)
    })
  }, [currentDay?.id]) ?? []

  const allItems = useLiveQuery(() => db.itineraryItems.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []

  const expenses = useLiveQuery(() => db.expenses.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const dayTotal = useMemo(() => {
    if (!currentDay) return 0
    return expenses.filter((e) => e.itineraryDayId === currentDay.id).reduce((a, e) => a + e.homeAmount, 0)
  }, [expenses, currentDay])

  // null = 表单关闭；'new' = 新增（表单出现在列表最下面）；具体 id = 正在编辑该行程项
  // （编辑表单要原地替换那张卡片，不能跑到列表底部——不然用户会搞不清自己在改哪一条）
  const [formState, setFormState] = useState<'new' | string | null>(null)

  const stripRef = useRef<HTMLDivElement>(null)
  const [scrollState, setScrollState] = useState({ left: false, right: true })

  function updateScrollState() {
    const el = stripRef.current
    if (!el) return
    setScrollState({
      left: el.scrollLeft > 4,
      right: el.scrollLeft < el.scrollWidth - el.clientWidth - 4,
    })
  }

  useEffect(() => {
    updateScrollState()
  }, [days.length])

  async function ensureDay(date: string) {
    return ensureItineraryDay(trip.id, date)
  }

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  async function confirmDeleteItem() {
    if (!pendingDeleteId) return
    const id = pendingDeleteId
    await db.expenses.where('itineraryItemId').equals(id).modify({ itineraryItemId: null })
    await db.itineraryItems.delete(id)
    if (formState === id) setFormState(null)
    setPendingDeleteId(null)
  }

  if (!days.length) {
    return (
      <div className="px-5 pt-3 pb-24 text-sm text-muted">
        这趟行程还没设置起止日期，暂时无法按天规划行程——可以先去「记账」标签试试记一笔。
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 pt-3 pb-1 flex-shrink-0">
        <div className="flex gap-1 bg-[#EDE6DA] rounded-xl p-1 w-fit">
          {([['timeline', '时间线'], ['calendar', '日历'], ['map', '地图']] as [ViewMode, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setViewMode(key)}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] ${viewMode === key ? 'bg-ink text-paper' : 'text-[#8A8177]'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {viewMode === 'calendar' && (
          <CalendarView
            tripDates={days}
            itineraryDays={itineraryDays}
            items={allItems}
            expenses={expenses}
            onJumpToTimeline={(date) => { setSelected(date); setViewMode('timeline') }}
          />
        )}
        {viewMode === 'map' && <MapView days={itineraryDays} items={allItems} />}
        {viewMode === 'timeline' && (
          <div className="px-5 pt-2 pb-24 overflow-y-auto no-scrollbar h-full">
            <div className="relative -mx-5 px-5 mb-3.5">
              <div
                ref={stripRef}
                onScroll={updateScrollState}
                className="flex gap-2 overflow-x-auto no-scrollbar pb-1 pt-0.5"
              >
                {days.map((d) => {
                  const dow = DOW[new Date(d + 'T00:00:00').getDay()]
                  const num = d.slice(-2).replace(/^0/, '')
                  const isActive = d === selected
                  return (
                    <button
                      key={d}
                      onClick={() => { setSelected(d); setFormState(null) }}
                      className={`flex-shrink-0 rounded-2xl px-3.5 py-2 text-center border font-serif-sc ${
                        isActive ? 'bg-ink text-paper border-ink' : 'bg-card text-[#57534E] border-line'
                      }`}
                    >
                      <div className="text-[10px] opacity-70">{dow}</div>
                      <div className="text-base mt-0.5">{num}</div>
                    </button>
                  )
                })}
              </div>
              {scrollState.left && (
                <div className="pointer-events-none absolute left-0 top-0.5 bottom-1 w-6 bg-gradient-to-r from-paper to-transparent" />
              )}
              {scrollState.right && (
                <div className="pointer-events-none absolute right-0 top-0.5 bottom-1 w-8 bg-gradient-to-l from-paper to-transparent flex items-center justify-end">
                  <span className="text-[#B8AE9E] text-xs mr-0.5">›</span>
                </div>
              )}
            </div>

            <div className="flex items-baseline justify-between mb-3">
              <div className="font-serif-sc text-sm">{selected} {currentDay?.title ? `· ${currentDay.title}` : ''}</div>
              <div className="text-[11.5px] text-muted tabular">当日花费 {formatMoney(dayTotal)}</div>
            </div>

            <div className="flex flex-col gap-2">
              {items.map((it) => {
                if (formState === it.id) {
                  return (
                    <ItemForm
                      key={it.id}
                      initial={it}
                      countryCodes={trip.destinationCountries}
                      onCancel={() => setFormState(null)}
                      onDelete={() => setPendingDeleteId(it.id)}
                      onSave={async (title, time, location) => {
                        await db.itineraryItems.update(it.id, {
                          title,
                          time: time || null,
                          locationName: location.name || null,
                          lat: location.lat,
                          lng: location.lng,
                          updatedAt: Date.now(),
                        })
                        setFormState(null)
                      }}
                    />
                  )
                }
                const itemTotal = expenses.filter((e) => e.itineraryItemId === it.id).reduce((a, e) => a + e.homeAmount, 0)
                return (
                  // 注意：外层不能用 <button>，因为里面还嵌了一个可点的删除按钮——
                  // <button> 套 <button> 是非法的 HTML 嵌套，在触屏上点击行为会不可靠
                  <div
                    key={it.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setFormState(it.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setFormState(it.id) }}
                    className="text-left bg-card border border-line rounded-2xl p-3 hover:border-plan/50 transition-colors cursor-pointer"
                  >
                    <div className="flex justify-between gap-2.5 items-baseline">
                      <div className="text-sm font-medium min-w-0 flex-1 truncate">{it.time ? `${it.time} ` : ''}{it.title}</div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {itemTotal > 0 && <span className="text-xs tabular text-plan">{formatMoney(itemTotal)}</span>}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setPendingDeleteId(it.id) }}
                          className="w-5 h-5 rounded-full flex items-center justify-center text-muted hover:bg-negative/10 hover:text-negative text-xs"
                          title="删除"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    {it.locationName && (
                      <div className="text-[11.5px] text-muted mt-1 truncate">
                        {it.lat != null && <span className="text-positive mr-1">📍</span>}
                        {it.locationName}
                      </div>
                    )}
                  </div>
                )
              })}
              {!items.length && formState !== 'new' && (
                <div className="text-[13px] text-muted py-4 text-center">这天还没有安排，点下面添加一项</div>
              )}
            </div>

            {formState === 'new' ? (
              <ItemForm
                countryCodes={trip.destinationCountries}
                onCancel={() => setFormState(null)}
                onSave={async (title, time, location) => {
                  const day = await ensureDay(selected)
                  const id = crypto.randomUUID()
                  const now = Date.now()
                  await db.itineraryItems.add({
                    id,
                    dayId: day.id,
                    tripId: trip.id,
                    orderIndex: items.length,
                    time: time || null,
                    title,
                    locationName: location.name || null,
                    lat: location.lat,
                    lng: location.lng,
                    notes: null,
                    createdAt: now,
                    updatedAt: now,
                  })
                  setFormState(null)
                }}
              />
            ) : (
              !formState && (
                <button
                  onClick={() => setFormState('new')}
                  className="mt-2 w-full rounded-xl border border-dashed border-line text-[#57534E] text-sm py-2.5"
                >
                  ＋ 添加行程项
                </button>
              )
            )}
          </div>
        )}
      </div>

      {pendingDeleteId && (
        <ConfirmDialog
          title="删除这个行程项？"
          message="关联的费用记录不会被删除，但会解除关联。"
          onConfirm={confirmDeleteItem}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}
    </div>
  )
}

function ItemForm({
  initial,
  onSave,
  onCancel,
  onDelete,
  countryCodes,
}: {
  initial?: ItineraryItem
  onSave: (title: string, time: string, location: LocationValue) => void
  onCancel: () => void
  onDelete?: () => void
  countryCodes?: string[]
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [time, setTime] = useState(initial?.time ?? '')
  const [location, setLocation] = useState<LocationValue>({
    name: initial?.locationName ?? '',
    lat: initial?.lat ?? null,
    lng: initial?.lng ?? null,
  })

  return (
    <div className="mt-2 bg-card border border-plan/40 rounded-2xl p-3 flex flex-col gap-2">
      <div className="flex gap-2">
        <TimePicker value={time} onChange={setTime} />
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="做什么，例如「环球影城」"
          className="flex-1 min-w-0 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-plan"
        />
      </div>
      <LocationPicker value={location} onChange={setLocation} countryCodes={countryCodes} />
      <div className="flex gap-2 mt-1">
        {onDelete && (
          <button onClick={onDelete} className="rounded-lg border border-negative/30 text-negative px-3 py-1.5 text-sm">
            删除
          </button>
        )}
        <button onClick={onCancel} className="flex-1 rounded-lg border border-line py-1.5 text-sm text-muted">
          取消
        </button>
        <button
          onClick={() => title.trim() && onSave(title.trim(), time, location)}
          className="flex-1 rounded-lg bg-plan text-card py-1.5 text-sm font-medium"
        >
          保存
        </button>
      </div>
    </div>
  )
}
