import { describe, it, expect } from 'vitest'
import type Stripe from 'stripe'
import { extractSubscriptionUpsert } from './stripe-webhook'

// 只测"从Stripe事件里该抽出什么"这部分纯逻辑，不测真实签名校验——那部分需要
// 真实的Stripe签名密钥，得靠Stripe CLI手动/集成测试，不是这里的单测范围。
// 用as unknown as Stripe.Event绕开完整类型要求，只填这个函数实际会读到的字段。
//
// priceId现在是调用方传入的参数（真实handler另外调Stripe API查出来，见
// stripe-webhook.ts里的listLineItems调用），不是从环境变量读——三档定价上线后
// 不再是"只有一个Price在卖"，这里直接传一个假值验证透传逻辑就够了

describe('extractSubscriptionUpsert', () => {
  it('checkout.session.completed（payment模式）：从client_reference_id拿household_id，priceId原样透传', () => {
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

    expect(extractSubscriptionUpsert(event, 'price_test123')).toEqual({
      householdId: 'household-1',
      stripeCustomerId: 'cus_123',
      stripePaymentIntentId: 'pi_123',
      status: 'active',
      priceId: 'price_test123',
    })
  })

  it('查不到price id时传null，照样正常解锁（price_id只是审计用，不阻塞解锁）', () => {
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

    expect(extractSubscriptionUpsert(event, null)?.priceId).toBeNull()
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

    expect(extractSubscriptionUpsert(event, null)?.householdId).toBe('household-2')
  })

  it('两个ID都拿不到household_id时返回null（不是往表里塞一个坏值）', () => {
    const event = {
      type: 'checkout.session.completed',
      data: { object: { mode: 'payment', client_reference_id: null, metadata: {}, customer: 'cus_123' } },
    } as unknown as Stripe.Event

    expect(extractSubscriptionUpsert(event, null)).toBeNull()
  })

  it('mode不是payment（比如以后误配成subscription）时返回null，不当成一次性购买处理', () => {
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: { mode: 'subscription', client_reference_id: 'household-1', metadata: {}, customer: 'cus_123' },
      },
    } as unknown as Stripe.Event

    expect(extractSubscriptionUpsert(event, null)).toBeNull()
  })

  it('不认识的事件类型返回null，不当成错误', () => {
    const event = { type: 'invoice.paid', data: { object: {} } } as unknown as Stripe.Event
    expect(extractSubscriptionUpsert(event, null)).toBeNull()
  })
})
