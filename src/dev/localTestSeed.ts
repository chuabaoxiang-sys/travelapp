import { db, withoutOutboxTracking } from '../db/dexie'
import { supabase } from '../api/supabaseClient'
import { resolveSplitShares } from '../domain/splits'
import { isLocalTestModeEnabled } from './localTestMode'
import type { Trip, Member, TripMember, ItineraryDay, ItineraryItem, Expense, ExpenseSplit, RateBookEntry, Budget } from '../types'

// 只在本地无Supabase的测试模式下、或者手动开了本地测试模式（登录页那个按钮）
// 时才会跑；额外加 import.meta.env.DEV 双重保险，万一将来生产环境意外没配好
// Supabase，也绝不会把假数据塞进真实用户的浏览器
const LOCAL_TEST_MARKER_ID = 'seed-member-dad'

// 为什么要有这份数据：之前好几个真实bug都是"干净的新数据测不出来、真实数据形状
// 才会暴露"——老行程缺新字段(publicShareScope那次)、矮屏幕手机、连续多天累积的
// 真实使用痕迹。每次现场手打一个全新行程没法复现这些，所以固定一份、可重复使用、
// 故意包含"老数据"和边界情况的种子数据，以后验证UI默认先用这份，不用现造。
// 用固定id而不是随机生成，配合下面的"已存在就跳过"检查，保证多次调用/热重载不会重复插入
export async function ensureLocalTestSeed() {
  if (!import.meta.env.DEV) return
  if (supabase && !isLocalTestModeEnabled()) return
  const existing = await db.members.get(LOCAL_TEST_MARKER_ID)
  if (existing) return

  const householdId = 'local-test-household'
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  const today = new Date()
  const isoDaysFromNow = (n: number) => {
    const d = new Date(today.getTime() + n * dayMs)
    return d.toISOString().slice(0, 10)
  }

  const members: Member[] = [
    { id: 'seed-member-dad', householdId, displayName: '爸爸', colorTag: 'blue', isActive: true, createdAt: now },
    { id: 'seed-member-mom', householdId, displayName: '妈妈', colorTag: 'pink', isActive: true, createdAt: now },
    { id: 'seed-member-kid', householdId, displayName: '大宝', colorTag: 'yellow', isActive: true, createdAt: now },
    // 已停用的成员——测试"停用成员不出现在选人名单里，但历史记账仍显示他"这条规则
    { id: 'seed-member-retired', householdId, displayName: '表哥（已退出）', colorTag: 'green', isActive: false, createdAt: now },
  ]

  // 行程一：当前进行中的完整行程——多天、多类别花费、汇率簿、预算、已开启分享
  const tripCurrent: Trip = {
    id: 'seed-trip-current',
    householdId,
    name: '东京5日家族游',
    homeCurrency: 'MYR',
    startDate: isoDaysFromNow(3),
    endDate: isoDaysFromNow(7),
    status: 'planning',
    publicShareScope: 'both',
    publicShareToken: 'seed-share-token-0000',
    publicShareTemplate: 'ticket',
    destinationCountries: ['jp'],
    createdAt: now,
    updatedAt: now,
  }

  // 行程二：故意模拟"schema变更之前"的老数据——不带 publicShareScope 等新字段，
  // 用来测试 effectiveShareScope() 这类兼容函数、以及任何新加字段的UI是否会在
  // 真实老数据上出错（这正是之前真的翻过车的那类bug）
  const tripLegacy = {
    id: 'seed-trip-legacy',
    householdId,
    name: '老挝行程（旧数据，无分享字段）',
    homeCurrency: 'MYR',
    startDate: isoDaysFromNow(-40),
    endDate: isoDaysFromNow(-35),
    status: 'completed',
    createdAt: now - 90 * dayMs,
    updatedAt: now - 90 * dayMs,
  } as unknown as Trip

  // 行程三：边界情况——只有1天、只有1个行程项且缺时间缺地点、没有任何花费记录
  // （测试空状态渲染 + 分享页面对"几乎什么都没有"的数据是否还能正常显示）
  const tripEdge: Trip = {
    id: 'seed-trip-edge',
    householdId,
    name: '周末临时决定的行程',
    homeCurrency: 'MYR',
    startDate: isoDaysFromNow(14),
    endDate: isoDaysFromNow(14),
    status: 'planning',
    publicShareScope: 'none',
    publicShareToken: null,
    publicShareTemplate: null,
    createdAt: now,
    updatedAt: now,
  }

  const trips = [tripCurrent, tripLegacy, tripEdge]

  const tripMembers: TripMember[] = [
    { id: 'seed-tm-1', tripId: tripCurrent.id, memberId: 'seed-member-dad' },
    { id: 'seed-tm-2', tripId: tripCurrent.id, memberId: 'seed-member-mom' },
    { id: 'seed-tm-3', tripId: tripCurrent.id, memberId: 'seed-member-kid' },
    // 老行程带着一个后来已停用的成员——测试历史记账里仍要显示这个人
    { id: 'seed-tm-4', tripId: tripLegacy.id, memberId: 'seed-member-dad' },
    { id: 'seed-tm-5', tripId: tripLegacy.id, memberId: 'seed-member-retired' },
  ]

  const currentDayDates = [0, 1, 2, 3, 4].map((n) => isoDaysFromNow(3 + n))
  const days: ItineraryDay[] = [
    { id: 'seed-day-1', householdId, tripId: tripCurrent.id, date: currentDayDates[0], title: '抵达 · 浅草老街', notes: null, createdAt: now, updatedAt: now },
    { id: 'seed-day-2', householdId, tripId: tripCurrent.id, date: currentDayDates[1], title: '上野 · 亲子一日', notes: null, createdAt: now, updatedAt: now },
    { id: 'seed-day-3', householdId, tripId: tripCurrent.id, date: currentDayDates[2], title: '箱根一日游', notes: null, createdAt: now, updatedAt: now },
    { id: 'seed-day-4', householdId, tripId: tripCurrent.id, date: currentDayDates[3], title: null, notes: null, createdAt: now, updatedAt: now },
    { id: 'seed-day-5', householdId, tripId: tripCurrent.id, date: currentDayDates[4], title: '秋叶原 · 返程', notes: null, createdAt: now, updatedAt: now },
    // 边界情况行程的唯一一天——刻意不给标题
    { id: 'seed-day-edge', householdId, tripId: tripEdge.id, date: tripEdge.startDate!, title: null, notes: null, createdAt: now, updatedAt: now },
  ]

  const items: ItineraryItem[] = [
    { id: 'seed-item-1', householdId, dayId: 'seed-day-1', tripId: tripCurrent.id, orderIndex: 0, time: '14:20', title: '成田机场T2抵达', locationName: '千叶县成田市', lat: 35.7647, lng: 140.3864, notes: null, createdBy: null, createdAt: now, updatedAt: now },
    { id: 'seed-item-2', householdId, dayId: 'seed-day-1', tripId: tripCurrent.id, orderIndex: 1, time: '16:40', title: '浅草寺 · 仲见世通', locationName: '东京都台东区浅草2-3-1', lat: 35.7148, lng: 139.7967, notes: null, createdBy: null, createdAt: now, updatedAt: now },
    { id: 'seed-item-3', householdId, dayId: 'seed-day-1', tripId: tripCurrent.id, orderIndex: 2, time: '19:00', title: '隅田川边晚餐', locationName: null, lat: null, lng: null, notes: null, createdBy: null, createdAt: now, updatedAt: now },
    { id: 'seed-item-4', householdId, dayId: 'seed-day-2', tripId: tripCurrent.id, orderIndex: 0, time: '09:30', title: '上野动物园', locationName: '东京都台东区上野公园9-83', lat: 35.7161, lng: 139.7712, notes: null, createdBy: null, createdAt: now, updatedAt: now },
    // 缺时间——测试"时间未定"这类边界渲染
    { id: 'seed-item-5', householdId, dayId: 'seed-day-2', tripId: tripCurrent.id, orderIndex: 1, time: null, title: '国立科学博物馆（时间未定）', locationName: '东京都台东区上野公园7-20', lat: 35.7166, lng: 139.7745, notes: null, createdBy: null, createdAt: now, updatedAt: now },
    { id: 'seed-item-6', householdId, dayId: 'seed-day-3', tripId: tripCurrent.id, orderIndex: 0, time: '07:50', title: '小田急浪漫特快', locationName: '新宿站3番线', lat: 35.6896, lng: 139.7006, notes: null, createdBy: null, createdAt: now, updatedAt: now },
    // 单独一个远距离地点——测试通勤提示的"超过3km只显示公里数"分支
    { id: 'seed-item-7', householdId, dayId: 'seed-day-3', tripId: tripCurrent.id, orderIndex: 1, time: '11:00', title: '大涌谷 · 黑蛋', locationName: '神奈川县足柄下郡箱根町', lat: 35.2333, lng: 139.0167, notes: null, createdBy: null, createdAt: now, updatedAt: now },
    // 边界情况行程的唯一一项——缺时间也缺地点，标题刻意很长测试折行
    { id: 'seed-item-edge', householdId, dayId: 'seed-day-edge', tripId: tripEdge.id, orderIndex: 0, time: null, title: '还没想好去哪，先占个位置提醒自己周末要出门走走透透气', locationName: null, lat: null, lng: null, notes: null, createdBy: null, createdAt: now, updatedAt: now },
  ]

  const rateBookEntries: RateBookEntry[] = [
    { id: 'seed-rate-1', householdId, tripId: tripCurrent.id, foreignCurrency: 'JPY', label: '出发前网上换的现金', rate: 0.0296, source: 'manual', createdBy: 'seed-member-dad', lastUsedAt: now, useCount: 3, archived: false, createdAt: now },
    { id: 'seed-rate-2', householdId, tripId: tripCurrent.id, foreignCurrency: 'JPY', label: '当地刷卡（银行汇率）', rate: 0.0301, source: 'api_accepted', createdBy: 'seed-member-mom', lastUsedAt: now, useCount: 1, archived: false, createdAt: now },
  ]

  const budgets: Budget[] = [
    { id: 'seed-budget-1', householdId, tripId: tripCurrent.id, categoryId: 'seed-cat-food', phase: 'during_trip', amount: 2000, alertThresholdPct: 80 },
    { id: 'seed-budget-2', householdId, tripId: tripCurrent.id, categoryId: 'seed-cat-stay-onsite', phase: 'during_trip', amount: 3500, alertThresholdPct: 90 },
  ]

  function makeExpense(
    idSuffix: string,
    tripId: string,
    categoryId: string,
    amount: number,
    paidBy: string,
    splitMemberIds: string[],
    splitType: 'none' | 'equal',
    itineraryDayId: string | null,
    expenseDate: string,
    description: string | null,
  ): { expense: Expense; splits: ExpenseSplit[] } {
    const expense: Expense = {
      id: `seed-exp-${idSuffix}`,
      householdId,
      tripId,
      categoryId,
      phase: 'during_trip',
      description,
      expenseCurrency: 'MYR',
      expenseAmount: amount,
      rateBookEntryId: null,
      rateUsed: 1,
      homeAmount: amount,
      paidBy,
      recordedBy: paidBy,
      expenseDate,
      itineraryDayId,
      itineraryItemId: null,
      splitType,
      createdAt: now,
      updatedAt: now,
    }
    const shares = resolveSplitShares(amount, splitType, splitMemberIds, paidBy)
    const splits: ExpenseSplit[] = shares.map((s, i) => ({
      id: `seed-split-${idSuffix}-${i}`,
      householdId,
      expenseId: expense.id,
      memberId: s.memberId,
      shareAmount: s.shareAmount,
    }))
    return { expense, splits }
  }

  const expenseRows = [
    makeExpense('1', tripCurrent.id, 'seed-cat-food', 380, 'seed-member-dad', ['seed-member-dad', 'seed-member-mom', 'seed-member-kid'], 'equal', 'seed-day-1', currentDayDates[0], '隅田川边晚餐'),
    makeExpense('2', tripCurrent.id, 'seed-cat-transport', 156, 'seed-member-mom', [], 'none', 'seed-day-1', currentDayDates[0], '机场快线车票'),
    makeExpense('3', tripCurrent.id, 'seed-cat-ticket', 220, 'seed-member-dad', ['seed-member-kid'], 'equal', 'seed-day-2', currentDayDates[1], '动物园门票（帮大宝垫付）'),
    makeExpense('4', tripCurrent.id, 'seed-cat-stay-onsite', 890, 'seed-member-mom', ['seed-member-dad', 'seed-member-mom', 'seed-member-kid'], 'equal', null, currentDayDates[2], '箱根温泉旅馆一晚'),
    // 老行程一笔历史账目——涉及已停用成员，测试"历史记录里仍要看到停用成员"
    makeExpense('legacy-1', tripLegacy.id, 'seed-cat-food', 95, 'seed-member-retired', ['seed-member-dad', 'seed-member-retired'], 'equal', null, isoDaysFromNow(-38), '路边摊晚餐（表哥请客）'),
  ]

  await withoutOutboxTracking(async () => {
    await db.members.bulkPut(members)
    await db.trips.bulkPut(trips)
    await db.tripMembers.bulkPut(tripMembers)
    await db.itineraryDays.bulkPut(days)
    await db.itineraryItems.bulkPut(items)
    await db.rateBookEntries.bulkPut(rateBookEntries)
    await db.budgets.bulkPut(budgets)
    await db.expenses.bulkPut(expenseRows.map((r) => r.expense))
    await db.expenseSplits.bulkPut(expenseRows.flatMap((r) => r.splits))
  })
}
