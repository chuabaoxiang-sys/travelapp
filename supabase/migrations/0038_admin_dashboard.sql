-- =====================================================================
-- 0038_admin_dashboard.sql
-- 开发者专用的"数据后台"——只给开发者本人看的汇总数字，普通用户完全调不到。
--
-- 【为什么必须是security definer】
-- 后台要回答的问题天然是"跨团队"的：一共注册了几个账号、几个团队、谁注册
-- 了但一直没进任何团队。这些数据一部分在auth.users（普通角色根本没有读权限），
-- 另一部分在household/trip/expense里，而这些表的RLS（0004起）把每个登录用户
-- 牢牢锁在current_household_id()自己那一个团队里。普通函数跑出来只能看到
-- 开发者自己团队的数字，没有意义——只能用security definer以函数owner身份
-- 读，再由函数第一行自己做"是不是开发者"的检查，把门守在函数内部。
--
-- 【为什么用auth.uid()去auth.users查已验证邮箱，不直接信任JWT里的email】
-- 0022的create_household用的是auth.jwt()->>'email'，那里够用——最坏情况只是
-- 给自己建一个团队。这里不一样：一旦判断错，就是把所有用户的账号邮箱、
-- 各团队名称整体交出去。JWT里的email是签发时的快照，账号改邮箱、邮箱还没
-- 验证、或者第三方登录带进来一个没验证过的邮箱，都可能让这个claim跟"真正
-- 属于开发者本人、已经验证过的那个邮箱"不一致。auth.uid()只是签名过的用户id，
-- 拿它去auth.users实时查email_confirmed_at不为空的那一行，才是"此刻、已验证"
-- 的邮箱，不依赖任何可能过期或未验证的claim。
--
-- 【为什么只露汇总数字 + 卡住账号的邮箱 + 团队名称】
-- 这个后台的目的只是看"有没有人在用、卡在哪一步"，不是看别人记了什么账。
-- 所以只返回计数、时间戳、团队名称，以及"注册了但没进团队"那几个账号的
-- 邮箱（开发者需要知道该去联系谁）。不返回任何账目金额/备注、行程名称/目的地、
-- 成员邮箱清单——即使开发者账号本身被盗，这个函数能泄露的也只到这一层。
-- 函数全程只读，不写任何表。
--
-- 【为什么管理员/测试名单放在private schema的表里，而不是写在这个文件里】
-- 这个仓库在GitHub上是公开的。管理员的邮箱、用户id、测试账号邮箱写进迁移文件，
-- 就等于把开发者的个人信息公开发布出去。所以这个文件只建空表，真实名单由开发者
-- 直接在数据库里insert（不进仓库）。安全性本来就不依赖名单保密——判断靠的是
-- 签过名的auth.uid()，知道邮箱也冒充不了——这里只是不想公开个人信息。
-- private schema不在PostgREST的暴露列表里，且对anon/authenticated收回了全部
-- 权限，外部没有任何API能读到这几张表，只有下面两个security definer函数能读。
-- 新环境（比如测试项目）要补数据时：
--   insert into private.dashboard_admin (user_id, email)
--     select id, email from auth.users where lower(email) = lower('<开发者邮箱>');
--   insert into private.dashboard_test_account (email) values ('<测试邮箱>'), ...;
--   insert into private.dashboard_test_household (household_id) values ('<测试团队id>');
--
-- 【为什么管理员要同时对上用户id和已验证邮箱】
-- 用户id是签名JWT里的sub，别人不可能伪造成开发者的id；再要求这一行此刻的邮箱
-- 已验证、且等于登记的邮箱，是第二把锁——万一开发者账号的邮箱被改走（改邮箱需要
-- 新旧两个邮箱都确认，已在后台开启），后台也会立刻自动失效，而不是继续对新邮箱开放。
--
-- 【为什么search_path设成空、所有表都写schema全名】
-- security definer函数以owner身份执行。search_path里如果有可被调用者影响的schema
-- （尤其是会被最先搜索的临时schema pg_temp），理论上可以用同名临时表"冒充"
-- household/trip，骗函数去读假的表。设成空并且所有表都写public./auth./private.
-- 全名，就完全不经过search_path查找，这条路从根上堵死。
--
-- 【为什么测试数据要单独标出来】
-- 数据库里没有"这是测试数据"的标记列，为了一个只有开发者自己看的后台去给
-- auth.users/household加列，改动面太大。测试数据不是被藏起来——卡住账号和团队
-- 列表里照样列出，只是打上isTest，并且不计入totals/last7Days/funnel/daily这些
-- "真实"数字。
--
-- 【为什么按Asia/Kuala_Lumpur切日期】
-- 数据库里的时间都是UTC。开发者和目前的用户都在马来西亚，UTC切日期的话，
-- 早上8点前注册的人会被算到"昨天"，每日柱状图就对不上开发者自己的直觉。
-- 所以daily按马来西亚时间的自然日来切。last7Days是"最近7×24小时"，跟时区无关。
--
-- 【安全性】新增一个private schema（三张空表）和两个函数，不动任何现有表、不改
-- 任何现有数据。执行权限只给authenticated，并显式从public/anon收回——Supabase
-- 默认会把public schema里新函数的执行权限给anon，不收回的话匿名请求也能打进来
-- （虽然进来之后第一行检查一样会拒绝，但门不该开）。
-- =====================================================================

