import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, CheckCheck, Trash2, Check, Lock } from 'lucide-react'
import { getCurrentHouseholdId } from '../../domain/household'
import { db, ensureItineraryDay } from '../../db/dexie'
import { DatePicker } from '../../components/DatePicker'
import { BottomSheet } from '../../components/BottomSheet'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { dateRange } from '../../lib/dates'
import { RateChipRow, type RateSelection } from '../rates/RateChipRow'
import { createRateBookEntry, recordRateUsage } from '../../domain/rates'
import { saveExpenseSplits } from '../../domain/splits'
import { saveDayAllocations, deleteDayAllocations } from '../../domain/dayAllocations'
import { saveRateAllocations, deleteRateAllocations } from '../../domain/rateAllocations'
import { isExpenseSettled } from '../../domain/settlements'
import { categoryColor } from '../../lib/categoryColors'
import { round2 } from '../../lib/money'
import { CategoryIcon } from '../../components/CategoryBadge'
import { Avatar } from '../../components/Avatar'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import type { Trip, ExpensePhase, Expense, SplitType, ExpenseSplit, DaySpreadMode, ExpenseDayAllocation, ExpenseRateAllocation } from '../../types'

// 全屏页面而不是底部弹层——这个表单从"住宿/交通跨天分摊"上线后，塞进88%高度的
// 弹层里必须一路拖到底才能存，实测过什么都没填就已经有111px在屏幕外。改成全屏页
// + 行式布局：阶段/日期/备注/付款人/关联行程五项常驻可见，不折叠不隐藏；
// 只有"怎么分"和"花在几天"这两项——各自都是"多选+平均/自定义切换+逐项金额+
// 实时校验条"四层堆叠——才推进独立子页，子页有自己的返回键、校验条固定在页面底部。
//
// 顶栏"保存"用文字而不是图标：汇率簿页面已经用一个紫色✓表示"完成、自动保存"，
// 这里如果也用✓图标，会被误读成同一种"点了就存好、随时能退出"，但这里的保存和
// 取消是两个不同的、有后果的动作，需要文字把它们分清楚。
export function AddExpensePage({
  trip,
  currentMemberId,
  initial,
  onClose,
}: {
  trip: Trip
  currentMemberId: string
  initial?: Expense
  onClose: () => void
}) {
  const categories = useLiveQuery(() => db.expenseCategories.toArray()) ?? []
  const allMembers = useLiveQuery(() => db.members.toArray()) ?? []
  const itineraryDays = useLiveQuery(() => db.itineraryDays.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const itineraryItems = useLiveQuery(() => db.itineraryItems.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const tripDates = trip.startDate && trip.endDate ? dateRange(trip.startDate, trip.endDate) : []
  const todayISO = new Date().toLocaleDateString('sv-SE')

  const [linkOpen, setLinkOpen] = useState(!!initial?.itineraryDayId)
  const [linkDate, setLinkDate] = useState('')
  const [linkItemId, setLinkItemId] = useState<string | null>(initial?.itineraryItemId ?? null)

  // itineraryDays 是 Dexie 的 useLiveQuery，首次渲染时还没查完（值是空数组），
  // 不能只靠 useState 的初始值去回填编辑时已关联的那一天——那样第一帧永远是空数组，
  // 算出来的日期必然是''。用 useEffect 等 itineraryDays 真正查到数据后再回填一次。
  const linkInitialized = useRef(false)
  useEffect(() => {
    if (linkInitialized.current) return
    if (!initial?.itineraryDayId) return
    const day = itineraryDays.find((d) => d.id === initial.itineraryDayId)
    if (!day) return // 数据还没到，等下一次 itineraryDays 更新再试
    setLinkDate(day.date)
    linkInitialized.current = true
  }, [itineraryDays, initial?.itineraryDayId])

  const [phase, setPhase] = useState<ExpensePhase>(initial?.phase ?? 'during_trip')
  const [categoryId, setCategoryId] = useState<string>(initial?.categoryId ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [currency, setCurrency] = useState(initial?.expenseCurrency ?? trip.homeCurrency)
  const [amount, setAmount] = useState(initial ? String(initial.expenseAmount) : '')
  const [rateSelection, setRateSelection] = useState<RateSelection>(
    initial?.rateBookEntryId ? { mode: 'existing', entryId: initial.rateBookEntryId, rate: initial.rateUsed } : { mode: 'none' },
  )
  // 编辑一笔本来就"拆多笔汇率"的开销时，回填它原本的分摊——rateSpread 是同步字段，
  // 但具体拆了哪几笔、每笔多少要查 expenseRateAllocations，异步的，跟"关联行程"
  // 那处一样用 useEffect+ref 只回填一次
  const existingRateAllocations = useLiveQuery(
    () => (initial?.rateSpread ? db.expenseRateAllocations.where('expenseId').equals(initial.id).toArray() : Promise.resolve<ExpenseRateAllocation[]>([])),
    [initial?.id, initial?.rateSpread],
  ) ?? []
  const rateSplitInitialized = useRef(false)
  useEffect(() => {
    if (rateSplitInitialized.current) return
    if (!initial?.rateSpread) { rateSplitInitialized.current = true; return }
    if (!existingRateAllocations.length) return
    setRateSelection({
      mode: 'split',
      allocations: existingRateAllocations.map((a) => ({ rateBookEntryId: a.rateBookEntryId, foreignAmount: a.foreignAmount, rate: a.rateUsed })),
    })
    rateSplitInitialized.current = true
  }, [initial, existingRateAllocations])
  const [payer, setPayer] = useState(initial?.paidBy ?? currentMemberId)
  const [expenseDate, setExpenseDate] = useState(initial?.expenseDate ?? trip.startDate ?? new Date().toISOString().slice(0, 10))

  // 这笔账有没有被"按笔结算"过（哪怕只结算了一部分）——有的话金额/汇率/怎么分/
  // 付款人这几项会锁住不能改，因为已经记录的结算是照着当时这几个字段算出来的，
  // 改了会跟结算记录对不上。分类/阶段/日期/备注/关联行程这些跟钱无关，不受影响
  const settled = useLiveQuery(
    () => (initial ? isExpenseSettled(initial.id) : Promise.resolve(false)),
    [initial?.id],
  ) ?? false

  // 哪个子页面正在显示——'怎么分'/'花在几天'这两项内部结构太重（chip多选+平均/
  // 自定义切换+逐项金额+校验条），推成独立全屏子页；null 表示还在主页面。
  // 子页的"‹ 返回"只是本地状态切换，不涉及浏览器历史——安卓硬件返回键仍然是
  // "关掉整个记账页"（跟点取消/点背景一样，本来就不带二次确认，子页多退一层
  // 不改变这个既有语义）；只有桌面 Escape 键会先退一层子页，见下面 useEscapeKey
  const [activeDetail, setActiveDetail] = useState<'split' | 'days' | null>(null)

  // 阶段/日期/备注/付款人/关联行程/怎么分/花在几天——这几项绝大多数时候都是默认值就对
  // （自己付、今天、全家平摊），折叠在"其他设置"里，只留金额+分类两个真正每次都要
  // 决定的东西。编辑已有账目时默认展开，因为已有数据往往就是"不是默认值"才需要编辑
  const [detailsOpen, setDetailsOpen] = useState(!!initial)

  // 住宿、周游券这类开销横跨好几天，整笔算在某一天会让那天的"当日花费"虚高、
  // 其他天虚低。打开"跨多天"之后逐天勾选（不要求连续），再选平均分还是每天自己填——
  // 交互刻意跟下面"分摊给成员"那套保持一致，同一个概念只学一次
  const [spreadOpen, setSpreadOpen] = useState(!!initial?.daySpreadMode)
  const [spreadDates, setSpreadDates] = useState<string[]>([])
  // 跟 spreadDates 同步的一份镜像。连着快速点几个日期时，每次点击的处理函数拿到的
  // 都是那一帧渲染时闭包里的旧数组，后一次点击会把前一次的选择覆盖掉（真机上手快
  // 连点就会漏选）——从 ref 读当前值就不会踩这个坑
  const spreadDatesRef = useRef<string[]>([])
  const [dayMode, setDayMode] = useState<DaySpreadMode>(initial?.daySpreadMode === 'exact' ? 'exact' : 'equal')
  const [dayAmounts, setDayAmounts] = useState<Record<string, string>>({})
  const spreadInitialized = useRef(false)
  const existingAllocations = useLiveQuery(
    () => (initial ? db.expenseDayAllocations.where('expenseId').equals(initial.id).toArray() : Promise.resolve<ExpenseDayAllocation[]>([])),
    [initial?.id],
  ) ?? []

  // 编辑一笔本来就跨天的开销时，回填它原本选中的那几天和每天的金额——
  // 跟上面"关联到行程"那处一样要等异步查询真的到数据了再填，空数组不能当初始值
  useEffect(() => {
    if (spreadInitialized.current) return
    if (!initial?.daySpreadMode) { spreadInitialized.current = true; return }
    if (!existingAllocations.length) return
    const sorted = [...existingAllocations].sort((a, b) => a.date.localeCompare(b.date))
    spreadDatesRef.current = sorted.map((a) => a.date)
    setSpreadDates(spreadDatesRef.current)
    const next: Record<string, string> = {}
    sorted.forEach((a) => { next[a.date] = String(a.amount) })
    setDayAmounts(next)
    spreadInitialized.current = true
  }, [initial, existingAllocations])

  // "大家分摊/个人开销"用独立状态记录，而不是从 splitMemberIds.length 推导——
  // 否则在"大家分摊"模式里手动取消勾选到只剩1人时，界面会突然塌成"个人开销"的样子，
  // 用户还在调整名单就被打断。splitType 是同步字段，不用等异步查询就能确定初始值
  const [mode, setMode] = useState<'share' | 'personal'>(initial?.splitType === 'none' ? 'personal' : 'share')
  // "平均分摊/自定义金额"——现实中很多账目不是刚好平分的（比如有人点的菜更贵），
  // 加一种"自己填每个人多少"的分摊方式。customAmounts 用字符串存（输入框原始值），
  // 不用数字，避免用户输入"12."这种还没打完的中间状态被强行转成"12"
  const [splitMode, setSplitMode] = useState<'equal' | 'exact'>(initial?.splitType === 'exact' ? 'exact' : 'equal')
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({})
  const customInitialized = useRef(false)

  // 分摊对象：新记账默认勾选全部成员（家庭场景下最常见的就是大家平摊）；
  // 编辑已有账目则要回填它原本的分摊名单。两边都依赖异步查询（members / expenseSplits），
  // 所以跟前面"关联行程"那处一样，用 useEffect + ref 只回填一次，避免空数组当成初始值
  const [splitMemberIds, setSplitMemberIds] = useState<string[]>([])
  const splitInitialized = useRef(false)
  const existingSplits = useLiveQuery(
    () => (initial ? db.expenseSplits.where('expenseId').equals(initial.id).toArray() : Promise.resolve<ExpenseSplit[]>([])),
    [initial?.id],
  ) ?? []

  // 停用的成员不该再被选成新的付款人/分摊对象，但如果这笔账原本就是他付的、
  // 或者原本分摊名单里就有他，编辑时还是要让他继续出现，不然历史记录会看不全
  const relevantInactiveIds = new Set(
    [initial?.paidBy, ...existingSplits.map((s) => s.memberId)].filter((id): id is string => !!id),
  )
  const members = allMembers.filter((m) => m.isActive || relevantInactiveIds.has(m.id))

  useEffect(() => {
    if (splitInitialized.current) return
    if (initial) {
      if (!existingSplits.length) return
      setSplitMemberIds(existingSplits.map((s) => s.memberId))
      splitInitialized.current = true
    } else {
      if (!members.length) return
      setSplitMemberIds(members.map((m) => m.id))
      splitInitialized.current = true
    }
  }, [initial, existingSplits, members])

  // 编辑一笔本来就是"自定义金额"分摊的账目时，回填每个人原本填的具体数字，
  // 不能让编辑时又被打回平均分摊的样子
  useEffect(() => {
    if (customInitialized.current) return
    if (initial?.splitType === 'exact') {
      if (!existingSplits.length) return
      const next: Record<string, string> = {}
      existingSplits.forEach((s) => { next[s.memberId] = String(s.shareAmount) })
      setCustomAmounts(next)
    }
    customInitialized.current = true
  }, [initial, existingSplits])

  const visibleCategories = categories.filter((c) => c.phase === phase || c.phase === 'either')
  const isForeign = currency !== trip.homeCurrency
  const numAmount = parseFloat(amount) || 0
  // 拆多笔汇率时，rateUsed 是加权平均（各批本位币金额加总 / 开销外币总额），
  // homeAmount 直接是各批本位币金额的加总——不是"总外币×一个混合汇率"反推出来的
  const splitTotalForeign = rateSelection.mode === 'split'
    ? Math.round(rateSelection.allocations.reduce((s, a) => s + a.foreignAmount, 0) * 100) / 100
    : 0
  const splitHomeTotal = rateSelection.mode === 'split'
    ? Math.round(rateSelection.allocations.reduce((s, a) => s + a.foreignAmount * a.rate, 0) * 100) / 100
    : 0
  // 编辑已有账目、且还没碰过汇率选择时，先用当初快照的 rateUsed 顶着，不强行要求重新选一次；
  // 一旦用户点了别的chip或改了新汇率，rateSelection 就会有值，改用那个
  const numRate = !isForeign
    ? 1
    : rateSelection.mode === 'split'
      ? (splitTotalForeign > 0 ? splitHomeTotal / splitTotalForeign : 0)
      : rateSelection.mode !== 'none' ? rateSelection.rate : initial?.rateUsed ?? 0
  const homeAmount = rateSelection.mode === 'split' ? splitHomeTotal : round2(numAmount * numRate)
  const rateReady = !isForeign || numRate > 0
  // 拆分模式下，各批填的外币总额必须刚好等于这笔开销的外币总额才能保存——
  // 跟"怎么分"/"花在几天"那两处的实时校验是同一套规矩
  const rateSplitValid = rateSelection.mode !== 'split' || Math.abs(numAmount - splitTotalForeign) < 0.01

  // 切到"自定义金额"模式时，先按平均分摊帮忙填一份起点，用户在这个基础上改，
  // 不用每次都从0开始手算
  function seedEqualCustomAmounts(ids: string[]) {
    if (!ids.length || !homeAmount) return
    const n = ids.length
    const base = Math.floor((homeAmount / n) * 100) / 100
    const remainder = Math.round((homeAmount - base * n) * 100) / 100
    const next: Record<string, string> = {}
    ids.forEach((id, i) => { next[id] = (i === 0 ? base + remainder : base).toFixed(2) })
    setCustomAmounts(next)
  }

  const customTotal = splitMemberIds.reduce((sum, id) => sum + (parseFloat(customAmounts[id] ?? '0') || 0), 0)
  const customDiff = Math.round((homeAmount - customTotal) * 100) / 100
  const usingExactSplit = mode === 'share' && splitMode === 'exact' && splitMemberIds.length >= 2
  const customValid = !usingExactSplit || Math.abs(customDiff) < 0.01

  // 跨天分摊：切到"每天自定义"、或者改了天数之后，都先按平均填一份当起点。
  // 天数一变总额就要重新分配，留着上一次手填的数字必然对不上账，不如重来一遍
  function seedEqualDayAmounts(dates: string[]) {
    if (!dates.length || !homeAmount) { setDayAmounts({}); return }
    const n = dates.length
    const base = Math.floor((homeAmount / n) * 100) / 100
    const remainder = Math.round((homeAmount - base * n) * 100) / 100
    const next: Record<string, string> = {}
    dates.forEach((d, i) => { next[d] = (i === 0 ? base + remainder : base).toFixed(2) })
    setDayAmounts(next)
  }

  function toggleSpreadDate(date: string) {
    const cur = spreadDatesRef.current
    const next = cur.includes(date)
      ? cur.filter((d) => d !== date)
      : [...cur, date].sort((a, b) => a.localeCompare(b))
    spreadDatesRef.current = next
    setSpreadDates(next)
    if (dayMode === 'exact') seedEqualDayAmounts(next)
  }

  const evenDayShare = spreadDates.length ? homeAmount / spreadDates.length : 0
  const dayTotal = spreadDates.reduce((sum, d) => sum + (parseFloat(dayAmounts[d] ?? '0') || 0), 0)
  const dayDiff = Math.round((homeAmount - dayTotal) * 100) / 100
  const usingExactDays = spreadOpen && dayMode === 'exact' && spreadDates.length > 0
  const daysValid = !spreadOpen || (spreadDates.length > 0 && (!usingExactDays || Math.abs(dayDiff) < 0.01))

  // 防止快速连续点两下"保存"/"删除"触发两次并发的写操作——之前这两个函数
  // 没有任何防抖手段，纯靠"手气好没人真的点这么快"撑着
  const [saving, setSaving] = useState(false)

  // 保存成功后先闪一下"已记下"再关闭。之前保存完 sheet 直接消失，动作和结果之间
  // 没有任何确认——记账是这个APP里最高频的操作，值得有一个明确的"成交"信号
  const [saved, setSaved] = useState(false)

  async function save() {
    if (saving || !numAmount || !categoryId || !rateReady || !rateSplitValid || !customValid || !daysValid) return
    setSaving(true)
    try {
      await doSave()
    } finally {
      setSaving(false)
    }
  }

  async function doSave() {
    // 只有用户真的选了某一天才落地 itineraryDay（哪怕时间线里还没手动建过这一天）；
    // 没打开"关联到行程"这个环节，或者打开了但没选具体日期，就是不关联
    let itineraryDayId: string | null = null
    if (linkOpen && linkDate) {
      const day = await ensureItineraryDay(trip.id, linkDate)
      itineraryDayId = day.id
    }
    const itineraryItemId = itineraryDayId ? linkItemId : null

    // 汇率簿落地：选了已有chip就更新它的"最近使用"；填了新标签就先落一条新纪录；
    // 拆多笔汇率时 rateBookEntryId 置空，改由 expenseRateAllocations 记录具体拆法，
    // 每一批用到的条目都要更新"最近使用"（不只是单选时的那一个）
    let rateBookEntryId: string | null = initial?.rateBookEntryId ?? null
    const rateSpread = isForeign && rateSelection.mode === 'split'
    if (isForeign) {
      if (rateSelection.mode === 'existing') {
        rateBookEntryId = rateSelection.entryId
        // 只有这笔账"新用上"这个汇率条目才更新"最近使用"——编辑已有账目、汇率
        // 没变又点了保存，不该刷新时间；"用过几次"不靠这里累加，是现查现算的
        // （见 usageByEntry），这里只负责 lastUsedAt 排序用
        if (!initial || initial.rateBookEntryId !== rateSelection.entryId) {
          await recordRateUsage(rateSelection.entryId)
        }
      } else if (rateSelection.mode === 'new') {
        const entry = await createRateBookEntry({
          tripId: trip.id,
          foreignCurrency: currency,
          label: rateSelection.label,
          rate: rateSelection.rate,
          source: rateSelection.source,
          createdBy: currentMemberId,
          exchangedHomeAmount: rateSelection.exchangedHomeAmount,
          exchangedForeignAmount: rateSelection.exchangedForeignAmount,
        })
        rateBookEntryId = entry.id
      } else if (rateSelection.mode === 'split') {
        rateBookEntryId = null
        await Promise.all(rateSelection.allocations.map((a) => recordRateUsage(a.rateBookEntryId)))
      }
    } else {
      rateBookEntryId = null
    }

    // 分摊名单里有人（哪怕只有1个，且哪怕那个人不是付款人）就算有分摊记录；
    // 干脆没勾任何人（"个人开销"模式）才是真正的不分摊。之前用">= 2"判断会把
    // "只勾1个非付款人"也归到"不分摊"，导致这笔钱被错记成付款人自己的开销，
    // 分摊对象欠的钱凭空消失——也让编辑时这笔账会被误判回"个人开销"页签
    const splitType: SplitType = splitMemberIds.length === 0 ? 'none' : usingExactSplit ? 'exact' : 'equal'
    const customAmountsForSave = usingExactSplit
      ? Object.fromEntries(splitMemberIds.map((id) => [id, parseFloat(customAmounts[id] ?? '0') || 0]))
      : undefined
    const expenseId = initial?.id ?? crypto.randomUUID()
    const daySpreadMode: DaySpreadMode | null = spreadOpen && spreadDates.length ? dayMode : null

    if (initial) {
      await db.expenses.update(initial.id, {
        categoryId,
        phase,
        description: description.trim() || null,
        expenseCurrency: currency,
        expenseAmount: numAmount,
        rateBookEntryId,
        rateUsed: numRate,
        homeAmount,
        paidBy: payer,
        expenseDate,
        itineraryDayId,
        itineraryItemId,
        splitType,
        daySpreadMode,
        rateSpread,
        updatedAt: Date.now(),
      })
    } else {
      const householdId = await getCurrentHouseholdId()
      if (!householdId) return
      const id = expenseId
      const now = Date.now()
      await db.expenses.add({
        id,
        householdId,
        tripId: trip.id,
        categoryId,
        phase,
        description: description.trim() || null,
        expenseCurrency: currency,
        expenseAmount: numAmount,
        rateBookEntryId,
        rateUsed: numRate,
        homeAmount,
        paidBy: payer,
        recordedBy: currentMemberId,
        expenseDate,
        itineraryDayId,
        itineraryItemId,
        splitType,
        daySpreadMode,
        rateSpread,
        createdAt: now,
        updatedAt: now,
      })
    }

    await saveExpenseSplits(expenseId, homeAmount, splitType, splitMemberIds, payer, customAmountsForSave)

    // 从"跨多天"改回"单日"时要把旧的每日分摊清掉，否则那几天的当日花费
    // 会一直算着一笔已经不该分摊过去的钱
    if (daySpreadMode) {
      const dayAmountsForSave = dayMode === 'exact'
        ? Object.fromEntries(spreadDates.map((d) => [d, parseFloat(dayAmounts[d] ?? '0') || 0]))
        : undefined
      await saveDayAllocations(expenseId, trip.id, homeAmount, daySpreadMode, spreadDates, dayAmountsForSave)
    } else {
      await deleteDayAllocations(expenseId)
    }

    // 同理，从"拆多笔汇率"改回单一汇率时把旧的拆分行清掉
    if (rateSpread && rateSelection.mode === 'split') {
      await saveRateAllocations(expenseId, trip.id, rateSelection.allocations)
    } else {
      await deleteRateAllocations(expenseId)
    }
    // 数据已经落地了，这里只是让确认态露个脸再收起来。刻意短（约0.6秒）——
    // 再长就从"确认"变成"挡路"了
    setSaved(true)
    setTimeout(onClose, 600)
  }

  const [confirmingDelete, setConfirmingDelete] = useState(false)

  async function remove() {
    if (saving || !initial || settled) return
    setSaving(true)
    try {
      await db.expenseSplits.where('expenseId').equals(initial.id).delete()
      await deleteDayAllocations(initial.id)
      await deleteRateAllocations(initial.id)
      await db.expenses.delete(initial.id)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  // 嵌套的 ConfirmDialog（confirmingDelete）打开时暂停这里自己的Escape监听。
  // 在子页（activeDetail 不为null）时 Escape 先退一层子页，而不是直接关掉整个页面——
  // 这只是本地状态切换，不涉及浏览器历史，所以可以比安卓硬件返回键（由上层
  // TripShell 统一处理，语义是"关掉整个记账页"）更精细一层
  useEscapeKey(!confirmingDelete, () => {
    if (activeDetail) { setActiveDetail(null); return }
    onClose()
  })

  if (saved) {
    return (
      <div className="absolute inset-0 z-30 flex items-center justify-center bg-scrim/35">
        <div className="pop-in bg-card rounded-3xl px-7 py-6 flex flex-col items-center gap-2 shadow-2xl">
          <Check className="w-9 h-9 text-positive" strokeWidth={2.2} />
          <div className="text-[13.5px] text-ink">已记下</div>
        </div>
      </div>
    )
  }

  const canSave = !saving && !!numAmount && !!categoryId && rateReady && rateSplitValid && customValid && daysValid

  const payerName = members.find((m) => m.id === payer)?.displayName ?? '付款人'
  const splitSummary = mode === 'personal'
    ? `${payerName}的个人开销`
    : splitMemberIds.length === 0
      ? '未选择分摊对象'
      : `${payerName}垫付 · ${splitMemberIds.length}人${splitMode === 'exact' && splitMemberIds.length >= 2 ? '自定义' : '平均'}分摊`
  const daysSummary = !spreadOpen || !spreadDates.length ? '单日' : `跨${spreadDates.length}天${dayMode === 'exact' ? ' · 自定义' : ''}`
  const foldSummary = [
    phase === 'pre_trip' ? '出行前' : '途中',
    expenseDate === todayISO ? '今天' : expenseDate.slice(5),
    splitSummary,
    spreadOpen && spreadDates.length ? daysSummary : null,
    linkOpen && linkDate ? '已关联行程' : null,
  ].filter(Boolean).join(' · ')

  return (
    <>
    <BottomSheet onClose={onClose} cardClassName="relative pt-3.5 max-h-[90%] flex flex-col overflow-hidden">
          <div className="w-[38px] h-1 rounded-full bg-handle mx-auto mb-1 flex-shrink-0" />
          <div className="flex items-center justify-between px-4 pb-2.5 border-b border-line flex-shrink-0">
            <button onClick={onClose} className="text-muted text-[12.5px]">取消</button>
            <span className="font-serif-sc text-[13.5px] font-semibold">{initial ? '编辑这笔' : '记一笔'}</span>
            <div className="flex items-center gap-4">
              {initial && (
                <button
                  onClick={() => setConfirmingDelete(true)}
                  disabled={saving || settled}
                  className="text-negative/85 disabled:opacity-40"
                  title={settled ? '这笔账已经结算过，不能删除' : '删除'}
                >
                  <Trash2 className="w-[17px] h-[17px]" strokeWidth={1.8} />
                </button>
              )}
              <button
                onClick={save}
                disabled={!canSave}
                className="text-plan text-[12.5px] font-semibold disabled:opacity-40"
              >
                保存
              </button>
            </div>
          </div>

          <div className="overflow-y-auto no-scrollbar px-4 py-3">
            {settled && (
          <div className="flex items-center gap-2 rounded-xl bg-plan/8 text-plan px-3 py-2 text-[11.5px] mb-2.5">
            <Lock className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.8} />
            这笔账已经结算过，金额、汇率、怎么分、付款人都不能再改，也不能删除
          </div>
        )}
        <div className="grid grid-cols-[1fr_84px] gap-2 rounded-2xl border-[1.5px] border-plan bg-card px-3.5 py-2.5">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="金额"
            autoFocus={!initial}
            disabled={settled}
            className="text-[26px] font-serif-sc tabular outline-none min-w-0 bg-transparent disabled:opacity-60"
          />
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            placeholder="币种"
            disabled={settled}
            className="rounded-lg border border-line bg-paper px-2 text-sm text-center uppercase outline-none focus:border-plan min-w-0 self-center disabled:opacity-60"
          />
        </div>

        {isForeign && (
          <div className={`mt-2 ${settled ? 'pointer-events-none opacity-60' : ''}`}>
            <div className="text-[10.5px] tracking-widest uppercase text-muted mb-1">
              选择汇率（{currency} → {trip.homeCurrency}）
            </div>
            <RateChipRow
              tripId={trip.id}
              currency={currency}
              homeCurrency={trip.homeCurrency}
              expenseAmount={numAmount}
              value={rateSelection}
              onChange={setRateSelection}
            />
            {(rateSelection.mode !== 'split' || rateSplitValid) && (
              <div className="text-[11px] text-muted mt-1.5">
                {numRate > 0 ? <>≈ {trip.homeCurrency} {homeAmount.toFixed(2)}</> : '请选择或新增一个汇率'}
              </div>
            )}
          </div>
        )}

        <div className="text-[10.5px] tracking-widest uppercase text-muted mt-3 mb-1">分类</div>
        <div className="flex flex-wrap gap-1.5">
          {visibleCategories.map((c) => {
            const color = categoryColor(c)
            const selected = categoryId === c.id
            return (
              <button
                key={c.id}
                onClick={() => setCategoryId(c.id)}
                className="flex items-center gap-1.5 rounded-[11px] pl-1.5 pr-3 py-1.5 text-[12.5px] border"
                style={
                  selected
                    ? { borderColor: color, background: `color-mix(in srgb, ${color} 11%, var(--color-card))`, color, fontWeight: 600 }
                    : { background: 'var(--color-card)', borderColor: 'var(--color-line)', color: 'var(--color-soft)' }
                }
              >
                <span
                  className="text-card flex items-center justify-center flex-shrink-0"
                  style={{ background: color, width: 24, height: 24, borderRadius: 7 }}
                >
                  <CategoryIcon category={c} size={13} />
                </span>
                {c.name}
              </button>
            )
          })}
        </div>

        <div className="text-[10.5px] tracking-widest uppercase text-muted mt-3 mb-1">其他设置</div>
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 rounded-xl border border-dashed border-line bg-plan/[0.04] px-3.5 py-2.5 text-left"
        >
          <span className="text-[12px] text-soft min-w-0 truncate">{foldSummary}</span>
          <span className="text-[11.5px] font-semibold text-plan flex-shrink-0">{detailsOpen ? '收起 ‹' : '改 ›'}</span>
        </button>

        {detailsOpen && (
          <>
            <div className="text-[10.5px] tracking-widest uppercase text-muted mt-3 mb-1">阶段</div>
            <div className="flex gap-1 bg-segment rounded-xl p-1 w-fit">
              {(['pre_trip', 'during_trip'] as ExpensePhase[]).map((p) => (
                <button
                  key={p}
                  onClick={() => { setPhase(p); setCategoryId('') }}
                  className={`rounded-lg px-3 py-1.5 text-[12.5px] ${phase === p ? 'bg-ink text-paper' : 'text-muted'}`}
                >
                  {p === 'pre_trip' ? '出行前' : '途中'}
                </button>
              ))}
            </div>

            <div className="text-[10.5px] tracking-widest uppercase text-muted mt-3 mb-1">日期</div>
            <DatePicker value={expenseDate} onChange={setExpenseDate} />

            <div className="text-[10.5px] tracking-widest uppercase text-muted mt-3 mb-1">备注</div>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="备注（可选）"
              className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm outline-none focus:border-plan"
            />

            <div className="text-[10.5px] tracking-widest uppercase text-muted mt-3 mb-1">付款人</div>
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setPayer(m.id)}
                  disabled={settled}
                  className={`flex items-center gap-1.5 rounded-full pl-1.5 pr-3.5 py-1.5 text-[12.5px] border disabled:opacity-60 ${
                    payer === m.id ? 'bg-ink text-paper border-ink' : 'bg-card border-line text-soft'
                  }`}
                >
                  <Avatar member={m} size={20} />
                  {m.displayName}垫付
                </button>
              ))}
            </div>

            {tripDates.length > 0 && (
              <div className="mt-3">
                <div className="text-[10.5px] tracking-widest uppercase text-muted mb-1">关联行程</div>
                {!linkOpen ? (
                  <button
                    type="button"
                    onClick={() => setLinkOpen(true)}
                    className="text-[12px] text-plan"
                  >
                    关联到行程里的某天/某个行程项（可选）
                  </button>
                ) : (
                  <div className="bg-card border border-line rounded-xl p-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10.5px] tracking-widest uppercase text-muted">关联到行程</span>
                      <button
                        type="button"
                        onClick={() => { setLinkOpen(false); setLinkDate(''); setLinkItemId(null) }}
                        className="text-[11px] text-muted"
                      >
                        不关联
                      </button>
                    </div>
                    <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
                      {tripDates.map((d) => {
                        const num = d.slice(-2).replace(/^0/, '')
                        const isActive = d === linkDate
                        return (
                          <button
                            type="button"
                            key={d}
                            onClick={() => { setLinkDate(d); setLinkItemId(null) }}
                            className={`flex-shrink-0 rounded-lg px-2.5 py-1.5 text-[11.5px] tabular border ${
                              isActive ? 'bg-ink text-paper border-ink' : 'bg-paper border-line text-soft'
                            }`}
                          >
                            {num}日
                          </button>
                        )
                      })}
                    </div>
                    {linkDate && (() => {
                      const day = itineraryDays.find((d) => d.date === linkDate)
                      const dayItems = day ? itineraryItems.filter((it) => it.dayId === day.id) : []
                      if (!dayItems.length) {
                        return <div className="text-[11px] text-muted mt-1.5">这天还没有行程项，只会挂到「这一天」</div>
                      }
                      return (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          <button
                            type="button"
                            onClick={() => setLinkItemId(null)}
                            className={`rounded-full px-2.5 py-1 text-[11px] border ${
                              !linkItemId ? 'bg-plan text-card border-plan' : 'bg-paper border-line text-soft'
                            }`}
                          >
                            只挂到这一天
                          </button>
                          {dayItems.map((it) => (
                            <button
                              type="button"
                              key={it.id}
                              onClick={() => setLinkItemId(it.id)}
                              className={`rounded-full px-2.5 py-1 text-[11px] border ${
                                linkItemId === it.id ? 'bg-plan text-card border-plan' : 'bg-paper border-line text-soft'
                              }`}
                            >
                              {it.title}
                            </button>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            )}

            <div className="text-[10.5px] tracking-widest uppercase text-muted mt-3 mb-1">详情</div>
            <div className="border border-line bg-card rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setActiveDetail('split')}
                disabled={settled}
                className="w-full flex items-center justify-between px-3.5 py-2.5 border-b border-line text-left disabled:opacity-60"
              >
                <span className="text-[12.5px] text-muted">怎么分</span>
                <span className="text-[12.5px] flex items-center gap-1">
                  {splitSummary}
                  {!settled && <ChevronRight className="w-3.5 h-3.5 text-muted" strokeWidth={1.8} />}
                </span>
              </button>
              {tripDates.length > 1 && (
                <button
                  type="button"
                  onClick={() => setActiveDetail('days')}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 text-left"
                >
                  <span className="text-[12.5px] text-muted">花在几天</span>
                  <span className="text-[12.5px] flex items-center gap-1">
                    {daysSummary}
                    <ChevronRight className="w-3.5 h-3.5 text-muted" strokeWidth={1.8} />
                  </span>
                </button>
              )}
            </div>
          </>
        )}
          </div>
    </BottomSheet>

      {activeDetail === 'split' && (
        <div className="absolute inset-0 z-10 bg-paper flex flex-col">
          <div className="flex items-center gap-3 px-4 pt-safe-header pb-2.5 border-b border-line flex-shrink-0">
            <button onClick={() => setActiveDetail(null)} className="flex items-center gap-0.5 text-muted text-[12.5px]">
              <ChevronLeft className="w-4 h-4" strokeWidth={2} />
              返回
            </button>
            <span className="font-serif-sc text-[13.5px] font-semibold flex-1 text-center pr-10">这笔怎么算</span>
          </div>

          <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-3">
            <div className="text-[10.5px] tracking-widest uppercase text-muted mb-1">这笔怎么算</div>
            <div className="flex border border-line rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => { setMode('share'); setSplitMemberIds(members.map((m) => m.id)) }}
                className={`flex-1 py-2 text-[12.5px] ${mode === 'share' ? 'bg-plan text-card font-medium' : 'text-muted'}`}
              >
                大家分摊
              </button>
              <button
                type="button"
                onClick={() => { setMode('personal'); setSplitMemberIds([]) }}
                className={`flex-1 py-2 text-[12.5px] ${mode === 'personal' ? 'bg-plan text-card font-medium' : 'text-muted'}`}
              >
                个人开销
              </button>
            </div>

            {mode === 'share' ? (
              <>
                <div className="flex items-center justify-between mt-3 mb-1">
                  <span className="text-[10.5px] tracking-widest uppercase text-muted">
                    分摊给{splitMemberIds.length >= 2 && splitMode === 'equal' ? `（各 ${homeAmount ? (homeAmount / splitMemberIds.length).toFixed(2) : '0.00'}）` : ''}
                  </span>
                  {splitMemberIds.length !== members.length && (
                    <button
                      type="button"
                      onClick={() => setSplitMemberIds(members.map((m) => m.id))}
                      className="text-plan"
                      title="全选"
                    >
                      <CheckCheck className="w-[15px] h-[15px]" strokeWidth={1.8} />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {members.map((m) => {
                    const checked = splitMemberIds.includes(m.id)
                    return (
                      <button
                        type="button"
                        key={m.id}
                        onClick={() =>
                          setSplitMemberIds((prev) => (checked ? prev.filter((id) => id !== m.id) : [...prev, m.id]))
                        }
                        className={`flex items-center gap-1.5 rounded-full pl-1.5 pr-3.5 py-1.5 text-[12.5px] border ${
                          checked ? 'bg-plan/10 border-plan text-plan font-medium' : 'bg-card border-line text-soft'
                        }`}
                      >
                        <Avatar member={m} size={20} />
                        {m.displayName} {checked ? '✓' : ''}
                      </button>
                    )
                  })}
                </div>
                {splitMemberIds.length === 1 && (
                  <div className="text-[11px] text-muted mt-1">只勾了一个人 = 算这个人自己的，不分摊</div>
                )}

                {splitMemberIds.length >= 2 && (
                  <>
                    <div className="flex border border-line rounded-xl overflow-hidden mt-2.5">
                      <button
                        type="button"
                        onClick={() => setSplitMode('equal')}
                        className={`flex-1 py-1.5 text-[12px] ${splitMode === 'equal' ? 'bg-ink text-paper font-medium' : 'text-muted'}`}
                      >
                        平均分摊
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSplitMode('exact'); seedEqualCustomAmounts(splitMemberIds) }}
                        className={`flex-1 py-1.5 text-[12px] ${splitMode === 'exact' ? 'bg-ink text-paper font-medium' : 'text-muted'}`}
                      >
                        自定义金额
                      </button>
                    </div>

                    {splitMode === 'exact' && (
                      <div className="mt-2 flex flex-col gap-1.5">
                        {splitMemberIds.map((id) => {
                          const m = members.find((mm) => mm.id === id)
                          if (!m) return null
                          return (
                            <div key={id} className="flex items-center gap-2 bg-card border border-line rounded-xl px-3 py-2">
                              <Avatar member={m} size={20} />
                              <span className="text-[12.5px] flex-1">{m.displayName}</span>
                              <input
                                value={customAmounts[id] ?? ''}
                                onChange={(e) => setCustomAmounts((prev) => ({ ...prev, [id]: e.target.value }))}
                                inputMode="decimal"
                                placeholder="0.00"
                                className="w-[80px] text-right rounded-lg border border-line bg-paper px-2 py-1 text-[12.5px] tabular outline-none focus:border-plan"
                              />
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 mt-3 text-[12px] text-muted bg-card border border-dashed border-line rounded-xl px-3 py-2.5">
                <Avatar member={members.find((m) => m.id === payer)} size={20} />
                这笔算{payerName}自己的开销，不会出现在"分账"的结算里。
              </div>
            )}
          </div>

          {usingExactSplit && (
            <div className={`flex-shrink-0 px-4 py-2.5 border-t border-line text-[12px] ${customValid ? 'text-positive' : 'text-negative'}`}>
              {Math.abs(customDiff) < 0.01
                ? '刚好分完 ✓'
                : customDiff > 0
                  ? `还剩 ${customDiff.toFixed(2)} 没分完`
                  : `超出了 ${Math.abs(customDiff).toFixed(2)}`}
            </div>
          )}
        </div>
      )}

      {activeDetail === 'days' && (
        <div className="absolute inset-0 z-10 bg-paper flex flex-col">
          <div className="flex items-center gap-3 px-4 pt-safe-header pb-2.5 border-b border-line flex-shrink-0">
            <button onClick={() => setActiveDetail(null)} className="flex items-center gap-0.5 text-muted text-[12.5px]">
              <ChevronLeft className="w-4 h-4" strokeWidth={2} />
              返回
            </button>
            <span className="font-serif-sc text-[13.5px] font-semibold flex-1 text-center pr-10">花在几天里</span>
          </div>

          <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-3">
            <div className="flex border border-line rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => { setSpreadOpen(false); spreadDatesRef.current = []; setSpreadDates([]); setDayAmounts({}) }}
                className={`flex-1 py-2 text-[12.5px] ${!spreadOpen ? 'bg-plan text-card font-medium' : 'text-muted'}`}
              >
                单日
              </button>
              <button
                type="button"
                onClick={() => setSpreadOpen(true)}
                className={`flex-1 py-2 text-[12.5px] ${spreadOpen ? 'bg-plan text-card font-medium' : 'text-muted'}`}
              >
                跨多天
              </button>
            </div>

            {!spreadOpen ? (
              <div className="text-[11px] text-muted mt-1">整笔算在这一天的「当日花费」里</div>
            ) : (
              <>
                <div className="text-[10.5px] tracking-widest uppercase text-muted mt-2.5 mb-1">摊到哪几天（可点选，不用连续）</div>
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
                  {tripDates.map((d) => {
                    const num = d.slice(-2).replace(/^0/, '')
                    const picked = spreadDates.includes(d)
                    return (
                      <button
                        type="button"
                        key={d}
                        onClick={() => toggleSpreadDate(d)}
                        className={`flex-shrink-0 rounded-lg px-2.5 py-1.5 text-[11.5px] tabular border ${
                          picked ? 'bg-plan/10 border-plan text-plan font-medium' : 'bg-card border-line text-soft'
                        }`}
                      >
                        {num}日
                      </button>
                    )
                  })}
                </div>

                {!spreadDates.length ? (
                  <div className="text-[11px] text-negative mt-1">至少要选一天</div>
                ) : (
                  <>
                    <div className="flex border border-line rounded-xl overflow-hidden mt-2">
                      <button
                        type="button"
                        onClick={() => setDayMode('equal')}
                        className={`flex-1 py-1.5 text-[12px] ${dayMode === 'equal' ? 'bg-ink text-paper font-medium' : 'text-muted'}`}
                      >
                        平均分到每天
                      </button>
                      <button
                        type="button"
                        onClick={() => { setDayMode('exact'); seedEqualDayAmounts(spreadDates) }}
                        className={`flex-1 py-1.5 text-[12px] ${dayMode === 'exact' ? 'bg-ink text-paper font-medium' : 'text-muted'}`}
                      >
                        每天自定义
                      </button>
                    </div>

                    {dayMode === 'equal' ? (
                      <div className="text-[11px] text-muted mt-1.5">
                        共 {spreadDates.length} 天，每天各 {evenDayShare.toFixed(2)}（除不尽的零头算在第一天）
                      </div>
                    ) : (
                      <div className="mt-2 flex flex-col gap-1.5">
                        {spreadDates.map((d) => (
                          <div key={d} className="flex items-center gap-2 bg-card border border-line rounded-xl px-3 py-2">
                            <span className="text-[12.5px] flex-1 tabular">{d}</span>
                            <input
                              value={dayAmounts[d] ?? ''}
                              onChange={(e) => setDayAmounts((prev) => ({ ...prev, [d]: e.target.value }))}
                              inputMode="decimal"
                              placeholder="0.00"
                              className="w-[80px] text-right rounded-lg border border-line bg-paper px-2 py-1 text-[12.5px] tabular outline-none focus:border-plan"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {usingExactDays && (
            <div className={`flex-shrink-0 px-4 py-2.5 border-t border-line text-[12px] ${Math.abs(dayDiff) < 0.01 ? 'text-positive' : 'text-negative'}`}>
              {Math.abs(dayDiff) < 0.01
                ? '刚好分完 ✓'
                : dayDiff > 0
                  ? `还剩 ${dayDiff.toFixed(2)} 没分完`
                  : `超出了 ${Math.abs(dayDiff).toFixed(2)}`}
            </div>
          )}
        </div>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="删除这笔记录？"
          onConfirm={remove}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </>
  )
}
