-- =====================================================================
-- 0042_ledger_mismatch_report.sql
-- 数据后台新增"账对不上"：自动列出总额跟分摊合计对不上的账目。
--
-- 【为什么要做】
-- 2026-10-06 CE 有三笔账被卡住的旧同步记录盖回旧汇率：账目总额按旧汇率算，分摊按新
-- 汇率算，差了 RM2.12。这是开发者手动查库才发现的，前端和数据后台都看不出来。同步那
-- 一层的根因已经修了（见 sync.ts 的 resolvePushAction 和 0041），这里补一道事后体检：
-- 不管将来是什么原因让账对不上，打开数据后台就能看到。
--
-- 【怎么算对不上】
-- 没删除、所在行程也没删除的账目里：
--   1. 有分摊行，但分摊合计跟总额差超过 0.01（留 1 分钱给四舍五入）；或者
--   2. 设了分摊（split_type 不是 none），却一行分摊都没有。
-- 个人开销（none）本来就不分摊，只在它确实有分摊行时才比对合计。
--
-- 【只返回什么】跟 0038 同一个原则，不看具体账目内容
-- 按团队（+本位币）汇总：团队名、是否测试团队、几笔、差额合计、最近一次改动时间。
-- 不返回哪趟行程、哪几笔、备注、单笔金额、谁付的钱。开发者要追查具体是哪几笔，
-- 直接在数据库里查。
--
-- 【对现有东西的影响】只在 admin_dashboard_stats 的返回结构上多一个 ledgerMismatches
-- 键（从 0041 的定义原样抄过来再加），只读，不动任何表、不改任何数据。
-- =====================================================================

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
    ),
    -- 0042：账对不上。没删除的账目里，总额 ≠ 分摊合计（差超过 0.01，留 1 分钱四舍五入的
    -- 余地）；或者设了分摊（split_type 不是 none）却一行分摊都没有。个人开销本来就不分摊，
    -- 只在它确实有分摊行时才比对合计
    split_totals as (
      select s.expense_id, count(*) as n, sum(s.share_amount) as total
        from public.expense_split s
       where s.deleted_at is null
       group by s.expense_id
    ),
    ledger_mismatch as (
      select e.household_id, t.home_currency, e.updated_at,
             abs(e.home_amount - coalesce(st.total, 0))             as diff
        from public.expense e
        join public.trip t on t.id = e.trip_id and t.deleted_at is null
        left join split_totals st on st.expense_id = e.id
       where e.deleted_at is null
         and (
           (st.n is not null and abs(e.home_amount - st.total) > 0.01)
           or (st.n is null and e.split_type <> 'none')
         )
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
      ),

      -- 按团队（+本位币）汇总：只给团队名、几笔、差额合计、最近一次改动时间，
      -- 不给是哪趟行程、哪几笔、备注、金额明细
      'ledgerMismatches', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'householdName', h.name,
                 'isTest',        coalesce(m.household_id = any (cfg.test_household_ids), false),
                 'currency',      m.home_currency,
                 'count',         m.n,
                 'diffTotal',     m.diff_total,
                 'lastChangedAt', m.last_changed_at
               ) order by coalesce(m.household_id = any (cfg.test_household_ids), false), m.diff_total desc), '[]'::jsonb)
          from (
            select x.household_id, x.home_currency, count(*) as n,
                   round(sum(x.diff), 2) as diff_total, max(x.updated_at) as last_changed_at
              from ledger_mismatch x
             group by x.household_id, x.home_currency
          ) m
          left join public.household h on h.id = m.household_id
          cross join cfg
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
  '以及同步卡住上报的技术字段和上报人邮箱（0041）、各团队对不上的账目笔数和差额合计（0042），'
  '不返回任何账目内容、行程详情或成员邮箱清单。测试名单在private schema的表里，'
  '在列表中打isTest标记、不计入真实数字。daily按Asia/Kuala_Lumpur自然日切。只读。'
  'search_path为空，所有表写schema全名。';

-- create or replace 会保留 0038 设好的执行权限（只给 authenticated），这里再写一遍
-- 是为了这个文件单独拿出来看也清楚
revoke execute on function public.admin_dashboard_stats() from public, anon;
grant  execute on function public.admin_dashboard_stats() to authenticated;
