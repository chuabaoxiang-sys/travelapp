-- =====================================================================
-- 0006_public_share.sql
-- 只读分享链接：把 trip.public_share_enabled（布尔值）换成
-- trip.public_share_scope（分享范围），并新增一个数据库函数
-- get_shared_trip，供匿名访客（没有登录、没有 household_id）安全地
-- 只读取"该分享的那部分数据"。
--
-- 【为什么用数据库函数而不是放宽 RLS】
-- 0004_household_isolation.sql 已经把所有表都锁成"只有 current_household_id()
-- 匹配才能读"，匿名访客完全没有 household_id，直接放宽某张表的 RLS 会牵连太广、
-- 也没法精确控制"只给这几个字段"。用一个 security definer 函数，内部用提升的
-- 权限查数据、只 json_build_object 出该给的字段，是唯一一处对外的口子，
-- 不引入任何新的高权限密钥（不需要 service_role key，函数本身已经够用）。
--
-- 【为什么账目只给汇总，不给明细】
-- 0001_init.sql 建 trip 表时就已经写好注释：账目相关表"在查询层完全不引用
-- 这个 token"——这里延续同样的边界，get_shared_trip 只用 sum()/group by
-- 算出汇总数字，从不 select 单笔 expense 的行。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. trip 表结构调整：public_share_enabled(boolean) → public_share_scope(text)
-- ---------------------------------------------------------------------

alter table trip add column public_share_scope text not null default 'none'
  check (public_share_scope in ('none', 'itinerary', 'expenses', 'both'));

alter table trip add column public_share_template text;

-- 旧的 public_share_enabled 从来没有被任何真实功能设置成 true 过（这个功能一直
-- 没做完），直接丢弃即可，不需要数据迁移
alter table trip drop constraint if exists trip_public_share_enabled_check;
alter table trip drop column if exists public_share_enabled;

-- 旧约束("开启分享必须有token")等价换成新字段的版本
alter table trip add constraint trip_public_share_scope_token_check
  check (public_share_scope = 'none' or public_share_token is not null);

comment on column trip.public_share_scope is
  '只读分享链接要分享的范围：none=未开启，itinerary=仅行程，expenses=仅花费汇总，both=两者都有。'
  '花费汇总由 get_shared_trip() 现算，从不暴露单笔明细。';

comment on column trip.public_share_template is
  '选中的分享页模板ID（对应前端 src/features/share/templates 下的组件），未选则为 null。';

-- ---------------------------------------------------------------------
-- 2. get_shared_trip：唯一对匿名访客开放的读取口子
-- ---------------------------------------------------------------------

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

comment on function public.get_shared_trip(uuid) is
  '只读分享链接的唯一数据入口。security definer 提升权限查数据，但只返回该分享范围内的、'
  '已经过滤好的字段——不暴露成员姓名、备注、花费明细、household_id 等任何家庭内部信息。'
  '找不到 token 或分享已关闭时返回 null。';

-- 允许匿名（未登录）角色调用这个函数——这是整个方案里唯一对匿名开放的口子
grant execute on function public.get_shared_trip(uuid) to anon;