-- ---------------------------------------------------------------------
-- private schema：只有security definer函数能读，外部API完全碰不到
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.dashboard_admin (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);

create table if not exists private.dashboard_test_account (
  email      text primary key,
  created_at timestamptz not null default now()
);

create table if not exists private.dashboard_test_household (
  household_id uuid primary key references public.household (id) on delete cascade,
  created_at   timestamptz not null default now()
);

-- 双保险：就算哪天有人误把private加进暴露的schema、或误发了grant，RLS开着且
-- 没有任何policy，普通角色照样一行都读不到
alter table private.dashboard_admin          enable row level security;
alter table private.dashboard_test_account   enable row level security;
alter table private.dashboard_test_household enable row level security;
revoke all on all tables in schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 开发者判断
-- ---------------------------------------------------------------------
create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from private.dashboard_admin a
      join auth.users u on u.id = a.user_id
     where a.user_id = auth.uid()
       and u.email_confirmed_at is not null
       and lower(u.email) = lower(a.email)
  )
$$;

comment on function public.is_app_admin() is
  '当前登录用户是不是开发者本人：auth.uid()必须在private.dashboard_admin里，'
  '且这个账号此刻的邮箱已验证、等于登记的邮箱。只返回调用者自己的true/false，'
  '不泄露任何别人的信息，所以前端可以直接调它决定要不要显示"数据后台"入口——'
  '但入口显示与否不是安全边界，真正的门在admin_dashboard_stats第一行。';

