// Vercel Edge Function：接收Stripe webhook通知，是household_subscription这张表
// 唯一的写入路径（见0028迁移里的设计说明）。签名校验用Stripe官方SDK(不是手搓)，
// 写库走apply_stripe_webhook_event这个security definer函数 + 存在Supabase Vault
// 里的共享密钥——全程不碰service_role密钥，即使这个共享密钥泄露，攻击者能做的
// 也只是往这一张表塞状态，碰不到数据库里任何其他东西。
//
// 定价是终生RM99一次性解锁(不是循环订阅)，所以这里只处理一次性支付模式的
// checkout.session.completed，没有customer.subscription.*这类续费/取消事件
// 需要处理。
//
// Edge Runtime没有Node的crypto模块，默认的stripe.webhooks.constructEvent(...)会
// 直接报错——必须用constructEventAsync配合Stripe.createFetchHttpClient()。签名
// 校验要的是Stripe原样签过的字节，所以必须读原始文本(request.text())，不能先
// request.json()再序列化回去。
export const config = { runtime: 'edge' }

import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

export interface SubscriptionUpsertPayload {
  householdId: string
  stripeCustomerId: string | null
  stripePaymentIntentId: string | null
  status: string
  priceId: string | null
}

// 从Stripe事件里抽取"该往household_subscription写什么"，跟"怎么写"(RPC调用)分开，
// 方便像api/resolve-maps-link.test.ts那样直接构造假的Stripe.Event对象单测，
// 不需要真实签名。不认识/不关心的事件类型返回null，调用方对null照样回200，
// 避免Stripe因为非2xx响应而重试风暴
export function extractSubscriptionUpsert(event: Stripe.Event): SubscriptionUpsertPayload | null {
  if (event.type !== 'checkout.session.completed') return null

  const session = event.data.object as Stripe.Checkout.Session
  // 一次性付费模式下才处理——万一将来又加了别的Checkout用途(比如订阅)，
  // 不要被这里的逻辑误伤
  if (session.mode !== 'payment') return null

  const householdId = session.client_reference_id ?? (session.metadata?.household_id as string | undefined) ?? null
  if (!householdId) return null

  // Checkout Session的webhook payload本身不带line_items(那要另外expand，webhook
  // 事件不支持)——这个App目前只有一个Price在卖，直接读同一个环境变量就够了，
  // 不用为了拿一个已知值去多做一次Stripe API调用
  return {
    householdId,
    stripeCustomerId: typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null),
    stripePaymentIntentId:
      typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null),
    status: 'active',
    priceId: process.env.STRIPE_PRICE_ID ?? null,
  }
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    })
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const sharedSecret = process.env.STRIPE_WEBHOOK_SHARED_SECRET
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!stripeSecretKey || !webhookSecret || !sharedSecret || !supabaseUrl || !supabaseAnonKey) {
    return new Response(JSON.stringify({ error: 'Webhook 未配置完整' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return new Response(JSON.stringify({ error: '缺少 stripe-signature' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const rawBody = await request.text()
  const stripe = new Stripe(stripeSecretKey, { httpClient: Stripe.createFetchHttpClient() })

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret)
  } catch (err) {
    // 签名不对时返回400而不是401——Stripe自己的重试/后台工具对webhook端点的
    // 期望是400代表"这个payload有问题"
    const message = err instanceof Error ? err.message : String(err)
    console.error('[stripe-webhook] 签名校验失败:', message)
    return new Response(JSON.stringify({ error: '签名校验失败', detail: message }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const upsert = extractSubscriptionUpsert(event)
  if (!upsert) {
    // 不认识/不需要处理的事件类型照样回200，不是错误——避免Stripe因为非2xx
    // response而不断重试一个我们本来就不打算处理的事件
    return new Response(JSON.stringify({ received: true, handled: false }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  // 用anon key，不是service_role——真正的权限收窄在apply_stripe_webhook_event
  // 函数内部靠共享密钥完成，这里只是个普通客户端
  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const { error } = await supabase.rpc('apply_stripe_webhook_event', {
    p_household_id: upsert.householdId,
    p_stripe_customer_id: upsert.stripeCustomerId,
    p_stripe_payment_intent_id: upsert.stripePaymentIntentId,
    p_status: upsert.status,
    p_price_id: upsert.priceId,
    p_shared_secret: sharedSecret,
  })

  if (error) {
    console.error('[stripe-webhook] 写库失败:', error.message)
    return new Response(JSON.stringify({ error: '写库失败', detail: error.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ received: true, handled: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
