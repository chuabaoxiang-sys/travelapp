import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Stripe from 'stripe'
import { extractSubscriptionUpsert } from './stripe-webhook'

// 只测"从Stripe事件里该抽出什么"这部分纯逻辑，不测真实签名校验——那部分需要
// 真实的Stripe签名密钥，得靠Stripe CLI手动/集成测试，不是这里的单测范围。
// 用as unknown as Stripe.Event绕开完整类型要求，只填这个函数实际会读到的字段

describe('extractSubscriptionUpsert', () => {
  const originalPriceId = process.env.STRIPE_PRICE_ID
  beforeEach(() => {
    process.env.STRIPE_PRICE_ID = 'price_test123'
  })
  afterEach(() => {
    process.env.STRIPE_PRICE_ID = originalPriceId
  })

  it('checkout.session.completed（payment模式）：从client_reference_id拿household_id', () => {
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'payment',
          client_reference_id: 'household-1',
          metadata: {},
          customer: 'cus_123',
          payment_intent: 'pi_123',
        },
      },
    } as unknown as Stripe.Event

    expect(extractSubscriptionUpsert(event)).toEqual({
      householdId: 'household-1',
      stripeCustomerId: 'cus_123',
      stripePaymentIntentId: 'pi_123',
      status: 'active',
      priceId: 'price_test123',
    })
  })

  it('checkout.session.completed：client_reference_id缺失时回落到metadata.household_id', () => {
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'payment',
          client_reference_id: null,
          metadata: { household_id: 'household-2' },
          customer: 'cus_123',
          payment_intent: 'pi_123',
        },
      },
    } as unknown as Stripe.Event

    expect(extractSubscriptionUpsert(event)?.householdId).toBe('household-2')
  })

  it('两个ID都拿不到household_id时返回null（不是往表里塞一个坏值）', () => {
    const event = {
      type: 'checkout.session.completed',
      data: { object: { mode: 'payment', client_reference_id: null, metadata: {}, customer: 'cus_123' } },
    } as unknown as Stripe.Event

    expect(extractSubscriptionUpsert(event)).toBeNull()
  })

  it('mode不是payment（比如以后误配成subscription）时返回null，不当成一次性购买处理', () => {
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: { mode: 'subscription', client_reference_id: 'household-1', metadata: {}, customer: 'cus_123' },
      },
    } as unknown as Stripe.Event

    expect(extractSubscriptionUpsert(event)).toBeNull()
  })

  it('不认识的事件类型返回null，不当成错误', () => {
    const event = { type: 'invoice.paid', data: { object: {} } } as unknown as Stripe.Event
    expect(extractSubscriptionUpsert(event)).toBeNull()
  })
})