-- ---------------------------------------------------------------------
-- 数据后台的全部数字：一次调用返回一个jsonb
-- ---------------------------------------------------------------------
-- 返回结构（key固定是这些camelCase名字，前端直接按这个读）：
--   generatedAt, totals{accounts,households,trips,supportedHouseholds},
--   last7Days{同totals}, funnel{registered,inHousehold,householdHasTrip,
--   householdHasExpense,householdSupported}, daily[{date,accounts,testAccounts,trips}],
--   stuckAccounts[{email,provider,createdAt,lastSeenAt,isTest}],
--   households[{id,name,createdAt,memberCount,signedInMemberCount,tripCount,
--               expenseCount,lastActivityAt,tripLimitExempt,supported,isTest}]
-- 空数组一律是[]，不会是null。
--
-- 整个查询写成一条SQL（测试名单在cfg这个CTE里从private表读出），不用plpgsql
-- 变量——这样去掉第一行的权限检查后，可以原样拿到SQL Editor里跑，结果跟函数
-- 完全一致，方便核对数字。
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return (
    -- @@query-begin@@
    with
    cfg as (
      select
        -- 测试账号（按邮箱，不分大小写）和测试团队（按id）——不计入任何"真实"数字
        (select coalesce(array_agg(lower(x.email)), '{}'::text[])
           from private.dashboard_test_account x)                   as test_emails,
        (select coalesce(array_agg(x.household_id), '{}'::uuid[])
           from private.dashboard_test_household x)                 as test_household_ids,
        now() - interval '7 days'                                   as since_7d,
        (now() at time zone 'Asia/Kuala_Lumpur')::date              as today_myt
    ),
    acct as (
      select
        u.id,
        u.email,
        lower(u.email)                                              as email_l,
        u.raw_app_meta_data ->> 'provider'                          as provider,
        u.created_at,
        -- "最近一次打开APP"：last_sign_in_at只在真正输验证码/走OAuth时更新，装成PWA
        -- 后靠保存的会话自动续期的人永远停在注册那一刻，会被误判成"没再回来"。
        -- 会话每次续期都会刷新auth.sessions，取三者最新的一个才是真实的最近活动
        greatest(
          u.last_sign_in_at,
          (select max(s.updated_at) from auth.sessions s where s.user_id = u.id),
          (select max(s.refreshed_at) at time zone 'UTC' from auth.sessions s where s.user_id = u.id)
        )                                                           as last_seen_at,
        coalesce(lower(u.email) = any (cfg.test_emails), false)     as is_test
      from auth.users u
      cross join cfg
    ),
    hh as (
      select
        h.id,
        h.name,
        h.created_at,
        h.trip_limit_exempt,
        h.id = any (cfg.test_household_ids)                         as is_test
      from public.household h
      cross join cfg
    ),
    live_trip as (
      select t.household_id, t.created_at from public.trip t where t.deleted_at is null
    ),
    live_expense as (
      select e.household_id from public.expense e where e.deleted_at is null
    ),
    active_sub as (
      select s.household_id, s.purchased_at from public.household_subscription s where s.status = 'active'
    ),
    -- 账号在"非测试团队"里的归属（邮箱不分大小写匹配）——测试账号也算进来，
    -- stuckAccounts要靠它判断；漏斗再单独排除测试账号
    membership as (
      select distinct a.id as account_id, a.is_test as account_is_test, hm.household_id
        from acct a
        join public.household_member hm on lower(hm.email) = a.email_l
        join hh on hh.id = hm.household_id and not hh.is_test
    ),
    hh_stats as (
      select
        hh.*,
        (select count(*) from public.household_member hm where hm.household_id = hh.id)   as member_count,
        (select count(*) from public.household_member hm
          where hm.household_id = hh.id
            and exists (select 1 from acct a where a.email_l = lower(hm.email)))  as signed_in_member_count,
        (select count(*) from live_trip t where t.household_id = hh.id)            as trip_count,
        (select count(*) from live_expense e where e.household_id = hh.id)         as expense_count,
        exists (select 1 from active_sub s where s.household_id = hh.id)           as supported,
        -- "最近有动静"：软删除也算一次操作，所以这里不排除deleted_at；greatest忽略null，
        -- 三个都没有才是null
        greatest(
          (select max(t.updated_at) from public.trip t where t.household_id = hh.id),
          (select max(e.updated_at) from public.expense e where e.household_id = hh.id),
          (select max(l.created_at) from public.audit_log l where l.household_id = hh.id)
        )                                                                          as last_activity_at
      from hh
    ),
    day_range as (
      select
        (select min((x.created_at at time zone 'Asia/Kuala_Lumpur')::date)
           from (select created_at from auth.users
                 union all
                 select created_at from public.trip) x)             as first_day,
        cfg.today_myt                                               as last_day
      from cfg
    ),
    days as (
      select r.first_day + i as day
        from day_range r
        cross join lateral generate_series(0, r.last_day - r.first_day) as i
    ),
    acct_by_day as (
      select (a.created_at at time zone 'Asia/Kuala_Lumpur')::date as day,
             count(*) filter (where not a.is_test)                 as accounts,
             count(*) filter (where a.is_test)                     as test_accounts
        from acct a
       group by 1
    ),
    trip_by_day as (
      select (t.created_at at time zone 'Asia/Kuala_Lumpur')::date as day,
             count(*)                                               as trips
        from live_trip t
        join hh on hh.id = t.household_id and not hh.is_test
       group by 1
    )
    select jsonb_build_object(
      'generatedAt', now(),

      'totals', jsonb_build_object(
        'accounts',            (select count(*) from acct a where not a.is_test),
        'households',          (select count(*) from hh where not hh.is_test),
        'trips',               (select count(*) from live_trip t
                                  join hh on hh.id = t.household_id and not hh.is_test),
        'supportedHouseholds', (select count(*) from active_sub s
                                  join hh on hh.id = s.household_id and not hh.is_test)
      ),

      'last7Days', (
        select jsonb_build_object(
          'accounts',            (select count(*) from acct a
                                   where not a.is_test and a.created_at >= cfg.since_7d),
          'households',          (select count(*) from hh
                                   where not hh.is_test and hh.created_at >= cfg.since_7d),
          'trips',               (select count(*) from live_trip t
                                    join hh on hh.id = t.household_id and not hh.is_test
                                   where t.created_at >= cfg.since_7d),
          'supportedHouseholds', (select count(*) from active_sub s
                                    join hh on hh.id = s.household_id and not hh.is_test
                                   where s.purchased_at >= cfg.since_7d)
        )
        from cfg
      ),

      -- 漏斗按"真实账号"算人头：每一层都是"至少属于一个满足条件的非测试团队"的账号数
      'funnel', jsonb_build_object(
        'registered',          (select count(*) from acct a where not a.is_test),
        'inHousehold',         (select count(distinct m.account_id) from membership m
                                 where not m.account_is_test),
        'householdHasTrip',    (select count(distinct m.account_id) from membership m
                                 where not m.account_is_test
                                   and exists (select 1 from live_trip t where t.household_id = m.household_id)),
        'householdHasExpense', (select count(distinct m.account_id) from membership m
                                 where not m.account_is_test
                                   and exists (select 1 from live_expense e where e.household_id = m.household_id)),
        'householdSupported',  (select count(distinct m.account_id) from membership m
                                 where not m.account_is_test
                                   and exists (select 1 from active_sub s where s.household_id = m.household_id))
      ),

      'daily', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'date',         to_char(d.day, 'YYYY-MM-DD'),
                 'accounts',     coalesce(ad.accounts, 0),
                 'testAccounts', coalesce(ad.test_accounts, 0),
                 'trips',        coalesce(td.trips, 0)
               ) order by d.day), '[]'::jsonb)
          from days d
          left join acct_by_day ad on ad.day = d.day
          left join trip_by_day td on td.day = d.day
      ),

      -- 注册了、但没进任何非测试团队的账号——开发者要知道该去问谁卡在哪
      'stuckAccounts', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'email',        a.email,
                 'provider',     a.provider,
                 'createdAt',    a.created_at,
                 'lastSeenAt',   a.last_seen_at,
                 'isTest',       a.is_test
               ) order by a.created_at desc, a.id), '[]'::jsonb)
          from acct a
         where not exists (select 1 from membership m where m.account_id = a.id)
      ),

      'households', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'id',                  s.id,
                 'name',                s.name,
                 'createdAt',           s.created_at,
                 'memberCount',         s.member_count,
                 'signedInMemberCount', s.signed_in_member_count,
                 'tripCount',           s.trip_count,
                 'expenseCount',        s.expense_count,
                 'lastActivityAt',      s.last_activity_at,
                 'tripLimitExempt',     s.trip_limit_exempt,
                 'supported',           s.supported,
                 'isTest',              s.is_test
               ) order by greatest(coalesce(s.last_activity_at, s.created_at), s.created_at) desc, s.id),
               '[]'::jsonb)
          from hh_stats s
      )
    )
    -- @@query-end@@
  );
end;
$$;

comment on function public.admin_dashboard_stats() is
  '开发者专用数据后台的全部数字，返回一个jsonb。第一行检查is_app_admin()，'
  '不是开发者直接抛42501。security definer是为了读auth.users和跨团队的汇总——'
  '这些是RLS平时刻意隔开的，所以只返回计数/时间戳/团队名称/卡住账号的邮箱，'
  '不返回任何账目内容、行程详情或成员邮箱清单。测试名单在private schema的表里，'
  '在列表中打isTest标记、不计入真实数字。daily按Asia/Kuala_Lumpur自然日切。只读。'
  'search_path为空，所有表写schema全名。';

-- ---------------------------------------------------------------------
-- 执行权限：只给已登录用户，显式收回public/anon
-- ---------------------------------------------------------------------
revoke execute on function public.is_app_admin()          from public, anon;
revoke execute on function public.admin_dashboard_stats() from public, anon;
grant  execute on function public.is_app_admin()          to authenticated;
grant  execute on function public.admin_dashboard_stats() to authenticated;
