-- =====================================================================
-- 0026_fix_shared_itinerary_time_order.sql
-- 修复真实回归：0010 已经把分享页同一天的行程项排序改成"按start_time排，
-- 没时间的按sort_order排在后面"（跟App内部domain/itinerary.ts的
-- sortItineraryItems同一个逻辑）。但后来0024为了加expenseCategories的id
-- 字段，重写整个函数体时是从更早的版本抄的，order by那一句漏掉了
-- `it.start_time nulls last`，等于把0010修好的排序问题又改回去了——
-- 分享页同一天的行程项又变回按sort_order（创建/拖动排序用的字段）排，
-- 跟实际记录的时间对不上。
--
-- 这次只改order by那一行，其余部分（包括0024加的expenseCategories.id）
-- 原样保留，不重新引入别的回归。
-- =====================================================================

create or replace function public.get_shared_trip(p_token uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip record;
  v_days json;
  v_expense_total numeric;
  v_expense_categories json;
begin
  select id, name, start_date, end_date, public_share_scope, public_share_template
    into v_trip
    from trip
    where public_share_token = p_token
      and public_share_scope <> 'none';

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
            from itinerary_item it
            where it.day_id = d.id
          ), '[]'::json)
        ) as day_obj
      from itinerary_day d
      where d.trip_id = v_trip.id
    ) t;
  end if;

  if v_trip.public_share_scope in ('expenses', 'both') then
    select coalesce(sum(e.home_amount), 0)
      into v_expense_total
      from expense e
      where e.trip_id = v_trip.id;

    select coalesce(json_agg(json_build_object('id', s.id, 'name', s.name, 'amount', s.total) order by s.total desc), '[]'::json)
      into v_expense_categories
    from (
      select c.id, c.name, sum(e.home_amount) as total
      from expense e
      join expense_category c on c.id = e.category_id
      where e.trip_id = v_trip.id
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

comment on function public.get_shared_trip(uuid) is
  '只读分享链接的唯一数据入口。security definer 提升权限查数据，但只返回该分享范围内的、'
  '已经过滤好的字段——不暴露成员姓名、备注、花费明细、household_id 等任何家庭内部信息。'
  '找不到 token 或分享已关闭时返回 null。expenseCategories 附带分类 id，供前端按当前'
  '语言查双语显示名。行程项按start_time排序（没时间的按sort_order排在后面）。';
