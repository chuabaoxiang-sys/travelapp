-- =====================================================================
-- 0040_shared_trip_hide_deleted.sql
-- 分享链接不再露出已删除的内容。
--
-- 【问题是什么】
-- 删除整趟行程是软删除（db/dexie.ts 的 deleteTripCascade：行程本身和它名下的
-- 每一天、行程项、账目都只是打上 deleted_at，不真的删掉行）。get_shared_trip
-- 从 0006 起就从没看过 deleted_at——所以一趟开着公开分享的行程被删掉之后，
-- 链接照样能打开，行程安排和花费统计全都看得到。用户以为删掉了，拿到链接的
-- 外人却还能看，这是隐私问题。
-- 2026-09-28 安全审核时记下，2026-10-07 修。修之前查过生产库：当时没有任何一趟
-- 行程开着分享，没有真的泄露过。
--
-- 单笔账目、单个行程项删除走的是硬删除（outbox 推 delete），本来就不会出现在
-- 分享页里；这里对每一层都加 deleted_at 过滤，是为了不依赖"现在只有整趟删除
-- 是软删除"这个前提——以后哪一层改成软删除，分享页也不会跟着漏。
--
-- 【怎么修】
-- 1. 行程本身已删除：当成链接不存在，返回 null。分享页显示的是现成的"这个链接
--    打不开，可能是分享已经关闭"，不会向访客透露"这趟行程被删过"。
-- 2. 每一天、每个行程项、每笔账目：已删除的一律不算，花费总额和分类统计也不算。
-- 3. 顺手跟 0039 一样改成 search_path = '' 加全限定表名——这是匿名可调用的
--    security definer 函数，不该依赖调用方的 search_path。
--
-- 函数名、参数、返回的 JSON 结构都不变，前端（features/share/shareApi.ts）不用改；
-- create or replace 会保留 0006 授给 anon 的执行权限。
-- 排序沿用 0026 修好的"按 start_time 排、没时间的按 sort_order 排在后面"，
-- 分类统计沿用 0024 加的 id 字段——整个函数体是从当前生产库上的定义抄的，
-- 不是从更早的迁移文件抄的（0026 就是吃过这个亏）。
-- =====================================================================

create or replace function public.get_shared_trip(p_token uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip record;
  v_days json;
  v_expense_total numeric;
  v_expense_categories json;
begin
  select id, name, start_date, end_date, public_share_scope, public_share_template
    into v_trip
    from public.trip
    where public_share_token = p_token
      and public_share_scope <> 'none'
      and deleted_at is null;

  if not found then
    return null;
  end if;

  if v_trip.public_share_scope in ('itinerary', 'both') then
    select coalesce(json_agg(t.day_obj order by t.day_date), '[]'::json)
      into v_days
    from (
      select
        d.day_date,
        json_build_object(
          'dayDate', d.day_date,
          'dayTitle', d.title,
          'items', coalesce((
            select json_agg(
              json_build_object(
                'time', case when it.start_time is null then null else to_char(it.start_time, 'HH24:MI') end,
                'title', it.title,
                'locationName', it.location_name
              ) order by it.start_time nulls last, it.sort_order
            )
            from public.itinerary_item it
            where it.day_id = d.id
              and it.deleted_at is null
          ), '[]'::json)
        ) as day_obj
      from public.itinerary_day d
      where d.trip_id = v_trip.id
        and d.deleted_at is null
    ) t;
  end if;

  if v_trip.public_share_scope in ('expenses', 'both') then
    select coalesce(sum(e.home_amount), 0)
      into v_expense_total
      from public.expense e
      where e.trip_id = v_trip.id
        and e.deleted_at is null;

    select coalesce(json_agg(json_build_object('id', s.id, 'name', s.name, 'amount', s.total) order by s.total desc), '[]'::json)
      into v_expense_categories
    from (
      select c.id, c.name, sum(e.home_amount) as total
      from public.expense e
      join public.expense_category c on c.id = e.category_id
      where e.trip_id = v_trip.id
        and e.deleted_at is null
      group by c.id, c.name
    ) s;
  end if;

  return json_build_object(
    'name', v_trip.name,
    'startDate', v_trip.start_date,
    'endDate', v_trip.end_date,
    'scope', v_trip.public_share_scope,
    'template', v_trip.public_share_template,
    'days', v_days,
    'expenseTotal', v_expense_total,
    'expenseCategories', v_expense_categories
  );
end;
$$;
