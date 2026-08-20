import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Trash2, X, Check, Plus, Filter, Bookmark } from 'lucide-react'
import { db, ensureItineraryDay } from '../../db/dexie'
import { getCurrentHouseholdId } from '../../domain/household'
import { sortItineraryItems } from '../../domain/itinerary'
import { spendByDate } from '../../domain/dayAllocations'
import { toggleBookingStatus } from '../../domain/booking'
import { listWishlistPlaces, nearbyWishlistSuggestions } from '../../domain/wishlist'
import type { Trip, ItineraryItem, BookingStatus, WishlistPlace } from '../../types'
import { formatMoney } from '../../lib/money'
import { TimePicker } from '../../components/TimePicker'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { CenteredModal } from '../../components/CenteredModal'
import { LocationPicker, type LocationValue } from '../../components/LocationPicker'
import { CalendarView } from './CalendarView'
import { MapView } from './MapView'
import { dateRange, formatTimeHM } from '../../lib/dates'
import { useDayRouteLegs } from '../../lib/routeLegs'
import { RouteLegHint } from '../../components/RouteLegHint'
import { WishlistScreen } from '../wishlist/WishlistScreen'
import { useBackDismiss } from '../../hooks/useBackDismiss'

const DOW = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
type ViewMode = 'timeline' | 'calendar' | 'map'

