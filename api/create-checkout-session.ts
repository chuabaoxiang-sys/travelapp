// Vercel Edge Function：给已登录的household成员发起一次Stripe Checkout(一次性
// 付费模式，不是订阅)，返回跳转链接，前端整页跳转过去。本仓库第一个需要鉴权的
// 接口——鉴权逻辑见 api/_lib/verifyHousehold.ts。
//
// 三档"咖啡"定价(1/2/3杯)对应三个不同的Stripe Price，档位由客户端传入、服务端
// 对照白名单校验，不接受客户端直接传price id——防止改传任意/别人的price。
//
// 已解锁的household也能再次发起checkout(当作后续打赏，见0034之后的产品决定：
// 解锁只解一次限制，之后想支持开发者可以随时点)，所以这里不再有"已解锁就拒绝"
// 的门槛。
//
// 这个接口全程不写household_subscription这张表：没买过就不传customer参数，让
// Stripe在Checkout流程里自动建一个；买过的household用已有的stripe_customer_id
// 复用同一个Stripe客户。真正的写入只发生在webhook收到checkout.session.completed
// 之后——保持"只有webhook写这张表"这条设计（见0028迁移）不被破坏。
export const config = { runtime: 'edge' }

import Stripe from 'stripe'
import { verifyHouseholdAccess } from './_lib/verifyHousehold'

const TIER_ENV_KEYS = {
  1: 'STRIPE_PRICE_TIER1',
  2: 'STRIPE_PRICE_TIER2',
  3: 'STRIPE_PRICE_TIER3',
} as const

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    })
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY
  if (!stripeSecretKey) {
    return new Response(JSON.stringify({ error: 'Stripe 未配置' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  let householdId: unknown
  let tier: unknown
  try {
    const body = await request.json()
    householdId = body?.householdId
    tier = body?.tier
  } catch {
    return new Response(JSON.stringify({ error: '请求体不是合法JSON' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (tier !== 1 && tier !== 2 && tier !== 3) {
    return new Response(JSON.stringify({ error: '档位不合法' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const priceId = process.env[TIER_ENV_KEYS[tier]]
  if (!priceId) {
    return new Response(JSON.stringify({ error: 'Stripe 未配置' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  const auth = await verifyHouseholdAccess(request, householdId)
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'content-type': 'application/json' },
    })
  }

  const { data: existing } = await auth.supabase
    .from('household_subscription')
    .select('stripe_customer_id')
    .eq('household_id', householdId as string)
    .maybeSingle()

  // 跳转回来的地址跟着请求自己的Origin走，不需要客户端额外传——预览部署/正式环境
  // 各自的Origin天然不同，不用维护一份环境对环境的映射；缺失时兜底到正式域名
  const origin = request.headers.get('origin') || 'https://travelapp-kappa-wheat.vercel.app'

  const stripe = new Stripe(stripeSecretKey, { httpClient: Stripe.createFetchHttpClient() })

  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: existing?.stripe_customer_id ?? undefined,
      customer_creation: existing?.stripe_customer_id ? undefined : 'always',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: householdId as string,
      metadata: { household_id: householdId as string },
      success_url: `${origin}/?billing=success`,
      cancel_url: `${origin}/?billing=cancel`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[create-checkout-session] Stripe 调用失败:', message)
    return new Response(JSON.stringify({ error: 'Stripe请求失败', detail: message }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (!session.url) {
    return new Response(JSON.stringify({ error: 'Stripe 没有返回跳转链接' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ url: session.url }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
