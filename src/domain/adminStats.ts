import { supabase } from '../api/supabaseClient'
import { isLocalTestModeEnabled } from '../dev/localTestMode'

// 跟 public.admin_dashboard_stats() 返回的 jsonb 一一对应，字段名是数据库那边
// 直接拼出来的 camelCase，不经过任何转换层
export interface AdminCounts {
  accounts: number
  households: number
  trips: number
  supportedHouseholds: number
}

export interface AdminFunnel {
  registered: number
  inHousehold: number
  householdHasTrip: number
  householdHasExpense: number
  householdSupported: number
}

export interface AdminDailyRow {
  date: string // YYYY-MM-DD，按马来西亚时间切的日子
  accounts: number
  testAccounts: number
  trips: number
}

export interface AdminStuckAccount {
  email: string
  provider: string | null
  createdAt: string
  // 最近一次打开APP（登录或会话自动续期，取最新的那个），不只是"最近一次输验证码"
  lastSeenAt: string | null
  isTest: boolean
}

export interface AdminHousehold {
  id: string
  name: string
  createdAt: string
  memberCount: number
  signedInMemberCount: number
  tripCount: number
  expenseCount: number
  lastActivityAt: string | null
  tripLimitExempt: boolean
  supported: boolean
  isTest: boolean
}

export interface AdminDashboardStats {
  generatedAt: string
  totals: AdminCounts
  last7Days: AdminCounts
  funnel: AdminFunnel
  daily: AdminDailyRow[]
  stuckAccounts: AdminStuckAccount[]
  households: AdminHousehold[]
}

// 入口藏不藏只是体验问题，真正挡人的是数据库函数自己的权限判断——所以这里
// 任何失败都当成"不是管理员"，宁可管理员自己偶尔看不到入口，也不要因为一次
// 网络抖动把入口露给别人（露了也拿不到数据，但没必要让人看见）
export async function isAppAdmin(): Promise<boolean> {
  if (!supabase || isLocalTestModeEnabled()) return false
  try {
    const { data, error } = await supabase.rpc('is_app_admin')
    if (error) return false
    return data === true
  } catch {
    return false
  }
}

export async function getAdminDashboardStats(): Promise<AdminDashboardStats> {
  if (!supabase || isLocalTestModeEnabled()) throw new Error('没有连接云端，无法查看数据后台')
  const { data, error } = await supabase.rpc('admin_dashboard_stats')
  if (error) throw error
  if (!data) throw new Error('数据后台没有返回数据')
  return data as AdminDashboardStats
}

// 函数对非管理员抛的是 SQLSTATE 42501，跟网络失败要给不同的提示——
// 前者重试多少次都没用
export function isNotAuthorizedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const { code, message } = err as { code?: unknown; message?: unknown }
  return code === '42501' || (typeof message === 'string' && message.includes('not authorized'))
}

const DAY_MS = 86_400_000

export function isWithinDays(iso: string, now: number, days: number): boolean {
  const at = Date.parse(iso)
  return Number.isFinite(at) && now - at <= days * DAY_MS
}

export type ChartRange = '7d' | '30d' | 'all'

// daily 本来就是连续到今天为止的，取尾巴就是"最近N天"
export function sliceDaily(daily: AdminDailyRow[], range: ChartRange): AdminDailyRow[] {
  if (range === 'all') return daily
  const n = range === '7d' ? 7 : 30
  return daily.slice(-n)
}

export const FUNNEL_STEPS = [
  'registered',
  'inHousehold',
  'householdHasTrip',
  'householdHasExpense',
  'householdSupported',
] as const satisfies readonly (keyof AdminFunnel)[]

export type FunnelStep = (typeof FUNNEL_STEPS)[number]

export interface FunnelRow {
  step: FunnelStep
  count: number
  percent: number // 相对注册人数，0–100 的整数
}

