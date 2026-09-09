import { supabase } from '../api/supabaseClient'
import { getSession, getCurrentHouseholdId } from './household'
import { isLocalTestModeEnabled } from '../dev/localTestMode'

// 解锁是一次性买断，不是循环订阅——一旦解锁就永久有效，没有past_due/canceled
// 这类中间态。解锁之后仍然可以再付款，但那算打赏，不影响这个status
export type SubscriptionStatus = 'none' | 'active'

export interface HouseholdSubscription {
  status: SubscriptionStatus
  purchasedAt: string | null
}

const NONE_SUBSCRIPTION: HouseholdSubscription = { status: 'none', purchasedAt: null }

export type PriceTier = 1 | 2 | 3

// 三档"咖啡"定价——金额相同的档位在Stripe两个账号(sandbox/live)里各对应一个
// price id，档位到price id的映射只在服务端(create-checkout-session.ts)做，
// 这里只放展示用的数据，不放price id
export const PRICE_TIERS: { tier: PriceTier; display: string; cups: number }[] = [
  { tier: 1, display: 'RM39', cups: 1 },
  { tier: 2, display: 'RM89', cups: 2 },
  { tier: 3, display: 'RM139', cups: 3 },
]

// 没有supabase（没配置云端）、本地测试模式（假household id，查了也只会是
// "非法uuid"这种误导性的报错）、或查不到当前团队时，统一当成"没买过"——本来就
// 没有真实household可以购买，不需要调用方再额外判断这几种情况
export async function getSubscriptionStatus(): Promise<HouseholdSubscription> {
  if (!supabase || isLocalTestModeEnabled()) return NONE_SUBSCRIPTION
  const householdId = await getCurrentHouseholdId()
  if (!householdId) return NONE_SUBSCRIPTION

  const { data, error } = await supabase
    .from('household_subscription')
    .select('status, purchased_at')
    .eq('household_id', householdId)
    .maybeSingle()

  if (error || !data) return NONE_SUBSCRIPTION
  return {
    status: data.status as SubscriptionStatus,
    purchasedAt: data.purchased_at,
  }
}

// 本仓库第一次在浏览器fetch自定义/api/*端点时手动带Authorization: Bearer——
// 之前所有Supabase调用都走supabase.rpc/from，客户端自动带JWT，不需要手动处理这一步
async function callBillingEndpoint(path: string, extra: Record<string, unknown>): Promise<string> {
  if (!supabase || isLocalTestModeEnabled()) throw new Error('本地测试模式下没有真实团队，无法操作订阅')
  const householdId = await getCurrentHouseholdId()
  const session = await getSession()
  if (!householdId || !session) throw new Error('未登录')

  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ householdId, ...extra }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || typeof data?.url !== 'string') {
    throw new Error(data?.error ?? '请求失败')
  }
  return data.url
}

export type PurchaseKind = 'unlock' | 'tip'

const PURCHASE_KIND_KEY = 'tripjournal_purchase_kind'

// Checkout是整页跳转，跳回来时早就没有当时点击的context了——点之前先把"这次算
// 解锁还是打赏"存一下，回来后SubscriptionSheet靠consumePendingPurchaseKind读回来，
// 决定感谢弹层显示哪一版文案。sessionStorage不可用（隐私模式等）时直接放弃，
// 感谢语退化成默认的"解锁"文案，不影响能不能继续用
function markPendingPurchaseKind(kind: PurchaseKind): void {
  try {
    sessionStorage.setItem(PURCHASE_KIND_KEY, kind)
  } catch {
    // 忽略
  }
}

export function consumePendingPurchaseKind(): PurchaseKind {
  try {
    const kind = sessionStorage.getItem(PURCHASE_KIND_KEY)
    sessionStorage.removeItem(PURCHASE_KIND_KEY)
    return kind === 'tip' ? 'tip' : 'unlock'
  } catch {
    return 'unlock'
  }
}

// 跳转到Stripe Checkout（一次性付费模式）——整页跳转，不是弹窗，成功/取消后
// Stripe会把用户带回create-checkout-session.ts里算好的success_url/cancel_url。
// 已解锁的household传tier进来算打赏，服务端不会因为已解锁而拒绝
export async function startCheckout(tier: PriceTier, kind: PurchaseKind): Promise<void> {
  markPendingPurchaseKind(kind)
  window.location.href = await callBillingEndpoint('/api/create-checkout-session', { tier })
}

// record_trip_creation（见0032迁移）抛出的异常信息里包含的标记字符串——
// 用来把"被免费额度拦下"跟网络失败等其他错误区分开
export const TRIP_LIMIT_REACHED = 'TRIP_LIMIT_REACHED'

// 建行程之前调用一次：免费额度用完且没有有效支持记录时会抛错（错误信息包含
// TRIP_LIMIT_REACHED），调用方据此弹付费墙，而不是把行程写进本地。本地测试
// 模式没有真实household，不做这个限制
export async function recordTripCreation(): Promise<void> {
  if (!supabase || isLocalTestModeEnabled()) return
  const { error } = await supabase.rpc('record_trip_creation')
  if (error) throw error
}
