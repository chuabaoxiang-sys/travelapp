import Dexie, { type EntityTable } from 'dexie'
import { getCurrentHouseholdId } from '../domain/household'
import type {
  Trip,
  Member,
  TripMember,
  ExpenseCategory,
  ItineraryDay,
  ItineraryItem,
  RateBookEntry,
  Expense,
  ExpenseSplit,
  ExpenseDayAllocation,
  ExpenseRateAllocation,
  Budget,
  Settlement,
  OutboxEntry,
  Feedback,
  RouteLegCacheEntry,
  WishlistPlace,
  DiscoveryHint,
} from '../types'

// 会被同步到云端的表——本地写操作会自动记一条 outbox。expenseCategories 不算在内，
// 因为那是所有安装共用的系统预置分类种子数据（tripId为null），不是用户产生的数据
//
// 声明放在 class 前面：constructor 里会立刻调用 registerOutboxHooks(this)，而
// `export const db = new TripJournalDB()` 在模块顶层就会同步执行——如果 SYNCED_TABLES
// 声明在 db 实例化之后，会在还没初始化完成时就被引用，触发暂时性死区报错
// expenseSplits 故意不在这个列表里——它需要"一笔费用的所有分摊行打包在一次
// 事务里推送"（见 0009_atomic_expense_split_push.sql 和 domain/splits.ts 的
// saveExpenseSplits），逐行走这套通用的按行推送 hook 会撞上数据库那道延迟约束
// 触发器，分摊记录永远同步不上去。saveExpenseSplits 自己手动调用 enqueueOutbox
// 打包成一条 entry，pushOutbox 再特判这张表名单独处理
//
// expenseDayAllocations 反过来可以走这套逐行 hook：它没有 expenseSplits 那种
// "总额必须等于费用总额"的延迟约束（见 0011 迁移里的说明），逐行推送不会被
// 中间状态卡住；删掉的那几行也由 deleting hook 自然带上，不需要特殊处理
const SYNCED_TABLES = [
  'trips',
  'members',
  'tripMembers',
  'itineraryDays',
  'itineraryItems',
  'rateBookEntries',
  'expenses',
  'expenseDayAllocations',
  'expenseRateAllocations',
  'budgets',
  'settlements',
  'feedback',
  'wishlistPlaces',
] as const

export class TripJournalDB extends Dexie {
  trips!: EntityTable<Trip, 'id'>
  members!: EntityTable<Member, 'id'>
  tripMembers!: EntityTable<TripMember, 'id'>
  expenseCategories!: EntityTable<ExpenseCategory, 'id'>
  itineraryDays!: EntityTable<ItineraryDay, 'id'>
  itineraryItems!: EntityTable<ItineraryItem, 'id'>
  rateBookEntries!: EntityTable<RateBookEntry, 'id'>
  expenses!: EntityTable<Expense, 'id'>
  expenseSplits!: EntityTable<ExpenseSplit, 'id'>
  expenseDayAllocations!: EntityTable<ExpenseDayAllocation, 'id'>
  expenseRateAllocations!: EntityTable<ExpenseRateAllocation, 'id'>
  budgets!: EntityTable<Budget, 'id'>
  settlements!: EntityTable<Settlement, 'id'>
  outbox!: EntityTable<OutboxEntry, 'id'>
  feedback!: EntityTable<Feedback, 'id'>
  routeLegCache!: EntityTable<RouteLegCacheEntry, 'dayId'>
  wishlistPlaces!: EntityTable<WishlistPlace, 'id'>
  discoveryHints!: EntityTable<DiscoveryHint, 'id'>

  constructor() {
    super('trip-journal')
    this.version(1).stores({
      trips: 'id, status, createdAt',
      members: 'id, isActive',
      tripMembers: 'id, tripId, memberId',
      expenseCategories: 'id, tripId, phase',
      itineraryDays: 'id, tripId, date',
      itineraryItems: 'id, dayId, tripId, orderIndex',
      rateBookEntries: 'id, tripId, foreignCurrency, archived, lastUsedAt',
      expenses: 'id, tripId, categoryId, itineraryDayId, itineraryItemId, expenseDate',
      expenseSplits: 'id, expenseId, memberId',
      budgets: 'id, tripId, categoryId',
      settlements: 'id, tripId, fromMemberId, toMemberId',
      outbox: 'id, tableName, status, createdAt',
      feedback: 'id, submittedBy, category, createdAt',
    })
    // routeLegCache 是纯本地派生缓存（不进 SYNCED_TABLES，不需要同步），
    // 单独加一个版本只是因为它是全新的表，不影响已有表的数据
    this.version(2).stores({
      routeLegCache: 'dayId',
    })
    // 跨天开销的每日分摊。同样是全新的表，已有数据一行都不用改——老账目
    // 没有 daySpreadMode，继续按 itineraryDayId 整笔算在一天上
    this.version(3).stores({
      expenseDayAllocations: 'id, expenseId, tripId, date',
    })
    // 一笔开销拆给不止一批换汇的分摊行。同样是全新的表，老账目没有 rateSpread，
    // 继续按 rateBookEntryId 单选那条老路径算
    this.version(4).stores({
      expenseRateAllocations: 'id, expenseId, tripId, rateBookEntryId',
    })
    // 想去的地点——全新的表，按团队(household)存，不挂 tripId，不受任何行程的
    // 创建/删除影响（deleteTripCascade 故意不碰这张表）
    this.version(5).stores({
      wishlistPlaces: 'id, householdId, visited, createdAt',
    })
    // 入口发现提示的"谁看过哪个提示"——纯本地UI偏好，不进 SYNCED_TABLES，
    // 也不在换团队时清空（这是"这个人熟不熟悉这个APP"，跟具体哪个团队无关）
    this.version(6).stores({
      discoveryHints: 'id, memberId',
    })
    registerOutboxHooks(this)
  }
}

