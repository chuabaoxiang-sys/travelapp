-- =====================================================================
-- 0034_create_household_reject_existing_member.sql
-- create_household()补一个前置检查：邮箱已经属于某个团队时拒绝再建新团队
--
-- 【为什么现在补】0022写这个RPC时，唯一入口是NoHouseholdScreen——只有
-- current_household_id()解析不出任何团队(邮箱在household_member里一条记录
-- 都没有)时App.tsx才会渲染这个界面，TeamSwitcher也只提供"切换到已加入的
-- 团队"，从来没有"新建团队"这个按钮，所以0022一直假设"能调到这个RPC的
-- 邮箱，必然还没有任何团队"，没有在函数内部再校验一遍。
--
-- 0032上线"每个团队终生限免1趟行程"之后，这个假设第一次变成了真正的问题：
-- 这个RPC本身grant给了authenticated、且不检查调用者现状，任何已经加入过
-- 某个团队(不管是自己的、还是被邀请进别人的)的登录用户，都能直接在浏览器
-- 控制台调 supabase.rpc('create_household', {p_name: 'x'})，绕开界面凭空
-- 建一个全新团队——新团队trip_limit_exempt默认false、trips_created_count
-- 默认0(见0032)，等于每次调用都能换来一趟新的免费额度，把这条限制形同虚设。
--
-- 【修法】直接在函数里加一个前置检查：这个邮箱在household_member里已经有
-- 任意一条记录，就拒绝创建。这跟0022注释里"这个函数本来就是给完全没有团队
-- 的用户用的"这个初衷完全一致，属于把设计意图补成真正的服务端约束，不是
-- 改变这个RPC原本该有的行为。
-- =====================================================================

create or replace function create_household(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_name  text;
  v_household_id uuid;
begin
  if not self_serve_signup_enabled() then
    raise exception '自助创建团队功能尚未开放，请联系开发者';
  end if;

  v_email := auth.jwt() ->> 'email';
  if v_email is null then
    raise exception '未登录';
  end if;

  if exists (select 1 from household_member where email = v_email) then
    raise exception '这个邮箱已经属于一个团队，不能再创建新团队';
  end if;

  v_name := nullif(trim(p_name), '');
  if v_name is null then
    raise exception '团队名称不能为空';
  end if;

  insert into household (name) values (v_name) returning id into v_household_id;
  insert into household_member (household_id, email) values (v_household_id, v_email);

  -- 复用0018已有的"设为当前团队"逻辑，不在这里重写一遍插入household_active的代码——
  -- 刚插入的household_member行在同一事务内可见，set_active_household的成员校验能立刻通过
  perform set_active_household(v_household_id);

  return v_household_id;
end;
$$;

comment on function create_household(text) is
  '自助创建一个全新团队，把当前登录邮箱设为该团队唯一成员，并立刻把服务端'
  '"当前团队"指针指向它。仅在self_serve_signup_enabled()为true时可用，否则'
  '直接报错。0034起额外要求这个邮箱当前不属于任何团队——防止已有团队的用户'
  '绕开界面直接调RPC凭空建团队、借此刷出新的免费行程额度(见0032的1趟限免)。'
  '团队隐蔽性不受影响：新团队的id仍是随机UUID，这个函数不返回、也不查询任何'
  '别的团队的信息，跟0004定的设计目标一致。';

grant execute on function create_household(text) to authenticated;
