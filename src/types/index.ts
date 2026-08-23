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
// 'exact'：每个人分摊多少钱由用户自己填，不强制平分——数据库的 split_type
// 枚举从一开始就留了这个值（还有一个'percentage'，暂时没有对应功能，不实现）
export type SplitType = 'none' | 'equal' | 'exact'

// 跨天开销怎么摊到每一天：'equal' 平均分（除不尽的零头给第一天），
// 'exact' 每天的金额由用户自己填。刻意跟 SplitType 用同一套词，
// 因为界面上就是同一套交互（见 domain/dayAllocations.ts）
export type DaySpreadMode = 'equal' | 'exact'

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

// 'needed' = 标记为需要预约但还没订；'booked' = 已确认。null/undefined = 不适用
// （大部分行程项，比如"公园散步"）。刻意只有这两个"已标记"状态，没有第三个
// "not-needed"值——不需要预约的行程项就是没有这个字段，不用专门表示"确认不需要"
export type BookingStatus = 'needed' | 'booked'

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
  bookingStatus?: BookingStatus | null
  // 预约截止日期（YYYY-MM-DD）。这次先不做提醒功能，字段先加上，
  // 免得以后做提醒时又要一次迁移
  bookingDeadline?: string | null
  // 谁加的这一项。可空：这个字段是后加的（迁移0012），之前的历史数据没有归属信息，
  // "行程动态"遇到 null 时会退化成"有人加了…"
  createdBy: string | null
  // 这一项如果是从"想去的地点"一键选出来的，记录来源，纯粹用于追溯——
  // "这条想去的地点有没有被排入过行程"要现查这个字段，不能反过来在 WishlistPlace
  // 上存一个标记（那种存法会跟 rateBookEntries.useCount 一样，引用行变化后跟事实脱节）
  sourceWishlistId?: string | null
  createdAt: number
  updatedAt: number
}

// 想去的地点——跨行程长期保留的收藏清单，按团队(household)存，不按行程(trip)存
// （用户明确要求：这份清单的生命周期比任何单趟行程都长，规划新行程时能反复复用）。
// "有没有被排入过行程"不存在这张表上，是现查 ItineraryItem.sourceWishlistId 算出来的——
// 见 domain/wishlist.ts 的 usageByWishlistEntry
export interface WishlistPlace {
  id: string
  householdId: string
  name: string
  lat: number | null
  lng: number | null
  notes: string | null
  // "去过了"手动标记，跟"有没有排入过行程"是两件独立的事——用户可能没通过这个APP
  // 排过行程就直接去吃了，也可能排进了行程但最后没去成
  visited: boolean
  createdBy: string | null
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
  archived: boolean
  createdAt: number
  // 这条标签背后如果真的换过一次钱，这里存当时给出/换到的金额（比如"用500 MYR
  // 换了16,500 JPY"）。可选——两个要么都填要么都不填；rate 依然是唯一参与计算的
  // 字段，之后单独编辑 rate 不会联动改这两个数
  exchangedHomeAmount?: number | null
  exchangedForeignAmount?: number | null
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
  // 住宿、周游券这类横跨好几天的开销，摊到每一天各算多少——null/undefined 表示
  // 这是一笔普通的单日开销（老数据都是这种），当天花费按 itineraryDayId 整笔算。
  // 有值时改为按 expenseDayAllocations 里那几行分别计入对应日期
  daySpreadMode?: DaySpreadMode | null
  // 这笔钱是不是来自不止一批换汇——null/undefined 表示普通情况（老数据都是这种），
  // rateBookEntryId/rateUsed/homeAmount 照旧直接用。true 时 rateBookEntryId 置空，
  // rateUsed 改存这笔账的加权平均汇率、homeAmount 改为 expenseRateAllocations 里
  // 各行加总——两者仍是给老代码看的快照，真正构成看 domain/rateAllocations.ts
  rateSpread?: boolean | null
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

// 跨天开销摊到每一天的金额。选中的日子不要求连续（比如周游券只在第1天和第4天用），
// 所以存的是一行一个具体日期，而不是起止范围
export interface ExpenseDayAllocation {
  id: string
  householdId: string
  expenseId: string
  tripId: string
  date: string // YYYY-MM-DD
  amount: number
}

// 一笔开销拆给不止一个汇率簿条目时，每一批分到多少。存的是外币金额（跟开销本身
// 同一个币种）——"这笔钱几分来自哪批"天然发生在外币这一侧，不是本位币那一侧。
// rateUsed/homeAmount 是这一行当时的快照，跟 Expense.rateUsed/homeAmount 是
// 同一套"只记当时、不追溯"的规矩
export interface ExpenseRateAllocation {
  id: string
  householdId: string
  expenseId: string
  tripId: string
  rateBookEntryId: string
  foreignAmount: number
  rateUsed: number
  homeAmount: number
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
  // 谁记的这笔结算（不一定是转账双方之一，可能是家里管账的人代记）。可空，理由同
  // ItineraryItem.createdBy
  createdBy: string | null
  // null=聚合结算（"结算建议"生成的那种，不对应单一账目）；有值=这条结算是针对
  // 具体某一笔账目记的"按笔结算"，应用层会因此禁止编辑/删除那笔账目
  expenseId: string | null
  // 只对expenseId为null的聚合结算有意义：true=用户在"结算记录"手动新增的预付款，
  // 会被"按笔结算"自动拿去抵扣这两人之间后续的具体账目；false（含"结算建议"接受时
  // 生成的）不参与自动抵扣——避免把不对应真实账目的简化转账错误核销到具体账目上
  isPrepayment: boolean
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

// 入口"发现提示"小红点——纯本地UI偏好，不需要跨设备同步，按人记（不是按设备）。
// id 拼成 `memberId:hintKey`，同一个人不管在哪台设备上点过就不再提醒
export interface DiscoveryHint {
  id: string
  memberId: string
  hintKey: string
  seenAt: number
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
  // 提交时的APP版本（git短SHA），提交时自动写入，不需要用户自己说"我现在是哪个版本"。
  // 老反馈记录没有这个字段，读的时候按 null 处理，不是bug
  appVersion: string | null
  createdAt: number
  updatedAt: number
}
