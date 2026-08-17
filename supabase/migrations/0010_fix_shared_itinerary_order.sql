-- =====================================================================
-- 0010_fix_shared_itinerary_order.sql
-- 修复真实bug：分享页里同一天的行程项，一直是按 sort_order（创建/拖动排序用的
-- 那个字段）排的，完全没看 start_time——如果11AM那一项是先加的、9AM是后加的，
-- 分享页就会把11AM排在9AM上面。App内部（domain/itinerary.ts 的
-- sortItineraryItems）早就是"有时间的按时间排，没时间的按sort_order排在后面"，
-- 但这条逻辑只存在于前端，从来没有同步到 get_shared_trip 这个单独的SQL查询里。
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

    select coalesce(json_agg(json_build_object('name', s.name, 'amount', s.total) order by s.total desc), '[]'::json)
      into v_expense_categories
    from (
      select c.name, sum(e.home_amount) as total
      from expense e
      join expense_category c on c.id = e.category_id
      where e.trip_id = v_trip.id
      group by c.name
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
