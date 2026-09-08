-- =====================================================================
-- 团队/Pro——数据表 + 唯一写入通道
-- =====================================================================
-- 定价定成"终生RM99一次性解锁"（不是循环订阅），所以这张表不需要
-- current_period_end/cancel_at_period_end这类"续费/到期"字段——一次性
-- 付费只有"没买"和"买了"两种状态，买了就永久有效，没有中间态。
--
-- 为什么insert/update/delete不给authenticated或anon任何权限：Stripe webhook
-- 通知到达时没有真实用户登录session，没法走current_household_id()那套RLS，
-- 但又不能像常见做法那样让webhook处理代码拿service_role密钥绕过RLS写库——
-- 这个项目明确要求service_role密钥不出现在应用运行时代码里。折中方案：唯一
-- 的写入路径是下面的security definer函数apply_stripe_webhook_event，用存在
-- Supabase Vault里的共享密钥（不是数据库主密钥）做校验，即使这个共享密钥
-- 泄露，攻击者能做的也只是往这一张表塞状态，碰不到数据库里任何其他东西。
-- Stripe自己的签名校验（在api/stripe-webhook.ts里用官方SDK做，不是这里手搓）
-- 仍然是第一道门——这个共享密钥是第二道，不是替代关系。
create table household_subscription (
  household_id             uuid primary key references household(id) on delete cascade,
  stripe_customer_id        text unique,
  stripe_payment_intent_id  text unique,
  -- 'none'：没买过；'active'：买过，永久有效——一次性付费不像循环订阅那样
  -- 还有past_due/canceled这些中间态
  status                    text not null default 'none',
  price_id                  text,
  purchased_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

alter table household_subscription enable row level security;

create policy household_subscription_select on household_subscription
  for select
  using (household_id = current_household_id());

-- =====================================================================
-- 写入函数：用共享密钥代替service_role，把"密钥泄露"的影响范围锁死在
-- 这一张表、这一个函数——不是"数据库管理员权限"，只是"能往这张表塞一行"
-- =====================================================================
create or replace function apply_stripe_webhook_event(
  p_household_id uuid,
  p_stripe_customer_id text,
  p_stripe_payment_intent_id text,
  p_status text,
  p_price_id text,
  p_shared_secret text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
    where name = 'stripe_webhook_shared_secret';

  if v_expected is null or p_shared_secret is distinct from v_expected then
    raise exception 'invalid shared secret';
  end if;

  insert into household_subscription (
    household_id, stripe_customer_id, stripe_payment_intent_id, status, price_id, purchased_at, updated_at
  ) values (
    p_household_id, p_stripe_customer_id, p_stripe_payment_intent_id, p_status, p_price_id, now(), now()
  )
  -- purchased_at故意不在这里覆盖——一次性购买正常只会触发一次，但防御性地保留
  -- "万一被调用第二次，也不重写原始购买时间"这个语义
  on conflict (household_id) do update set
    stripe_customer_id       = excluded.stripe_customer_id,
    stripe_payment_intent_id = excluded.stripe_payment_intent_id,
    status                   = excluded.status,
    price_id                 = excluded.price_id,
    updated_at                = now();
end;
$$;

comment on function apply_stripe_webhook_event is
  'Stripe webhook（api/stripe-webhook.ts）验证过签名之后，用anon key客户端调这个'
  '函数写household_subscription——不是用service_role。p_shared_secret是存在'
  'Supabase Vault里的独立密钥（一次性用SQL手动写入vault.create_secret，不进'
  'migration文件、不进git历史），跟Stripe自己的webhook签名是两道独立的门，'
  '不是互相替代。';

grant execute on function apply_stripe_webhook_event(
  uuid, text, text, text, text, text
) to anon;

-- 注意：apply_stripe_webhook_event能正常工作，还需要一次性手动执行（不在这个
-- migration文件里，避免密钥进git历史）：
--   select vault.create_secret('<随机生成的密钥>', 'stripe_webhook_shared_secret');
-- 同一个密钥值同时要写进Vercel的STRIPE_WEBHOOK_SHARED_SECRET环境变量。
