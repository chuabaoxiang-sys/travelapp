-- =====================================================================
-- 0022_self_serve_household_creation.sql
-- 自助创建全新团队——补上0018注释里明确说过"这次刻意不做"的那一半。
--
-- 【为什么现在做】用户决定这个功能迟早要做（组队记账天然带病毒扩散，但现在
-- 建团队完全靠开发者手动跑SQL，迟早会变成瓶颈），不如现在顺手做完。但同时
-- 明确要求：这次上线后，生产环境对真实用户的行为必须完全不变——真正开放
-- 注册是以后另一个单独、明确的动作，不是这次迁移的一部分。
--
-- 【总开关：一个函数，不是一张表】一个永远只有一行、不需要历史记录的布尔值，
-- 不值得为它建表；Postgres的GUC（ALTER DATABASE）也不合适——Supabase走连接池
-- (Supavisor)，旧连接不一定立刻感知到GUC的变化，没法确定"到底生效了没"。
-- CREATE OR REPLACE FUNCTION改完对所有新调用立刻生效，而且跟这个项目一直以来
-- "开发者手动跑一条明确的SQL/MCP操作"的模式完全一致。
--
-- 默认false。以后真要开放时，另外单独跑一条
--   create or replace function self_serve_signup_enabled() ... as $$ select true $$;
-- 不属于这次迁移，也不应该在同一次迁移里出现。
-- =====================================================================

create or replace function self_serve_signup_enabled()
returns boolean
language sql
stable
set search_path = public
as $$
  select false
$$;

comment on function self_serve_signup_enabled() is
  '自助创建团队功能的总开关。默认false（关闭）。开发者要开放时，另外单独跑一条'
  'create or replace function ... select true 语句——不属于任何一次迁移，'
  '这样才能保证迁移本身上线后行为完全不变。测试环境和生产环境都从false开始。'
  '不是security definer：本身不访问任何表，没有需要绕过的RLS，也不需要grant给'
  '任何角色——只在其他函数内部被调用。加search_path纯粹是消掉linter警告，'
  '这个函数本身不引用任何表/对象，search_path可变与否实际不构成风险。';

-- ---------------------------------------------------------------------
-- is_invited_email 改写：开关打开时，任何邮箱都算"被邀请"
-- ---------------------------------------------------------------------
-- 开关关闭时 `false or exists(...)` 等价于原来的 `exists(...)`——对现有
-- 被邀请/未被邀请的邮箱行为完全不变，这是保证"这次上线不改变生产行为"的
-- 关键一行。
create or replace function is_invited_email(check_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select self_serve_signup_enabled()
      or exists(select 1 from household_member where email = check_email)
$$;

comment on function is_invited_email(text) is
  '登录前的邀请名单检查，只返回true/false。开关(self_serve_signup_enabled)打开后，'
  '任何邮箱都视为"被邀请"，允许陌生邮箱走到登录+自助建团这条路；开关关闭时'
  '（默认）行为跟0005版本完全一样，只检查household_member。不需要登录即可调用。';

-- ---------------------------------------------------------------------
-- 新RPC：自助创建一个全新团队
-- ---------------------------------------------------------------------
-- 跟 join_household_by_invite_code（0007）的关键差异：调用者此时已经登录
-- （走到这个函数之前，App.tsx 已经是 authState='no-household'，说明有session），
-- 所以邮箱从 auth.jwt() 服务端读取，不信任客户端传参；只grant给authenticated，
-- 不给anon。
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
  '直接报错——错误信息可以直接展示给已登录用户，不需要对匿名调用者隐藏细节'
  '（这个函数没有grant给anon，匿名根本调不到）。团队隐蔽性不受影响：新团队的id'
  '仍是随机UUID，这个函数不返回、也不查询任何别的团队的信息，跟0004定的设计'
  '目标一致。';

grant execute on function create_household(text) to authenticated;
