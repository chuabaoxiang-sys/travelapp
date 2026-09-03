-- =====================================================================
-- 0024_shared_trip_category_id.sql
-- get_shared_trip() 返回的 expenseCategories 之前只有 name/amount——分类的
-- 中文显示名是数据库里存的原始值，前端分享页模板拿到就直接渲染，导致英文
-- 访客看到的分类名永远是中文（这个函数不知道访客选的是哪个语言，也没办法
-- 知道）。加一个 id 字段，前端就能像app内其他地方一样，用 categoryLabel(id, t)
-- 按当前语言查显示名，系统预设分类（seed-cat-*）就能正常双语化；用户自建
-- 分类的 id 查不到key，categoryLabel 会自动落回原始 name，跟之前行为一致。
--
-- 纯 create or replace function，不改表结构、不搬数据，旧的分享链接照常可用。
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
              ) order by it.sort_order
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
  '语言查双语显示名。';
