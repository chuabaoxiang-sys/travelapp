export type TripStatus = 'planning' | 'active' | 'completed' | 'archived'

// "团队"——数据隔离的边界，一个家庭或一个朋友旅行群。只存在于远端 Supabase，
// 本地 Dexie 不需要单独一张表，只需要知道"当前登录邮箱属于哪个 householdId"
// （见 domain/household.ts），再把这个ID打在每条本地记录上供同步使用
export interface Household {
  id: string
  name: string
}
export type ExpensePhase = 'pre_trip' | 'during_trip'
export type CategoryPhase = 'pre_trip' | 'during_trip' | 'either'
export type SplitType = 'none' | 'equal'

// 只读分享链接要分享什么：'none' = 没开启分享；其余三种决定 get_shared_trip
// 这个数据库函数（见 supabase/migrations/0006_public_share.sql）返回哪些内容——
// 'itinerary'/'expenses' 分别只给行程/花费汇总，'both' 两者都给。花费永远只给
// 汇总数字（总额+按分类小计），数据库函数本身就不会去查每一笔明细。
export type PublicShareScope = 'none' | 'itinerary' | 'expenses' | 'both'

export interface Trip {
  id: string
  householdId: string
  name: string
  homeCurrency: string
  startDate: string | null
  endDate: string | null
  status: TripStatus
  publicShareScope: PublicShareScope
  publicShareToken: string | null
  // 选了哪套分享页模板（对应 src/features/share/templates 下的组件）——
  // 还没选过时是 null，UI 上要求先选一个才能真正生成/复制链接
  publicShareTemplate: string | null
  // 目的地国家（ISO 3166-1 alpha-2 小写代码），可选、可多选——用来把这趟行程的地点搜索
  // 限制在对应国家范围内，避免搜出同名但相隔千里的地方。老行程没有这个字段时按空数组处理
  destinationCountries?: string[]
  createdAt: number
  updatedAt: number
}

// get_shared_trip RPC 的返回结构——分享页（SharePage）拿到这个就够渲染任意模板，
// 不需要再单独查其他表。字段全部是"安全公开"的最终展示值，没有任何家庭内部信息
// （没有备注、没有花费明细、没有成员姓名）
export interface SharedTripData {
  name: string
  startDate: string | null
  endDate: string | null
  scope: PublicShareScope
  template: string | null
  days: SharedTripDay[] | null
  expenseTotal: number | null
  expenseCategories: SharedExpenseCategory[] | null
}

export interface SharedTripDay {
  dayDate: string
  dayTitle: string | null
  items: SharedTripItem[]
}

export interface SharedTripItem {
  time: string | null
  title: string
  locationName: string | null
}

export interface SharedExpenseCategory {
  name: string
  amount: number
}

export interface Member {
  id: string
  householdId: string
  displayName: string
  colorTag: string | null
  isActive: boolean
  createdAt: number
}

export interface TripMember {
  id: string
  tripId: string
  memberId: string
}

export interface ExpenseCategory {
  id: string
  name: string
  phase: CategoryPhase
  char: string
  colorVar: string
  tripId: string | null
  isSystemDefault: boolean
}

export interface ItineraryDay {
  id: string
  householdId: string
  tripId: string
  date: string
  title: string | null
  notes: string | null
  createdAt: number
  updatedAt: number
}

export interface ItineraryItem {
  id: string
  householdId: string
  dayId: string
  tripId: string
  orderIndex: number
  time: string | null
  title: string
  locationName: string | null
  lat: number | null
  lng: number | null
  notes: string | null
  createdAt: number
  updatedAt: number
}

export interface RateBookEntry {
  id: string
  householdId: string
  tripId: string
  foreignCurrency: string
  label: string
  rate: number
  source: 'manual' | 'api_accepted' | 'api_edited'
  createdBy: string | null
  lastUsedAt: number
  useCount: number
  archived: boolean
  createdAt: number
}

export interface Expense {
  id: string
  householdId: string
  tripId: string
  categoryId: string
  phase: ExpensePhase
  description: string | null
  expenseCurrency: string
  expenseAmount: number
  rateBookEntryId: string | null
  rateUsed: number
  homeAmount: number
  paidBy: string
  recordedBy: string
  expenseDate: string
  itineraryDayId: string | null
  itineraryItemId: string | null
  splitType: SplitType
  createdAt: number
  updatedAt: number
}

export interface ExpenseSplit {
  id: string
  householdId: string
  expenseId: string
  memberId: string
  shareAmount: number
}

export interface Budget {
  id: string
  householdId: string
  tripId: string
  categoryId: string | null
  phase: ExpensePhase | null
  amount: number
  alertThresholdPct: number
}

export interface Settlement {
  id: string
  householdId: string
  tripId: string
  fromMemberId: string
  toMemberId: string
  amount: number
  settledDate: string
  note: string | null
  createdAt: number
  updatedAt: number
}

// 离线写操作队列：只存在于本地 Dexie，从不同步到云端。每次对"可同步表"的增/改/删，
// 都会被 Dexie hook 自动记一条到这里；真正把内容推到 Supabase 的逻辑是后续阶段接的，
// 这里先只负责"记录还有什么没推上去"，供同步状态UI显示待同步条数
export interface OutboxEntry {
  id: string
  tableName: string
  recordId: string
  operation: 'upsert' | 'delete'
  payload: unknown
  status: 'pending' | 'synced' | 'failed'
  attempts: number
  lastError: string | null
  createdAt: number
}

// 相邻行程项之间的真实步行路线段——由 OpenRouteService 计算，按天缓存在本地（见 lib/routeLegs.ts）。
// 'missing-coords'：这一段里有一个地点没有经纬度，不去调用路线API，也没法生成地图链接；
// 'unavailable'：两边都有坐标，但调用过API失败/超额——仍然带着坐标，让这一行降级成一个
// "在地图中查看路线"的纯跳转链接，而不是什么都不显示
export type RouteLeg =
  | { kind: 'ok'; distanceMeters: number; durationSeconds: number; from: LatLng; to: LatLng }
  | { kind: 'missing-coords' }
  | { kind: 'unavailable'; from: LatLng; to: LatLng }

export interface LatLng {
  lat: number
  lng: number
}

// 纯本地缓存表，不走 outbox 同步——这是可以随时从行程数据重新算出来的派生结果，不是用户数据。
// signature 是当天行程项顺序+坐标拼出来的字符串，行程一旦编辑就会变，缓存自动失效重新请求
export interface RouteLegCacheEntry {
  dayId: string
  signature: string
  legs: RouteLeg[]
  fetchedAt: number
}

export type FeedbackCategory = 'bug' | 'suggestion' | 'other'

// 用户反馈：跟其他"可同步表"走同一套 outbox 机制，本地先记着，等接入
// Supabase 之后自然就会同步到云端——不需要额外发邮件/分享的逻辑
export interface Feedback {
  id: string
  householdId: string
  tripId: string | null
  submittedBy: string
  category: FeedbackCategory
  content: string
  createdAt: number
  updatedAt: number
}