export function ItineraryTab({
  trip,
  currentMemberId,
  onFormOpenChange,
}: {
  trip: Trip
  currentMemberId: string
  onFormOpenChange?: (open: boolean) => void
}) {
  const days = trip.startDate && trip.endDate ? dateRange(trip.startDate, trip.endDate) : []
  const [viewMode, setViewMode] = useState<ViewMode>('timeline')
  const [selected, setSelected] = useState(days[0] ?? '')
  const [wishlistOpen, setWishlistOpen] = useState(false)
  useBackDismiss(wishlistOpen, () => setWishlistOpen(false))

  const itineraryDays = useLiveQuery(() => db.itineraryDays.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const currentDay = itineraryDays.find((d) => d.date === selected)

  // 时间线只需要当天的行程项；日历/地图视图要看到整趟行程所有天的行程项，所以两份查询都留着
  const items = useLiveQuery(async () => {
    if (!currentDay) return []
    const raw = await db.itineraryItems.where('dayId').equals(currentDay.id).toArray()
    return sortItineraryItems(raw)
  }, [currentDay?.id]) ?? []

  const allItems = useLiveQuery(() => db.itineraryItems.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []

  // "反向提醒"：想去的地点里，哪些离**当前这一天**已经排上时间线的点足够近——
  // 距离锚点故意只用当前这一天的行程项（items），不是整趟行程的（allItems）：
  // 跨城市的行程如果拿全部行程当锚点，看北海道那几天时也会推荐东京附近的地点，
  // 隔着几百公里毫无意义。但"是否已经排入过"要看整趟行程，所以那部分仍传 allItems
  const wishlistPlaces = useLiveQuery(() => listWishlistPlaces()) ?? []
  const suggestions = useMemo(
    () => nearbyWishlistSuggestions(wishlistPlaces, items, allItems),
    [wishlistPlaces, items, allItems],
  )
  // 关闭是当次会话级别的，不落库——下次重新进这趟行程还会再出现；切换到别的日期
  // 也会重新出现，因为不同天推荐的地点本来就不一样，不该被上一天的关闭状态带偏
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false)

  async function addFromWishlist(place: WishlistPlace) {
    const day = await ensureDay(selected)
    const householdId = await getCurrentHouseholdId()
    if (!householdId) return
    const id = crypto.randomUUID()
    const now = Date.now()
    await db.itineraryItems.add({
      id,
      householdId,
      createdBy: currentMemberId,
      dayId: day.id,
      tripId: trip.id,
      orderIndex: items.length,
      time: null,
      title: place.name,
      locationName: place.name,
      lat: place.lat,
      lng: place.lng,
      notes: place.notes,
      bookingStatus: null,
      sourceWishlistId: place.id,
      createdAt: now,
      updatedAt: now,
    })
  }

  const routeLegs = useDayRouteLegs(currentDay?.id, items)

  const expenses = useLiveQuery(() => db.expenses.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const dayAllocations = useLiveQuery(() => db.expenseDayAllocations.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  // 住宿/周游券这类跨天开销只算它分摊到今天的那部分，不整笔算在某一天头上
  const dayTotal = useMemo(() => {
    if (!currentDay) return 0
    return spendByDate(expenses, dayAllocations, itineraryDays).get(currentDay.date) ?? 0
  }, [expenses, dayAllocations, itineraryDays, currentDay])

  // null = 表单关闭；'new' = 新增（表单出现在列表最下面）；具体 id = 正在编辑该行程项
  // （编辑表单要原地替换那张卡片，不能跑到列表底部——不然用户会搞不清自己在改哪一条）
  const [formState, setFormState] = useState<'new' | string | null>(null)

  // 表单展开后会占到屏幕靠下的位置，跟全局"记一笔"悬浮按钮的固定位置正好重叠，
  // 真机上看起来悬浮按钮糊在表单上面——开着表单时让 TripShell 把悬浮按钮先藏起来
  useEffect(() => {
    onFormOpenChange?.(formState !== null)
    return () => onFormOpenChange?.(false)
  }, [formState, onFormOpenChange])

  // 行程比较多的时候，这个筛选能一眼看出"这趟行程还有哪几项没订"。只影响时间线
  // 这里的显示，不影响日历/地图视图，也不影响还没建过的那几天能不能选
  const [onlyNeeded, setOnlyNeeded] = useState(false)

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
    <div className="h-full flex flex-col relative">
      <div className="px-5 pt-3 pb-1 flex-shrink-0 flex items-center justify-between">
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
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => setWishlistOpen(true)}
            className="w-8 h-8 rounded-[10px] border border-plan/25 bg-plan/[0.06] text-plan flex items-center justify-center flex-shrink-0"
            title="想去的地点"
          >
            <Bookmark className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </button>
          {viewMode === 'timeline' && (
            <button
              onClick={() => setOnlyNeeded((v) => !v)}
              className={`w-8 h-8 rounded-[10px] border flex items-center justify-center flex-shrink-0 ${
                onlyNeeded ? 'border-spend bg-spend/10 text-spend' : 'border-line bg-card text-muted'
              }`}
              title="只看待预约"
            >
              <Filter className="w-[15px] h-[15px]" strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>
      {wishlistOpen && <WishlistScreen currentMemberId={currentMemberId} onClose={() => setWishlistOpen(false)} />}

      <div className="flex-1 overflow-hidden">
        {viewMode === 'calendar' && (
          <CalendarView
            tripDates={days}
            itineraryDays={itineraryDays}
            items={allItems}
            expenses={expenses}
            dayAllocations={dayAllocations}
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
                      onClick={() => { setSelected(d); setFormState(null); setSuggestionsDismissed(false) }}
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

            {!suggestionsDismissed && suggestions.length > 0 && (
              <div className="rounded-2xl border border-plan/25 bg-plan/5 px-3 py-2.5 mb-3">
                <div className="flex items-center justify-between">
                  <div className="text-[12px] font-semibold text-plan flex items-center gap-1.5">
                    <Bookmark className="w-3.5 h-3.5" strokeWidth={2.2} />
                    你标记过 {suggestions.length} 个附近想去的地点
                  </div>
                  <button onClick={() => setSuggestionsDismissed(true)} className="text-muted" title="关闭">
                    <X className="w-3.5 h-3.5" strokeWidth={2} />
                  </button>
                </div>
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar mt-2 pb-0.5">
                  {suggestions.map((s) => (
                    <div key={s.id} className="flex-shrink-0 flex items-center gap-1.5 bg-card border border-line rounded-2xl pl-3 pr-1.5 py-1.5 text-[11px] max-w-[160px]">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{s.name}</div>
                        {s.notes && <div className="truncate text-[9.5px] text-muted mt-0.5">{s.notes}</div>}
                      </div>
                      <button
                        onClick={() => addFromWishlist(s)}
                        className="w-5 h-5 rounded-full bg-plan text-card flex items-center justify-center flex-shrink-0"
                        title="加入今天"
                      >
                        <Plus className="w-3 h-3" strokeWidth={2.5} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-baseline justify-between mb-3">
              <div className="font-serif-sc text-sm">{selected} {currentDay?.title ? `· ${currentDay.title}` : ''}</div>
              <div className="text-[11.5px] text-muted tabular">当日花费 {formatMoney(dayTotal)}</div>
            </div>

            <div className="flex flex-col gap-2">
              {items.map((it, i) => {
                const legRow = i < items.length - 1 ? <RouteLegHint leg={routeLegs[i]} /> : null

                if (formState === it.id) {
                  return (
                    <Fragment key={it.id}>
                      <ItemForm
                        initial={it}
                        countryCodes={trip.destinationCountries}
                        onCancel={() => setFormState(null)}
                        onDelete={() => setPendingDeleteId(it.id)}
                        onSave={async (title, time, location, notes, bookingStatus, sourceWishlistId) => {
                          await db.itineraryItems.update(it.id, {
                            title,
                            time: time || null,
                            locationName: location.name || null,
                            lat: location.lat,
                            lng: location.lng,
                            notes: notes || null,
                            bookingStatus,
                            sourceWishlistId,
                            updatedAt: Date.now(),
                          })
                          setFormState(null)
                        }}
                      />
                      {legRow}
                    </Fragment>
                  )
                }

                // 正在编辑的那一条不受筛选影响（上面那个分支已经处理过、提前return了），
                // 其余的按"只看待预约"筛掉——保留在 items.map 里逐个跳过而不是先
                // filter()出一份新数组，是为了不打乱 routeLegs[i] 的下标对应关系
                if (onlyNeeded && it.bookingStatus !== 'needed') return null

                const itemTotal = expenses.filter((e) => e.itineraryItemId === it.id).reduce((a, e) => a + e.homeAmount, 0)
                return (
                  <Fragment key={it.id}>
                    {/* 注意：外层不能用 <button>，因为里面还嵌了一个可点的删除按钮——
                    <button> 套 <button> 是非法的 HTML 嵌套，在触屏上点击行为会不可靠 */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setFormState(it.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setFormState(it.id) }}
                      className="text-left bg-card border border-line rounded-2xl p-3 hover:border-plan/50 transition-colors cursor-pointer"
                    >
                      <div className="flex justify-between gap-2.5 items-baseline">
                        <div className="text-sm font-medium min-w-0 flex-1 truncate">{it.time ? `${formatTimeHM(it.time)} ` : ''}{it.title}</div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {it.bookingStatus && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                db.itineraryItems.update(it.id, { bookingStatus: toggleBookingStatus(it.bookingStatus!), updatedAt: Date.now() })
                              }}
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
                                it.bookingStatus === 'needed' ? 'bg-spend/10 text-spend' : 'bg-positive/10 text-positive'
                              }`}
                              title="点一下切换预约状态"
                            >
                              {it.bookingStatus === 'needed' ? '待预约' : '已预约'}
                            </button>
                          )}
                          {itemTotal > 0 && <span className="text-xs tabular text-plan">{formatMoney(itemTotal)}</span>}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setPendingDeleteId(it.id) }}
                            className="w-5 h-5 rounded-full flex items-center justify-center text-muted hover:bg-negative/10 hover:text-negative"
                            title="删除"
                          >
                            <Trash2 className="w-3 h-3" strokeWidth={1.8} />
                          </button>
                        </div>
                      </div>
                      {it.locationName && (
                        <div className="text-[11.5px] text-muted mt-1 truncate">
                          {it.lat != null && <span className="text-positive mr-1">📍</span>}
                          {it.locationName}
                        </div>
                      )}
                      {it.notes && (
                        <div className="text-[11px] text-muted mt-1.5 pt-1.5 border-t border-dashed border-line whitespace-pre-line leading-relaxed">
                          {it.notes}
                        </div>
                      )}
                    </div>
                    {legRow}
                  </Fragment>
                )
              })}
              {!items.length && formState !== 'new' && (
                <div className="text-[13px] text-muted py-4 text-center">这天还没有安排，点下面添加一项</div>
              )}
              {!!items.length && onlyNeeded && !items.some((it) => it.bookingStatus === 'needed' || formState === it.id) && (
                <div className="text-[13px] text-muted py-4 text-center">这天没有待预约的行程项</div>
              )}
            </div>

            {formState === 'new' ? (
              <ItemForm
                countryCodes={trip.destinationCountries}
                onCancel={() => setFormState(null)}
                onSave={async (title, time, location, notes, bookingStatus, sourceWishlistId) => {
                  const day = await ensureDay(selected)
                  const householdId = await getCurrentHouseholdId()
                  if (!householdId) return
                  const id = crypto.randomUUID()
                  const now = Date.now()
                  await db.itineraryItems.add({
                    id,
                    householdId,
                    createdBy: currentMemberId,
                    dayId: day.id,
                    tripId: trip.id,
                    orderIndex: items.length,
                    time: time || null,
                    title,
                    locationName: location.name || null,
                    lat: location.lat,
                    lng: location.lng,
                    notes: notes || null,
                    bookingStatus,
                    sourceWishlistId,
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
                  className="mt-2 w-full rounded-xl border border-dashed border-line text-[#57534E] text-sm py-2.5 flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-4 h-4" strokeWidth={2} />
                  添加行程项
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
  onSave: (
    title: string,
    time: string,
    location: LocationValue,
    notes: string,
    bookingStatus: BookingStatus | null,
    sourceWishlistId: string | null,
  ) => void
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
  const [notes, setNotes] = useState(initial?.notes ?? '')
  // 选了不等于存了——跟标题/备注这些字段一样是本地草稿，点"取消"就丢弃，
  // 只有点保存才会写回数据库
  const [bookingStatus, setBookingStatus] = useState<BookingStatus | null>(initial?.bookingStatus ?? null)
  // 这一项是不是从"想去的地点"一键选出来的——纯追溯用途。手动改地点（重新搜索/
  // 贴地图链接）之后就不再对应那条来源了，要跟着清空，不然徽章会挂着错的来源
  const [sourceWishlistId, setSourceWishlistId] = useState<string | null>(initial?.sourceWishlistId ?? null)
  const [wishlistPickerOpen, setWishlistPickerOpen] = useState(false)
  const [wishlistFilter, setWishlistFilter] = useState('')
  const wishlistPlaces = useLiveQuery(() => listWishlistPlaces()) ?? []
  const filteredWishlistPlaces = wishlistFilter.trim()
    ? wishlistPlaces.filter((p) => p.name.includes(wishlistFilter.trim()))
    : wishlistPlaces

  function pickFromWishlist(p: WishlistPlace) {
    setLocation({ name: p.name, lat: p.lat, lng: p.lng })
    if (!title.trim()) setTitle(p.name)
    // 跟标题一样，只在备注还是空的时候才带过来——避免盖掉用户已经手打的内容
    if (!notes.trim() && p.notes) setNotes(p.notes)
    setSourceWishlistId(p.id)
    setWishlistPickerOpen(false)
    setWishlistFilter('')
  }

  const formRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // 表单展开的位置就是点击"添加行程项"/某个行程项时所在的位置，展开后
    // 内容变高，很容易有一部分（尤其是保存按钮）落在屏幕外面，需要手动滑动才看得到
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  return (
    <div ref={formRef} className="mt-2 bg-card border border-plan/40 rounded-2xl p-3 flex flex-col gap-2">
      <div className="flex gap-2">
        <TimePicker value={time} onChange={setTime} />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="做什么，例如「环球影城」"
          autoComplete="off"
          className="flex-1 min-w-0 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-plan"
        />
      </div>
      <button
        type="button"
        onClick={() => setWishlistPickerOpen(true)}
        className="flex items-center gap-1 text-[11.5px] text-plan font-semibold border border-dashed border-plan/40 rounded-lg px-2.5 py-1.5 w-fit"
      >
        <Bookmark className="w-3 h-3" strokeWidth={2.2} />
        从想去的地点里选一个
      </button>
      <LocationPicker
        value={location}
        onChange={(v) => { setLocation(v); setSourceWishlistId(null) }}
        countryCodes={countryCodes}
      />
      <div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="备注（可选）"
          rows={2}
          autoComplete="off"
          className="w-full resize-y rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-plan leading-relaxed"
        />
        <div className="text-[10px] text-muted mt-1">拖右下角可以拉高；换行或加"1. 2. 3."就能分点</div>
      </div>
      <div>
        <div className="text-[10px] tracking-widest uppercase text-muted mb-1">预约状态</div>
        <div className="flex border border-line rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setBookingStatus(null)}
            className={`flex-1 py-1.5 text-[11.5px] ${bookingStatus === null ? 'bg-ink text-paper font-medium' : 'text-muted'}`}
          >
            无需预约
          </button>
          <button
            type="button"
            onClick={() => setBookingStatus('needed')}
            className={`flex-1 py-1.5 text-[11.5px] ${bookingStatus === 'needed' ? 'bg-spend text-card font-medium' : 'text-muted'}`}
          >
            待预约
          </button>
          <button
            type="button"
            onClick={() => setBookingStatus('booked')}
            className={`flex-1 py-1.5 text-[11.5px] ${bookingStatus === 'booked' ? 'bg-positive text-card font-medium' : 'text-muted'}`}
          >
            已预约
          </button>
        </div>
      </div>
      <div className="flex gap-2 mt-1">
        {onDelete && (
          <button onClick={onDelete} className="rounded-lg border border-negative/30 text-negative px-3 py-1.5" title="删除">
            <Trash2 className="w-4 h-4" strokeWidth={1.8} />
          </button>
        )}
        <button onClick={onCancel} className="flex-1 rounded-lg border border-line py-1.5 text-muted flex items-center justify-center" title="取消">
          <X className="w-4 h-4" strokeWidth={1.8} />
        </button>
        <button
          onClick={() => title.trim() && onSave(title.trim(), time, location, notes.trim(), bookingStatus, sourceWishlistId)}
          className="flex-1 rounded-lg bg-plan text-card py-1.5 flex items-center justify-center"
          title="保存"
        >
          <Check className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>

      {wishlistPickerOpen && (
        <CenteredModal onClose={() => setWishlistPickerOpen(false)}>
          <div className="font-serif-sc text-[15px] text-ink mb-3">从想去的地点里选</div>
          <input
            autoFocus
            value={wishlistFilter}
            onChange={(e) => setWishlistFilter(e.target.value)}
            placeholder="筛选…"
            className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-plan mb-2"
          />
          <div className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto no-scrollbar">
            {filteredWishlistPlaces.length === 0 && (
              <div className="text-[12px] text-muted text-center py-4">没有匹配的地点</div>
            )}
            {filteredWishlistPlaces.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => pickFromWishlist(p)}
                className="text-left rounded-xl border border-line bg-paper px-3 py-2 hover:border-plan"
              >
                <div className="text-[12.5px] font-semibold text-ink">{p.name}</div>
                {p.notes && <div className="text-[10px] text-muted mt-0.5 truncate">{p.notes}</div>}
              </button>
            ))}
          </div>
        </CenteredModal>
      )}
    </div>
  )
}
