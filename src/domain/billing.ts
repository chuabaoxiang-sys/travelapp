import { supabase } from '../api/supabaseClient'
import { getSession, getCurrentHouseholdId } from './household'
import { isLocalTestModeEnabled } from '../dev/localTestMode'

// 定价是终生RM99一次性解锁，不是循环订阅——只有"没买"和"买了"两种状态，
// 买了就永久有效，没有past_due/canceled这类中间态
export type SubscriptionStatus = 'none' | 'active'

export interface HouseholdSubscription {
  status: SubscriptionStatus
  purchasedAt: string | null
}

const NONE_SUBSCRIPTION: HouseholdSubscription = { status: 'none', purchasedAt: null }

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
async function callBillingEndpoint(path: string): Promise<string> {
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
    body: JSON.stringify({ householdId }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || typeof data?.url !== 'string') {
    throw new Error(data?.error ?? '请求失败')
  }
  return data.url
}

// 跳转到Stripe Checkout（一次性付费模式）——整页跳转，不是弹窗，成功/取消后
// Stripe会把用户带回create-checkout-session.ts里算好的success_url/cancel_url
export async function startCheckout(): Promise<void> {
  window.location.href = await callBillingEndpoint('/api/create-checkout-session')
}