export function funnelRows(funnel: AdminFunnel): FunnelRow[] {
  const base = funnel.registered
  return FUNNEL_STEPS.map((step) => ({
    step,
    count: funnel[step],
    percent: base > 0 ? Math.round((funnel[step] / base) * 100) : 0,
  }))
}

export interface FunnelDrop {
  from: FunnelStep
  to: FunnelStep
  lost: number
}

export type FunnelNote =
  | { kind: 'empty' }
  | { kind: 'noDrop' }
  | { kind: 'drops'; drops: FunnelDrop[]; lost: number }

// 提示只看"上手"那几步（注册→进团队→建行程→记账）：打赏本来就是可选的、只有少数
// 人会做，把它算进来的话"掉人最多"几乎永远是最后一步，真正卡住新人的地方反而
// 永远不会被点出来。并列最多的几步全部列出来，不替用户挑一个
const ONBOARDING_STEPS = FUNNEL_STEPS.slice(0, FUNNEL_STEPS.indexOf('householdHasExpense') + 1)

export function funnelNote(funnel: AdminFunnel): FunnelNote {
  if (funnel.registered <= 0) return { kind: 'empty' }
  const drops: FunnelDrop[] = []
  for (let i = 1; i < ONBOARDING_STEPS.length; i++) {
    const from = ONBOARDING_STEPS[i - 1]
    const to = ONBOARDING_STEPS[i]
    drops.push({ from, to, lost: Math.max(0, funnel[from] - funnel[to]) })
  }
  const lost = Math.max(...drops.map((d) => d.lost))
  if (lost === 0) return { kind: 'noDrop' }
  return { kind: 'drops', drops: drops.filter((d) => d.lost === lost), lost }
}

// 注册后要么根本没再打开过，要么"最近一次打开"就是注册那一下（验证码/OAuth
// 注册本身就会记一次，前后差几分钟）——这两种都算"之后没再回来"
const SAME_VISIT_MS = 10 * 60_000
export function neverCameBack(account: Pick<AdminStuckAccount, 'createdAt' | 'lastSeenAt'>): boolean {
  if (!account.lastSeenAt) return true
  return Date.parse(account.lastSeenAt) - Date.parse(account.createdAt) <= SAME_VISIT_MS
}

export function followUpCount(accounts: AdminStuckAccount[]): number {
  return accounts.filter((a) => !a.isTest).length
}

export function householdHasNoActivity(h: Pick<AdminHousehold, 'tripCount' | 'expenseCount' | 'lastActivityAt'>): boolean {
  return h.tripCount === 0 && h.expenseCount === 0 && h.lastActivityAt === null
}

// 纵轴刻度只取整数（人数、趟数没有半个），最多4条线，步长走 1/2/5/10… 这种
// 好读的数；返回的最后一个刻度同时就是纵轴顶端
export function integerTicks(maxValue: number): number[] {
  const max = Math.max(1, Math.ceil(maxValue))
  let step = 1
  const bases = [1, 2, 5]
  for (let mag = 1; ; mag *= 10) {
    const found = bases.find((b) => max / (b * mag) <= 4)
    if (found) {
      step = found * mag
      break
    }
  }
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = step; v <= top; v += step) ticks.push(v)
  return ticks
}

export function chartMaxValue(rows: AdminDailyRow[]): number {
  return rows.reduce((m, r) => Math.max(m, r.accounts + r.testAccounts, r.trips), 0)
}

// 横轴只标首、中、尾三个日期，天数少的时候去重
export function xLabelIndices(length: number): number[] {
  if (length <= 0) return []
  return [...new Set([0, Math.floor((length - 1) / 2), length - 1])]
}

export function formatDateKeyMonthDay(dateKey: string): string {
  const [, m, d] = dateKey.split('-')
  return `${Number(m)}/${Number(d)}`
}

// 时间戳按设备本地时区显示——看后台的人就在马来西亚，跟 daily 按马来西亚时间
// 切日子是一致的
export function formatMonthDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function formatMonthDayTime(iso: string): string {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}