export const db = new TripJournalDB()

// 用 Dexie 的表级 hook 自动把每次增/改/删都记一条到 outbox，不用去每个功能文件里手动插入
// "记一条同步队列"的代码。写 outbox 用 Dexie.ignoreTransaction()——特意让它在独立的事务里
// 提交，不占用触发它的那个表本身的事务范围（IndexedDB 的事务范围在创建时就固定死了，
// 事后没法往里加表，这是唯一干净的办法）。代价是极端情况下主写操作后 outbox 记录失败
// 不会一起回滚，但这个app是单个家庭离线优先场景，此前"后写覆盖"的简化风险都已经跟用户
// 说明过，这里的不一致概率和后果都很小，不必为此引入更复杂的方案
// 从云端拉数据写回本地时要临时关掉这些 hook——否则拉下来的每一行都会被当成
// "本地新写入"又重新记一条 outbox，推回云端造成两台设备之间来回震荡的无效流量。
// 用一个简单的模块级标记而不是给每次调用传参，因为 bulkPut 内部对每一行都会
// 触发一次 hook，没法在 bulkPut 的调用点之外单独给每一行传标记。
//
// 用计数器而不是布尔值：网络不好时两轮 runSync() 可能会重叠执行（各自的
// pullAll() 都在写不同的表），如果只是个布尔开关，先结束的那次调用退出时
// 会把标记直接置回 false，把还没结束的另一次也一起"解除屏蔽"，导致它接下来
// 拉回来的行被误记成本地新写入——这正是 2026-08-23 那次"完全没操作就冒出待
// 同步"的根源。计数器保证只有最外层的调用退出时才会真正关闭屏蔽
let suppressOutboxDepth = 0

export async function withoutOutboxTracking<T>(fn: () => Promise<T>): Promise<T> {
  suppressOutboxDepth++
  try {
    return await fn()
  } finally {
    suppressOutboxDepth--
  }
}

// 切换团队时清空本地已同步的数据，然后重新从云端拉新团队的。
//
// ⚠️ 这个函数是整个APP里最危险的一段：如果不走 withoutOutboxTracking，每一行的
// 删除都会被 hook 记成一条 delete 到 outbox，下一轮同步就会把**云端**那些数据
// 一起删掉——本意是"清掉本地缓存"，实际效果是"删除这个团队的全部真实数据"。
// 所以这里的包裹不是优化，是正确性的前提，改动这段务必保留。
//
// 清的范围刻意列全，不直接复用 SYNCED_TABLES：
//   - expenseSplits 不在 SYNCED_TABLES 里（它走的是按费用打包的 outbox 条目，
//     见 0009 那次修复），但它同样是团队数据，漏清会让上一个团队的分摊明细
//     残留在本地、和新团队的账目混在一起
//   - routeLegCache 是纯本地派生缓存（按 dayId 存），换团队后那些 dayId 都不存在了，
//     属于纯垃圾，顺手清掉
//   - expenseCategories 刻意不清：那是所有安装共用的系统预置分类种子数据，
//     不属于任何团队
//   - outbox 刻意不清：调用方必须先确认它已经空了才允许切换（带着旧团队 household_id
//     的待推送记录切过去会被 RLS 永久拒绝），所以这里没有东西可清
export async function clearLocalTeamData() {
  await withoutOutboxTracking(async () => {
    for (const tableName of [...SYNCED_TABLES, 'expenseSplits', 'routeLegCache']) {
      await db.table(tableName).clear()
    }
  })
}

function registerOutboxHooks(db: TripJournalDB) {
  for (const tableName of SYNCED_TABLES) {
    const table = db.table(tableName)

    table.hook('creating', (primKey, obj) => {
      if (suppressOutboxDepth > 0) return
      Dexie.ignoreTransaction(() => {
        void enqueueOutbox(tableName, String(primKey ?? (obj as { id: string }).id), 'upsert', obj)
      })
    })

    table.hook('updating', (modifications, primKey, obj) => {
      if (suppressOutboxDepth > 0) return
      Dexie.ignoreTransaction(() => {
        void enqueueOutbox(tableName, String(primKey), 'upsert', { ...obj, ...modifications })
      })
    })

    table.hook('deleting', (primKey) => {
      if (suppressOutboxDepth > 0) return
      Dexie.ignoreTransaction(() => {
        void enqueueOutbox(tableName, String(primKey), 'delete', null)
      })
    })
  }
}

