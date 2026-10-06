-- =====================================================================
-- 0041_sync_problem_reports.sql
-- 同步卡住时，开发者能在数据后台先看到，不用等用户截图。
--
-- 【为什么要做】
-- 2026-10-06 CE 的一条汇率因为重名被服务器拒收，引用它的几笔账跟着卡了一个多小时，
-- 最后还把他改好的数据盖了回去（修复见 sync.ts 的 resolvePushAction、0040 前后几次
-- 提交）。整件事开发者是看到用户发来的"同步详情"截图才知道的。outbox 只存在用户
-- 手机的 IndexedDB 里，服务器那边完全看不到"谁的哪条记录推不上去"。
--
-- 【怎么做】
-- 手机上某条记录重试到第 10 次（跟同步详情里标红"看起来卡住了"是同一个门槛，见
-- domain/syncProblems.ts 的 STUCK_THRESHOLD）还推不上去，就调 report_sync_problem
-- 报一条；之后推成功、或者用户在同步详情里丢弃了，再调 resolve_sync_problem 标记。
-- 数据后台（admin_dashboard_stats 新增的 syncProblems）按"团队 + 账号"汇总展示。
--
-- 【只报什么、绝不报什么】
-- 只报：哪张表（本地表名，如 rateBookEntries）、新增修改还是删除、记录 id（随机
-- uuid，不是内容）、错误代码、错误属于哪条规则（约束名，或者我们自己数据库函数里
-- 写死的 P0001 中文提示）、重试次数、开始排队的时间、APP 版本（git 短 SHA）。
-- 绝不报：任何用户填写的内容。Postgres 报错的 details 那一段会带出具体数值（比如
-- "Key (...)=(..., KRW, rate) already exists" 里的 rate），前端在发送前就只截取
-- 规则名，details/hint 一律不发（见 summarizeSyncError）。这里再对每个字段做长度
-- 截断，防止前端出 bug 时把整段报错原样塞进来。
--
-- 【安全】跟 0038 同一个标准
-- 1. 上报存在 private.sync_problem：private schema 不在 PostgREST 暴露列表里，
--    对 anon/authenticated 收回全部权限，开着 RLS 且没有任何 policy——外部没有
--    任何 API 能直接读写这张表。
-- 2. 手机只能通过两个 security definer 函数"写自己的那一条"：团队用
--    current_household_id()、账号用 auth.uid() 由服务器自己判断，前端传不进来，
--    冒充不了别人；函数不返回任何数据，读不到任何人的上报（包括自己的）。
--    只认邮箱已验证的登录账号；匿名执行权限显式收回。
-- 3. 防刷：同一个账号 24 小时内写入/更新超过 300 条就直接忽略——正常情况下一次
--    事故顶多几条到几十条。
-- 4. 读只有一条路：admin_dashboard_stats，第一行仍然是 is_app_admin() 检查。
--    新增返回的只是团队名、上报人的邮箱（跟 stuckAccounts 一样，开发者需要知道
--    去问谁）和上面那些技术字段，不涉及任何账目/行程内容。
-- 5. search_path = ''，所有表写 schema 全名（理由见 0038）。
--
-- 【对现有东西的影响】
-- 新增一张私有表和两个函数；admin_dashboard_stats 只是在原来的返回结构上多一个
-- syncProblems 键，其余每一段原样保留（从 0038 的定义抄过来，并核对过跟生产库上
-- 正在跑的逻辑一致）。不动任何现有表、不改任何现有数据。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 上报表
-- ---------------------------------------------------------------------
create table if not exists private.sync_problem (
  id           uuid primary key default gen_random_uuid(),
  -- 用户还没进任何团队时 current_household_id() 是 null——那种情况本来也推不了数据，
  -- 留着 null 不拦
  household_id uuid references public.household (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  table_name   text not null,
  operation    text not null,
  record_id    text not null,
  error_code   text,
  error_label  text,
  attempts     integer not null default 0,
  queued_at    timestamptz,
  app_version  text,
  status       text not null default 'stuck' check (status in ('stuck', 'resolved', 'discarded')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  -- 同一个账号同一条记录只占一行：重试次数涨了、恢复了、又卡住了，都是更新这一行
  unique (user_id, table_name, record_id)
);

alter table private.sync_problem enable row level security;
revoke all on private.sync_problem from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 手机上报"卡住了"
-- ---------------------------------------------------------------------
create or replace function public.report_sync_problem(
  p_table text,
  p_operation text,
  p_record_id text,
  p_error_code text,
  p_error_label text,
  p_attempts integer,
  p_queued_at timestamptz,
  p_app_version text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_recent integer;
begin
  if v_uid is null or p_table is null or p_record_id is null then
    return;
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    return;
  end if;

  select count(*) into v_recent
    from private.sync_problem p
   where p.user_id = v_uid
     and p.updated_at > now() - interval '1 day';
  if v_recent >= 300 then
    return;
  end if;

  insert into private.sync_problem (
    household_id, user_id, table_name, operation, record_id,
    error_code, error_label, attempts, queued_at, app_version, status
  ) values (
    public.current_household_id(), v_uid, left(p_table, 40), left(coalesce(p_operation, ''), 10), left(p_record_id, 80),
    left(p_error_code, 10), left(p_error_label, 200), greatest(coalesce(p_attempts, 0), 0), p_queued_at, left(p_app_version, 40), 'stuck'
  )
  on conflict (user_id, table_name, record_id) do update set
    household_id = excluded.household_id,
    operation    = excluded.operation,
    error_code   = excluded.error_code,
    error_label  = excluded.error_label,
    attempts     = greatest(private.sync_problem.attempts, excluded.attempts),
    -- "从什么时候开始卡"取最早的那一次
    queued_at    = least(private.sync_problem.queued_at, excluded.queued_at),
    app_version  = excluded.app_version,
    status       = 'stuck',
    updated_at   = now(),
    resolved_at  = null;
end;
$$;

comment on function public.report_sync_problem(text, text, text, text, text, integer, timestamptz, text) is
  '手机上某条记录重试到第10次还推不上去时调用，写进private.sync_problem。团队和账号由'
  '服务器从登录身份判断；只收技术字段（表名/记录id/错误代码和规则名/次数/版本），'
  '不收任何内容；不返回任何数据；同一账号24小时超过300条直接忽略。见0041说明。';

-- ---------------------------------------------------------------------
-- 手机报"已恢复"（推成功了）或"已丢弃"（用户在同步详情里删掉了）
-- ---------------------------------------------------------------------
create or replace function public.resolve_sync_problem(
  p_table text,
  p_record_id text,
  p_status text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update private.sync_problem p
     set status      = case when p_status = 'discarded' then 'discarded' else 'resolved' end,
         resolved_at = now(),
         updated_at  = now()
   where p.user_id = auth.uid()
     and p.table_name = p_table
     and p.record_id = p_record_id
     and p.status = 'stuck';
end;
$$;

comment on function public.resolve_sync_problem(text, text, text) is
  '之前上报卡住的那条记录推成功了（resolved）或被用户丢弃了（discarded）。只能改'
  '自己账号的行，不返回任何数据。见0041说明。';

revoke execute on function public.report_sync_problem(text, text, text, text, text, integer, timestamptz, text) from public, anon;
revoke execute on function public.resolve_sync_problem(text, text, text) from public, anon;
grant  execute on function public.report_sync_problem(text, text, text, text, text, integer, timestamptz, text) to authenticated;
grant  execute on function public.resolve_sync_problem(text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 数据后台：在 0038 的返回结构上加 syncProblems
-- ---------------------------------------------------------------------
-- 新增的键：
--   syncProblems[{householdName, email, isTest, stuck, since, lastReportedAt,
--                 resolvedAt, maxAttempts, appVersions[], items[{table, code, label, count}]}]
-- 按"团队 + 上报账号"一行。还卡着的全部列出；已恢复/已丢弃的只列最近7天内有变化的。
-- 一个人还有记录卡着时，items 只列卡着的那些（已恢复的不混进来），stuck=true 排在前面。
-- 其余每一段跟 0038 完全相同。
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
    ),
    -- 0041：同步卡住的上报。还卡着的全部要；已恢复/已丢弃的只要最近7天有变化的
    sync_rows as (
      select
        p.household_id,
        p.user_id,
        p.table_name,
        p.error_code,
        p.error_label,
        p.attempts,
        p.status,
        coalesce(p.queued_at, p.created_at)                         as since,
        p.updated_at,
        p.resolved_at,
        p.app_version,
        u.email,
        coalesce(p.household_id = any (cfg.test_household_ids), false)
          or coalesce(lower(u.email) = any (cfg.test_emails), false) as is_test
      from private.sync_problem p
      left join auth.users u on u.id = p.user_id
      cross join cfg
      where p.status = 'stuck' or p.updated_at >= cfg.since_7d
    ),
    sync_people as (
      select
        r.household_id,
        r.user_id,
        max(r.email)                                                as email,
        bool_or(r.is_test)                                          as is_test,
        bool_or(r.status = 'stuck')                                 as stuck,
        -- 还卡着：从卡着的那几条里最早的一条开始算；都恢复了：整段事故最早的那一条
        coalesce(min(r.since) filter (where r.status = 'stuck'), min(r.since)) as since,
        max(r.updated_at)                                           as last_reported_at,
        max(r.resolved_at)                                          as resolved_at,
        coalesce(max(r.attempts) filter (where r.status = 'stuck'), max(r.attempts)) as max_attempts,
        array_agg(distinct r.app_version) filter (where r.app_version is not null) as app_versions
      from sync_rows r
      group by r.household_id, r.user_id
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
      ),

      'syncProblems', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'householdName',  h.name,
                 'email',          sp.email,
                 'isTest',         sp.is_test,
                 'stuck',          sp.stuck,
                 'since',          sp.since,
                 'lastReportedAt', sp.last_reported_at,
                 'resolvedAt',     case when sp.stuck then null else sp.resolved_at end,
                 'maxAttempts',    sp.max_attempts,
                 'appVersions',    coalesce(to_jsonb(sp.app_versions), '[]'::jsonb),
                 'items', (
                   select coalesce(jsonb_agg(jsonb_build_object(
                            'table', i.table_name,
                            'code',  i.error_code,
                            'label', i.error_label,
                            'count', i.n
                          ) order by i.n desc, i.table_name), '[]'::jsonb)
                     from (
                       select r.table_name, r.error_code, r.error_label, count(*) as n
                         from sync_rows r
                        where r.household_id is not distinct from sp.household_id
                          and r.user_id = sp.user_id
                          and (not sp.stuck or r.status = 'stuck')
                        group by r.table_name, r.error_code, r.error_label
                     ) i
                 )
               ) order by sp.stuck desc, sp.last_reported_at desc), '[]'::jsonb)
          from sync_people sp
          left join public.household h on h.id = sp.household_id
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
  '以及同步卡住上报的技术字段和上报人邮箱（0041），'
  '不返回任何账目内容、行程详情或成员邮箱清单。测试名单在private schema的表里，'
  '在列表中打isTest标记、不计入真实数字。daily按Asia/Kuala_Lumpur自然日切。只读。'
  'search_path为空，所有表写schema全名。';

-- create or replace 会保留 0038 设好的执行权限（只给 authenticated），这里再写一遍
-- 是为了这个文件单独拿出来看也清楚
revoke execute on function public.admin_dashboard_stats() from public, anon;
grant  execute on function public.admin_dashboard_stats() to authenticated;
