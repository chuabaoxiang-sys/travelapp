export type TripStatus = 'planning' | 'active' | 'completed' | 'archived'
export type ExpensePhase = 'pre_trip' | 'during_trip'
export type CategoryPhase = 'pre_trip' | 'during_trip' | 'either'
export type SplitType = 'none' | 'equal'

export interface Trip {
  id: string
  name: string
  homeCurrency: string
  startDate: string | null
  endDate: string | null
  status: TripStatus
  publicShareEnabled: boolean
  publicShareToken: string | null
  // 目的地国家（ISO 3166-1 alpha-2 小写代码），可选、可多选——用来把这趟行程的地点搜索
  // 限制在对应国家范围内，避免搜出同名但相隔千里的地方。老行程没有这个字段时按空数组处理
  destinationCountries?: string[]
  createdAt: number
  updatedAt: number
}

export interface Member {
  id: string
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
  tripId: string
  date: string
  title: string | null
  notes: string | null
  createdAt: number
  updatedAt: number
}

export interface ItineraryItem {
  id: string
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
  expenseId: string
  memberId: string
  shareAmount: number
}

export interface Budget {
  id: string
  tripId: string
  categoryId: string | null
  phase: ExpensePhase | null
  amount: number
  alertThresholdPct: number
}

export interface Settlement {
  id: string
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

export type FeedbackCategory = 'bug' | 'suggestion' | 'other'

// 用户反馈：跟其他"可同步表"走同一套 outbox 机制，本地先记着，等接入
// Supabase 之后自然就会同步到云端——不需要额外发邮件/分享的逻辑
export interface Feedback {
  id: string
  tripId: string | null
  submittedBy: string
  category: FeedbackCategory
  content: string
  createdAt: number
  updatedAt: number
}