// 导出给 domain/splits.ts 用——expenseSplits 不走上面这套逐行 hook，需要
// saveExpenseSplits 自己手动打包成一条 entry
export async function enqueueOutbox(tableName: string, recordId: string, operation: 'upsert' | 'delete', payload: unknown) {
  const entry: OutboxEntry = {
    id: crypto.randomUUID(),
    tableName,
    recordId,
    operation,
    payload,
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: Date.now(),
  }
  await db.outbox.add(entry)
}

// 默认分类种子数据 — 对应 supabase/migrations/0001_init.sql 里的种子分类
// 用固定 id（而不是每次随机生成）是为了让 bulkPut 天然幂等：即使因为 React
// StrictMode 在开发环境下重复触发 effect、或多个标签页同时启动而并发调用两次，
// 也只会覆盖同一批行，不会插出重复分类。
const DEFAULT_CATEGORIES: ExpenseCategory[] = [
  { id: 'seed-cat-insurance', name: '保险', phase: 'pre_trip', char: '险', colorVar: 'cat-misc', tripId: null, isSystemDefault: true },
  { id: 'seed-cat-flight', name: '机票', phase: 'pre_trip', char: '行', colorVar: 'cat-transport', tripId: null, isSystemDefault: true },
  { id: 'seed-cat-visa', name: '签证', phase: 'pre_trip', char: '签', colorVar: 'cat-misc', tripId: null, isSystemDefault: true },
  { id: 'seed-cat-stay-prepaid', name: '酒店预付', phase: 'pre_trip', char: '宿', colorVar: 'cat-stay', tripId: null, isSystemDefault: true },
  { id: 'seed-cat-food', name: '餐饮', phase: 'during_trip', char: '食', colorVar: 'cat-food', tripId: null, isSystemDefault: true },
  { id: 'seed-cat-transport', name: '交通', phase: 'during_trip', char: '行', colorVar: 'cat-transport', tripId: null, isSystemDefault: true },
  { id: 'seed-cat-shopping', name: '购物', phase: 'during_trip', char: '购', colorVar: 'cat-shop', tripId: null, isSystemDefault: true },
  { id: 'seed-cat-ticket', name: '门票', phase: 'during_trip', char: '票', colorVar: 'cat-ticket', tripId: null, isSystemDefault: true },
  { id: 'seed-cat-stay-onsite', name: '住宿现付', phase: 'during_trip', char: '宿', colorVar: 'cat-stay', tripId: null, isSystemDefault: true },
  { id: 'seed-cat-misc', name: '杂项', phase: 'either', char: '杂', colorVar: 'cat-misc', tripId: null, isSystemDefault: true },
]

export async function ensureSeedData() {
  await db.expenseCategories.bulkPut(DEFAULT_CATEGORIES)
}

// 按日期取或建一条 itineraryDay——记账时把费用挂到某一天，
// 那一天在 itineraryDays 里可能还没有记录（用户还没在时间线加过行程项），
// ItineraryTab 和 AddExpensePage 都要用到，所以提到这里共用一份
export async function ensureItineraryDay(tripId: string, date: string) {
  const existing = await db.itineraryDays.where({ tripId, date }).first()
  if (existing) return existing
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('未找到所属团队')
  const id = crypto.randomUUID()
  const now = Date.now()
  const day: ItineraryDay = { id, householdId, tripId, date, title: null, notes: null, createdAt: now, updatedAt: now }
  await db.itineraryDays.add(day)
  return day
}

// 删除一趟行程时级联清理其名下的行程记录/账目数据，避免留下孤儿数据
export async function deleteTripCascade(tripId: string) {
  await db.transaction(
    'rw',
    [db.trips, db.tripMembers, db.itineraryDays, db.itineraryItems, db.expenses, db.expenseSplits, db.expenseDayAllocations, db.expenseRateAllocations, db.budgets, db.settlements],
    async () => {
      const expenseIds = await db.expenses.where('tripId').equals(tripId).primaryKeys()
      await db.expenseSplits.where('expenseId').anyOf(expenseIds).delete()
      await db.expenseDayAllocations.where('tripId').equals(tripId).delete()
      await db.expenseRateAllocations.where('tripId').equals(tripId).delete()
      await db.expenses.where('tripId').equals(tripId).delete()
      await db.itineraryItems.where('tripId').equals(tripId).delete()
      await db.itineraryDays.where('tripId').equals(tripId).delete()
      await db.budgets.where('tripId').equals(tripId).delete()
      await db.settlements.where('tripId').equals(tripId).delete()
      await db.tripMembers.where('tripId').equals(tripId).delete()
      await db.trips.delete(tripId)
    },
  )
}
