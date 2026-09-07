import { db, withoutOutboxTracking } from '../db/dexie'
import { supabase } from '../api/supabaseClient'
import { resolveSplitShares } from '../domain/splits'
import { isLocalTestModeEnabled } from './localTestMode'
import type { Trip, Member, TripMember, ItineraryDay, ItineraryItem, Expense, ExpenseSplit, RateBookEntry, Budget } from '../types'

// 只在本地无Supabase的测试模式下、或者手动开了本地测试模式（登录页那个按钮）
// 时才会跑；额外加 import.meta.env.DEV 双重保险，万一将来生产环境意外没配好
// Supabase，也绝不会把假数据塞进真实用户的浏览器
const LOCAL_TEST_MARKER_ID = 'seed-member-dad'

// 三趟行程分别对应"未出行/出行中/已回来"三种阶段——概览页的phase判断、
// 记账的pre_trip/during_trip阶段区分、旅程回顾，都需要真的处在对应阶段的
// 行程才能验证，不是随便造几条数据。日期全部用"相对今天"计算，不写死具体
// 日期——不然过几天再打开这份种子数据，"出行中"那趟可能已经变成"已回来"
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
    { id: 'seed-member-dad', householdId, displayName: '爸爸', colorTag: 'blue', isActive: true, preferredLocale: null, createdAt: now },
    { id: 'seed-member-mom', householdId, displayName: '妈妈', colorTag: 'pink', isActive: true, preferredLocale: null, createdAt: now },
    { id: 'seed-member-kid', householdId, displayName: '阿灰', colorTag: 'yellow', isActive: true, preferredLocale: null, createdAt: now },
    // 已停用的成员——不挂在任何一趟新行程下，单纯保留"停用成员不出现在选人
    // 名单里"这条规则的测试覆盖
    { id: 'seed-member-retired', householdId, displayName: '表哥（已退出）', colorTag: 'green', isActive: false, preferredLocale: null, createdAt: now },
  ]
  const DAD = 'seed-member-dad'
  const MOM = 'seed-member-mom'
  const KID = 'seed-member-kid'
  const FAMILY = [DAD, MOM, KID]

  // ---- 行程一：上海，7天6夜，未出行（出发日期在未来）----
  const shStart = 20
  const tripShanghai: Trip = {
    id: 'seed-trip-shanghai',
    householdId,
    name: '上海7天6夜家族游',
    homeCurrency: 'MYR',
    startDate: isoDaysFromNow(shStart),
    endDate: isoDaysFromNow(shStart + 6),
    status: 'planning',
    publicShareScope: 'none',
    publicShareToken: null,
    publicShareTemplate: null,
    destinationCountries: ['cn'],
    currencies: ['CNY'],
    createdAt: now,
    updatedAt: now,
  }

  // ---- 行程二：韩国首尔釜山，10天9夜，出行中（今天落在行程范围内）----
  const krStart = -5
  const tripKorea: Trip = {
    id: 'seed-trip-korea',
    householdId,
    name: '韩国首尔釜山10天9夜家族游',
    homeCurrency: 'MYR',
    startDate: isoDaysFromNow(krStart),
    endDate: isoDaysFromNow(krStart + 9),
    status: 'active',
    publicShareScope: 'both',
    publicShareToken: 'seed-share-token-korea',
    publicShareTemplate: 'editorial',
    destinationCountries: ['kr'],
    currencies: ['KRW'],
    createdAt: now,
    updatedAt: now,
  }

  // ---- 行程三：瑞士，14天13夜，已回来（起止日期都在过去）----
  const chStart = -60
  const tripSwitzerland: Trip = {
    id: 'seed-trip-switzerland',
    householdId,
    name: '瑞士14天13夜家族游',
    homeCurrency: 'MYR',
    startDate: isoDaysFromNow(chStart),
    endDate: isoDaysFromNow(chStart + 13),
    status: 'completed',
    publicShareScope: 'itinerary',
    publicShareToken: 'seed-share-token-switzerland',
    publicShareTemplate: 'collage',
    destinationCountries: ['ch'],
    currencies: ['CHF'],
    createdAt: now,
    updatedAt: now,
  }

  const trips = [tripShanghai, tripKorea, tripSwitzerland]

  const tripMembers: TripMember[] = trips.flatMap((t) =>
    FAMILY.map((memberId, i) => ({ id: `seed-tm-${t.id}-${i}`, tripId: t.id, memberId })),
  )

  // ---- 行程安排：每趟行程按"第几天"给一份真实地点，orderIndex按数组顺序自动算 ----
  type ItemSpec = { time: string | null; title: string; loc: string | null; lat: number | null; lng: number | null }
  type DaySpec = { n: number; title: string | null; items: ItemSpec[] }

  function buildDaysAndItems(prefix: string, tripId: string, startOffset: number, specs: DaySpec[]) {
    const days: ItineraryDay[] = []
    const items: ItineraryItem[] = []
    specs.forEach((spec) => {
      const dayId = `${prefix}-day-${spec.n}`
      days.push({
        id: dayId,
        householdId,
        tripId,
        date: isoDaysFromNow(startOffset + spec.n - 1),
        title: spec.title,
        notes: null,
        createdAt: now,
        updatedAt: now,
      })
      spec.items.forEach((it, idx) => {
        items.push({
          id: `${prefix}-item-${spec.n}-${idx}`,
          householdId,
          dayId,
          tripId,
          orderIndex: idx,
          time: it.time,
          title: it.title,
          locationName: it.loc,
          lat: it.lat,
          lng: it.lng,
          notes: null,
          createdBy: null,
          createdAt: now,
          updatedAt: now,
        })
      })
    })
    return { days, items }
  }

  const shanghaiDays: DaySpec[] = [
    { n: 1, title: '抵达 · 外滩夜色', items: [
      { time: '09:35', title: '浦东国际机场T2抵达', loc: '浦东国际机场', lat: 31.1443, lng: 121.8083 },
      { time: '19:30', title: '外滩夜景漫步', loc: '外滩', lat: 31.2397, lng: 121.4900 },
    ] },
    { n: 2, title: '南京路 · 豫园老城厢', items: [
      { time: '10:00', title: '南京路步行街', loc: '南京东路', lat: 31.2359, lng: 121.4813 },
      { time: '13:00', title: '豫园', loc: '豫园', lat: 31.2272, lng: 121.4919 },
      { time: '14:30', title: '城隍庙小吃', loc: '上海城隍庙', lat: 31.2265, lng: 121.4923 },
    ] },
    { n: 3, title: '上海迪士尼乐园', items: [
      { time: '08:30', title: '上海迪士尼乐园', loc: '上海迪士尼乐园', lat: 31.1443, lng: 121.6569 },
      { time: '20:00', title: '烟火表演', loc: '上海迪士尼乐园', lat: 31.1443, lng: 121.6569 },
    ] },
    { n: 4, title: '田子坊 · 新天地 · 上海博物馆', items: [
      { time: '10:00', title: '上海博物馆（人民广场馆）', loc: '人民大道201号', lat: 31.2286, lng: 121.4757 },
      { time: '14:00', title: '田子坊', loc: '泰康路210弄', lat: 31.2093, lng: 121.4661 },
      { time: '18:30', title: '新天地晚餐', loc: '新天地', lat: 31.2204, lng: 121.4737 },
    ] },
    { n: 5, title: '朱家角古镇一日游', items: [
      { time: '09:00', title: '朱家角古镇', loc: '朱家角古镇', lat: 31.1114, lng: 121.0538 },
    ] },
    { n: 6, title: '静安寺 · 上海中心 · 购物', items: [
      { time: '10:00', title: '静安寺', loc: '静安寺', lat: 31.2238, lng: 121.4448 },
      { time: '14:00', title: '上海中心大厦观光厅', loc: '上海中心大厦', lat: 31.2354, lng: 121.5015 },
      { time: '17:00', title: '恒隆广场购物', loc: null, lat: null, lng: null },
    ] },
    { n: 7, title: '虹桥 · 返程', items: [
      { time: '11:00', title: '虹桥火车站', loc: '上海虹桥站', lat: 31.1946, lng: 121.3208 },
      { time: '15:40', title: '浦东机场返程航班', loc: '浦东国际机场', lat: 31.1443, lng: 121.8083 },
    ] },
  ]

  const koreaDays: DaySpec[] = [
    { n: 1, title: '抵达仁川 · 明洞', items: [
      { time: '14:10', title: '仁川国际机场抵达', loc: '仁川国际机场', lat: 37.4602, lng: 126.4407 },
      { time: '18:00', title: '明洞晚餐 + 逛街', loc: '明洞', lat: 37.5636, lng: 126.9834 },
    ] },
    { n: 2, title: '景福宫 · 北村韩屋村', items: [
      { time: '09:30', title: '景福宫', loc: '景福宫', lat: 37.5796, lng: 126.9770 },
      { time: '13:00', title: '北村韩屋村', loc: '北村韩屋村', lat: 37.5826, lng: 126.9831 },
    ] },
    { n: 3, title: '弘大 · 东大门', items: [
      { time: '11:00', title: '弘大逛街', loc: '弘大', lat: 37.5563, lng: 126.9236 },
      { time: '20:00', title: '东大门购物夜市', loc: '东大门', lat: 37.5663, lng: 127.0092 },
    ] },
    { n: 4, title: '南山首尔塔 · 梨泰院', items: [
      { time: '15:00', title: '南山首尔塔', loc: '南山首尔塔', lat: 37.5512, lng: 126.9882 },
      { time: '18:30', title: '梨泰院晚餐', loc: '梨泰院', lat: 37.5344, lng: 126.9946 },
    ] },
    { n: 5, title: '汉江公园 · 自由活动', items: [
      { time: '11:00', title: '汉江公园野餐', loc: '汉江公园', lat: 37.5285, lng: 126.9327 },
    ] },
    { n: 6, title: '首尔 → 釜山（KTX）', items: [
      { time: '09:00', title: '首尔站搭乘KTX', loc: '首尔站', lat: 37.5547, lng: 126.9707 },
      { time: '12:30', title: '釜山站抵达', loc: '釜山站', lat: 35.1152, lng: 129.0403 },
      { time: '19:00', title: '西面晚餐', loc: '西面', lat: 35.1580, lng: 129.0597 },
    ] },
    { n: 7, title: '海云台', items: [
      { time: '10:00', title: '海云台海水浴场', loc: '海云台海水浴场', lat: 35.1587, lng: 129.1604 },
    ] },
    { n: 8, title: '甘川洞 · 札嘎其市场', items: [
      { time: '10:00', title: '甘川洞文化村', loc: '甘川洞文化村', lat: 35.0975, lng: 129.0106 },
      { time: '15:00', title: '札嘎其市场', loc: '札嘎其市场', lat: 35.0968, lng: 129.0306 },
    ] },
    { n: 9, title: '太宗台 · 广安里', items: [
      { time: '10:00', title: '太宗台', loc: '太宗台', lat: 35.0508, lng: 129.0866 },
      { time: '19:00', title: '广安里海滩夜景', loc: '广安里海滩', lat: 35.1532, lng: 129.1187 },
    ] },
    { n: 10, title: '釜山塔 · 返程', items: [
      { time: '10:00', title: '釜山塔 · 龙头山公园', loc: '龙头山公园', lat: 35.1007, lng: 129.0322 },
      { time: '15:30', title: '金海机场返程', loc: '金海国际机场', lat: 35.1795, lng: 128.9382 },
    ] },
  ]

  const switzerlandDays: DaySpec[] = [
    { n: 1, title: '抵达苏黎世 · 老城', items: [
      { time: '13:20', title: '苏黎世机场抵达', loc: '苏黎世机场', lat: 47.4647, lng: 8.5492 },
      { time: '16:00', title: '班霍夫大街漫步', loc: '班霍夫大街', lat: 47.3769, lng: 8.5417 },
    ] },
    { n: 2, title: '苏黎世湖 · 自由活动', items: [
      { time: '10:00', title: '苏黎世湖游船', loc: '苏黎世湖', lat: 47.3600, lng: 8.5450 },
    ] },
    { n: 3, title: '火车前往卢塞恩', items: [
      { time: '09:00', title: '苏黎世中央车站出发', loc: '苏黎世中央车站', lat: 47.3782, lng: 8.5401 },
      { time: '11:00', title: '卡佩尔廊桥', loc: '卡佩尔廊桥', lat: 47.0505, lng: 8.3064 },
      { time: '14:00', title: '琉森湖游船', loc: '琉森湖', lat: 47.0500, lng: 8.3000 },
    ] },
    { n: 4, title: '皮拉图斯山', items: [
      { time: '09:30', title: '皮拉图斯山缆车', loc: '皮拉图斯山', lat: 46.9789, lng: 8.2536 },
    ] },
    { n: 5, title: '因特拉肯', items: [
      { time: '11:00', title: '因特拉肯小镇', loc: '因特拉肯', lat: 46.6863, lng: 7.8632 },
    ] },
    { n: 6, title: '格林德瓦', items: [
      { time: '10:00', title: '格林德瓦缆车 + 午餐', loc: '格林德瓦', lat: 46.6244, lng: 8.0414 },
    ] },
    { n: 7, title: '少女峰全日游', items: [
      { time: '08:00', title: '少女峰铁路（Kleine Scheidegg出发）', loc: 'Kleine Scheidegg', lat: 46.5850, lng: 7.9636 },
      { time: '11:00', title: '少女峰观景台 Top of Europe', loc: '少女峰', lat: 46.5369, lng: 7.9628 },
    ] },
    { n: 8, title: '采尔马特', items: [
      { time: '12:00', title: '采尔马特小镇', loc: '采尔马特', lat: 46.0207, lng: 7.7491 },
    ] },
    { n: 9, title: 'Gornergrat观马特洪峰', items: [
      { time: '08:30', title: 'Gornergrat观景台', loc: 'Gornergrat', lat: 45.9847, lng: 7.7864 },
    ] },
    { n: 10, title: '蒙特勒', items: [
      { time: '11:00', title: '西庸城堡', loc: '西庸城堡', lat: 46.4142, lng: 6.9270 },
      { time: '15:00', title: '蒙特勒湖滨漫步', loc: '蒙特勒', lat: 46.4312, lng: 6.9107 },
    ] },
    { n: 11, title: '日内瓦', items: [
      { time: '10:00', title: '日内瓦大喷泉', loc: 'Jet d’Eau', lat: 46.2058, lng: 6.1567 },
      { time: '14:00', title: '日内瓦老城', loc: '日内瓦老城', lat: 46.2017, lng: 6.1466 },
    ] },
    { n: 12, title: '伯尔尼', items: [
      { time: '10:00', title: '伯尔尼老城', loc: '伯尔尼老城', lat: 46.9480, lng: 7.4474 },
      { time: '13:00', title: '伯尔尼熊苑', loc: '熊苑', lat: 46.9466, lng: 7.4526 },
    ] },
    { n: 13, title: '返回苏黎世 · 采购', items: [
      { time: '10:00', title: '老城手表店', loc: '苏黎世老城', lat: 47.3728, lng: 8.5389 },
      { time: '15:00', title: '巧克力店采购', loc: '苏黎世老城', lat: 47.3745, lng: 8.5410 },
    ] },
    { n: 14, title: '苏黎世机场返程', items: [
      { time: '11:00', title: '苏黎世机场返程航班', loc: '苏黎世机场', lat: 47.4647, lng: 8.5492 },
    ] },
  ]

  const sh = buildDaysAndItems('sh', tripShanghai.id, shStart, shanghaiDays)
  const kr = buildDaysAndItems('kr', tripKorea.id, krStart, koreaDays)
  const ch = buildDaysAndItems('ch', tripSwitzerland.id, chStart, switzerlandDays)

  const days = [...sh.days, ...kr.days, ...ch.days]
  const items = [...sh.items, ...kr.items, ...ch.items]

  // ---- 汇率簿：出行中/已回来这两趟真的会用到当地货币 ----
  const rateBookEntries: RateBookEntry[] = [
    { id: 'seed-rate-krw', householdId, tripId: tripKorea.id, foreignCurrency: 'KRW', label: '当地刷卡', rate: 0.0032, source: 'manual', createdBy: DAD, lastUsedAt: now, archived: false, createdAt: now },
    { id: 'seed-rate-chf', householdId, tripId: tripSwitzerland.id, foreignCurrency: 'CHF', label: '当地刷卡', rate: 5.35, source: 'manual', createdBy: DAD, lastUsedAt: now, archived: false, createdAt: now },
  ]

  const budgets: Budget[] = [
    { id: 'seed-budget-kr', householdId, tripId: tripKorea.id, categoryId: null, phase: null, amount: 8000, alertThresholdPct: 85 },
    { id: 'seed-budget-ch', householdId, tripId: tripSwitzerland.id, categoryId: null, phase: null, amount: 18000, alertThresholdPct: 90 },
  ]

  function makeExpense(
    id: string,
    tripId: string,
    categoryId: string,
    phase: 'pre_trip' | 'during_trip',
    amount: number,
    currency: string,
    rate: number,
    rateBookEntryId: string | null,
    paidBy: string,
    splitMemberIds: string[],
    splitType: 'none' | 'equal',
    itineraryDayId: string | null,
    expenseDate: string,
    description: string | null,
  ): { expense: Expense; splits: ExpenseSplit[] } {
    const homeAmount = Math.round(amount * rate * 100) / 100
    const expense: Expense = {
      id,
      householdId,
      tripId,
      categoryId,
      phase,
      description,
      expenseCurrency: currency,
      expenseAmount: amount,
      rateBookEntryId,
      rateUsed: rate,
      homeAmount,
      paidBy,
      recordedBy: paidBy,
      expenseDate,
      itineraryDayId,
      itineraryItemId: null,
      splitType,
      createdAt: now,
      updatedAt: now,
    }
    const shares = resolveSplitShares(homeAmount, splitType, splitMemberIds, paidBy)
    const splits: ExpenseSplit[] = shares.map((s, i) => ({
      id: `${id}-split-${i}`,
      householdId,
      expenseId: expense.id,
      memberId: s.memberId,
      shareAmount: s.shareAmount,
    }))
    return { expense, splits }
  }

  // 未出行——只有出发前的花费（机票/住宿定金/保险），还没有任何"途中"开销，
  // 这正是概览"出发前"阶段该看到的真实样子
  const bookedDate = isoDaysFromNow(-3)
  const shanghaiExpenses = [
    makeExpense('seed-exp-sh-1', tripShanghai.id, 'seed-cat-flight', 'pre_trip', 2480, 'MYR', 1, null, DAD, FAMILY, 'equal', null, bookedDate, '来回机票（3人）'),
    makeExpense('seed-exp-sh-2', tripShanghai.id, 'seed-cat-stay-prepaid', 'pre_trip', 1850, 'MYR', 1, null, MOM, FAMILY, 'equal', null, bookedDate, '酒店6晚预付定金'),
    makeExpense('seed-exp-sh-3', tripShanghai.id, 'seed-cat-insurance', 'pre_trip', 180, 'MYR', 1, null, DAD, FAMILY, 'equal', null, bookedDate, '旅游保险'),
    makeExpense('seed-exp-sh-4', tripShanghai.id, 'seed-cat-visa', 'pre_trip', 240, 'MYR', 1, null, MOM, FAMILY, 'equal', null, bookedDate, '入境证件加急费'),
  ]

  // 出行中——出发前的花费 + 到今天为止（第1~6天）已经发生的途中花费，
  // 第7~10天还没到，不该有任何记录
  const krBooked = isoDaysFromNow(krStart - 25)
  const krd = (n: number) => isoDaysFromNow(krStart + n - 1)
  const koreaExpenses = [
    makeExpense('seed-exp-kr-pre-1', tripKorea.id, 'seed-cat-flight', 'pre_trip', 3200, 'MYR', 1, null, DAD, FAMILY, 'equal', null, krBooked, '来回机票（3人）'),
    makeExpense('seed-exp-kr-pre-2', tripKorea.id, 'seed-cat-stay-prepaid', 'pre_trip', 2600, 'MYR', 1, null, MOM, FAMILY, 'equal', null, krBooked, '首尔4晚+釜山4晚酒店预付'),
    makeExpense('seed-exp-kr-pre-3', tripKorea.id, 'seed-cat-insurance', 'pre_trip', 210, 'MYR', 1, null, DAD, FAMILY, 'equal', null, krBooked, '旅游保险'),
    makeExpense('seed-exp-kr-1', tripKorea.id, 'seed-cat-food', 'during_trip', 85000, 'KRW', 0.0032, 'seed-rate-krw', MOM, FAMILY, 'equal', 'kr-day-1', krd(1), '明洞晚餐'),
    makeExpense('seed-exp-kr-2', tripKorea.id, 'seed-cat-transport', 'during_trip', 12000, 'KRW', 0.0032, 'seed-rate-krw', DAD, FAMILY, 'equal', 'kr-day-1', krd(1), '机场快线AREX车票'),
    makeExpense('seed-exp-kr-3', tripKorea.id, 'seed-cat-ticket', 'during_trip', 45000, 'KRW', 0.0032, 'seed-rate-krw', MOM, FAMILY, 'equal', 'kr-day-2', krd(2), '景福宫门票+韩服体验'),
    makeExpense('seed-exp-kr-4', tripKorea.id, 'seed-cat-shopping', 'during_trip', 120000, 'KRW', 0.0032, 'seed-rate-krw', MOM, [], 'none', 'kr-day-3', krd(3), '东大门购物（妈妈自己买的）'),
    makeExpense('seed-exp-kr-5', tripKorea.id, 'seed-cat-food', 'during_trip', 60000, 'KRW', 0.0032, 'seed-rate-krw', DAD, FAMILY, 'equal', 'kr-day-3', krd(3), '弘大午餐'),
    makeExpense('seed-exp-kr-6', tripKorea.id, 'seed-cat-ticket', 'during_trip', 54000, 'KRW', 0.0032, 'seed-rate-krw', DAD, FAMILY, 'equal', 'kr-day-4', krd(4), '首尔塔缆车+观景台门票'),
    makeExpense('seed-exp-kr-7', tripKorea.id, 'seed-cat-food', 'during_trip', 95000, 'KRW', 0.0032, 'seed-rate-krw', MOM, FAMILY, 'equal', 'kr-day-4', krd(4), '梨泰院晚餐'),
    makeExpense('seed-exp-kr-8', tripKorea.id, 'seed-cat-misc', 'during_trip', 38000, 'KRW', 0.0032, 'seed-rate-krw', DAD, FAMILY, 'equal', 'kr-day-5', krd(5), '汉江野餐食材+租自行车'),
    makeExpense('seed-exp-kr-9', tripKorea.id, 'seed-cat-transport', 'during_trip', 177000, 'KRW', 0.0032, 'seed-rate-krw', DAD, FAMILY, 'equal', 'kr-day-6', krd(6), 'KTX首尔→釜山车票（3人）'),
    makeExpense('seed-exp-kr-10', tripKorea.id, 'seed-cat-food', 'during_trip', 72000, 'KRW', 0.0032, 'seed-rate-krw', MOM, FAMILY, 'equal', 'kr-day-6', krd(6), '西面晚餐'),
  ]

  // 已回来——出发前+全程14天的途中花费都已经发生
  const chBooked = isoDaysFromNow(chStart - 30)
  const chd = (n: number) => isoDaysFromNow(chStart + n - 1)
  const switzerlandExpenses = [
    makeExpense('seed-exp-ch-pre-1', tripSwitzerland.id, 'seed-cat-flight', 'pre_trip', 4800, 'MYR', 1, null, DAD, FAMILY, 'equal', null, chBooked, '来回机票（3人）'),
    makeExpense('seed-exp-ch-pre-2', tripSwitzerland.id, 'seed-cat-stay-prepaid', 'pre_trip', 5200, 'MYR', 1, null, MOM, FAMILY, 'equal', null, chBooked, '13晚酒店分段预付'),
    makeExpense('seed-exp-ch-pre-3', tripSwitzerland.id, 'seed-cat-insurance', 'pre_trip', 320, 'MYR', 1, null, DAD, FAMILY, 'equal', null, chBooked, '旅游保险'),
    makeExpense('seed-exp-ch-pre-4', tripSwitzerland.id, 'seed-cat-visa', 'pre_trip', 450, 'MYR', 1, null, MOM, FAMILY, 'equal', null, chBooked, '申根签证（3人）'),
    makeExpense('seed-exp-ch-1', tripSwitzerland.id, 'seed-cat-transport', 'during_trip', 38, 'CHF', 5.35, 'seed-rate-chf', DAD, FAMILY, 'equal', 'ch-day-1', chd(1), '机场快线火车票'),
    makeExpense('seed-exp-ch-2', tripSwitzerland.id, 'seed-cat-food', 'during_trip', 145, 'CHF', 5.35, 'seed-rate-chf', MOM, FAMILY, 'equal', 'ch-day-1', chd(1), '苏黎世老城晚餐'),
    makeExpense('seed-exp-ch-3', tripSwitzerland.id, 'seed-cat-ticket', 'during_trip', 90, 'CHF', 5.35, 'seed-rate-chf', DAD, FAMILY, 'equal', 'ch-day-3', chd(3), '琉森湖游船门票'),
    makeExpense('seed-exp-ch-4', tripSwitzerland.id, 'seed-cat-ticket', 'during_trip', 268, 'CHF', 5.35, 'seed-rate-chf', DAD, FAMILY, 'equal', 'ch-day-4', chd(4), '皮拉图斯山缆车往返'),
    makeExpense('seed-exp-ch-5', tripSwitzerland.id, 'seed-cat-misc', 'during_trip', 110, 'CHF', 5.35, 'seed-rate-chf', MOM, FAMILY, 'equal', 'ch-day-6', chd(6), '格林德瓦缆车+午餐'),
    makeExpense('seed-exp-ch-6', tripSwitzerland.id, 'seed-cat-ticket', 'during_trip', 620, 'CHF', 5.35, 'seed-rate-chf', MOM, FAMILY, 'equal', 'ch-day-7', chd(7), '少女峰火车票（3人往返）'),
    makeExpense('seed-exp-ch-7', tripSwitzerland.id, 'seed-cat-food', 'during_trip', 130, 'CHF', 5.35, 'seed-rate-chf', DAD, FAMILY, 'equal', 'ch-day-8', chd(8), '采尔马特小镇午餐'),
    makeExpense('seed-exp-ch-8', tripSwitzerland.id, 'seed-cat-ticket', 'during_trip', 210, 'CHF', 5.35, 'seed-rate-chf', MOM, FAMILY, 'equal', 'ch-day-9', chd(9), 'Gornergrat齿轨列车门票'),
    makeExpense('seed-exp-ch-9', tripSwitzerland.id, 'seed-cat-shopping', 'during_trip', 180, 'CHF', 5.35, 'seed-rate-chf', DAD, [], 'none', 'ch-day-11', chd(11), '日内瓦纪念品（爸爸自己买的）'),
    makeExpense('seed-exp-ch-10', tripSwitzerland.id, 'seed-cat-shopping', 'during_trip', 890, 'CHF', 5.35, 'seed-rate-chf', MOM, FAMILY, 'equal', 'ch-day-13', chd(13), '手表+巧克力采购'),
  ]

  const expenseRows = [...shanghaiExpenses, ...koreaExpenses, ...switzerlandExpenses]

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
