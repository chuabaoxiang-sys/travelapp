-- =====================================================================
-- 免费额度：每个household终生只能免费建1趟行程，第2趟起需要
-- household_subscription.status = 'active'（见0028）才能继续建
-- =====================================================================
-- 为什么不能直接数"当前存在几趟行程"：deleteTripCascade（src/db/dexie.ts）
-- 是真删除，行程和账目全部级联清掉。如果按实时行程数判断，删掉一趟再建
-- 一趟就能无限白嫖——必须是"历史上建过几趟"的只增不减计数器，而且不能
-- 放在本地Dexie（换设备/清缓存就能重置），只能放在Supabase由服务端函数
-- 负责递增。
alter table household
  add column trips_created_count integer not null default 0,
  add column trip_limit_exempt   boolean not null default false;

-- 老用户（开发者自己的家庭+现有测试家庭）永久豁免——这是给"这个规则上线时
-- 已经存在的household"做的一次性豁免动作，不是发一次免费额度；以后新建的
-- household默认trip_limit_exempt=false，不会被这条豁免影响
update household set trip_limit_exempt = true;

-- =====================================================================
-- 检查规则+执行递增一次性做完，跟这个项目里create_household(0022)、
-- apply_stripe_webhook_event(0028)一样的风格——不用触发器事后处理
-- =====================================================================
create or replace function record_trip_creation()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid := current_household_id();
  v_count int;
  v_exempt boolean;
  v_status text;
begin
  if v_household_id is null then
    raise exception 'not a household member';
  end if;

  -- 行锁：避免同一个household两台设备同时点"新建行程"时都通过检查，
  -- 都把count判断成0
  select trips_created_count, trip_limit_exempt into v_count, v_exempt
    from household where id = v_household_id for update;

  select status into v_status
    from household_subscription where household_id = v_household_id;

  if v_exempt or coalesce(v_status, 'none') = 'active' or v_count < 1 then
    update household set trips_created_count = trips_created_count + 1 where id = v_household_id;
    return;
  end if;

  raise exception 'TRIP_LIMIT_REACHED';
end;
$$;

comment on function record_trip_creation is
  '建行程之前调用一次——通过就把trips_created_count+1，不通过就抛
  TRIP_LIMIT_REACHED异常，客户端(src/domain/billing.ts)靠这个字符串
  区分"被免费额度拦下"和其他网络/意外错误。免费额度硬编码1趟，不做成
  可配置项。';

grant execute on function record_trip_creation() to authenticated;
