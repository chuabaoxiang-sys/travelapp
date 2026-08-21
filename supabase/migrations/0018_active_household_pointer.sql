-- =====================================================================
-- 0018_active_household_pointer.sql
-- 多团队支持（第1/3步：纯后端）：让一个邮箱可以属于多个团队，并且能明确指定
-- "我现在在哪个团队"。
--
-- 【背景】household_member 的主键是 (household_id, email) 复合键，"一个邮箱属于
-- 多个团队"从 0004 起就是允许的。0017 修掉了"挑哪一个是不确定的"这个 bug，让
-- 选择变成确定的（最早加入的团队），但那只是让结果稳定，人还是没法自己选。
-- 这次补上"能选"这一半。
--
-- 【为什么必须存在服务端，不能放在手机本地】所有业务表的 RLS 策略都是
-- `household_id = current_household_id()`，这个判断在 Postgres 里跑，看不到浏览器
-- 的 localStorage。所以"当前是哪个团队"必须是服务端能读到的状态。
-- 直接后果（不是缺陷，是这个方案的固有性质）：指针是**按账号**的，不是按设备的。
-- 在手机上切换团队，同一账号的其他设备下次同步时也会跟着切过去。
--
-- 【为什么不用 JWT 的 user_metadata（那样不用建表）】技术上可行且安全——就算用户
-- 伪造 metadata 里的团队ID，下面的函数仍然会校验他是不是该团队成员，伪造值会落到
-- 回落分支。但 metadata 的改动要等 JWT 刷新才生效（最长一小时），表现成"切换了
-- 团队但一小时内毫无反应"。建一张表是即时生效的，这点体验差距值得多一张表。
--
-- 【这次刻意不做】不提供"自助创建新团队"的能力（用户 2026-08-16 做邀请码时就明确
-- 推迟过这个决定，这次沿用）。新团队仍然由管理员手动 insert。所以只有"列出我的
-- 团队"和"设置当前团队"两个 RPC，没有 create。
--
-- 【本次迁移不改变任何现有行为】没有任何人有指针记录，所以所有人都走回落分支，
-- 结果与 0017 完全一致。界面上也还没有入口能触发切换（那是第2/3步）。这是刻意
-- 设计成可以独立、安全上线的一步。
--
-- 【没有改动 RLS 策略】11张业务表的策略一个字都没动，仍然是
-- `household_id = current_household_id()`，只是那个函数多了一层指针优先。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 指针表
-- ---------------------------------------------------------------------
create table household_active (
  email        text primary key,
  household_id uuid not null references household (id) on delete cascade,
  updated_at   timestamptz not null default now()
);

comment on table household_active is
  '每个邮箱当前选中的团队。一行一个邮箱（email 是主键），切换团队就是覆盖这一行。'
  '外键 on delete cascade：团队被删掉时指针自动消失，下次读就落到回落分支，'
  '不会留下指向已删团队的悬空指针。';

-- 启用 RLS 但**故意不建任何策略**——等于默认拒绝一切直接访问。
-- 客户端永远不直接读写这张表，全部经由下面两个 security definer 函数，
-- 那两个函数会绕过 RLS 但只做受控的操作（读只返回你自己的团队列表，
-- 写会先校验你确实是目标团队的成员）。这比"建一条只能读写自己那行的策略"更严
-- ——少一条策略就少一处将来可能写错的地方。
alter table household_active enable row level security;

-- ---------------------------------------------------------------------
-- 权限判断函数：指针优先，回落到 0017 的确定性规则
-- ---------------------------------------------------------------------
create or replace function current_household_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    -- 1) 明确选定的团队。**必须 join household_member 校验他仍然是成员**——
    --    否则一个人被移出团队后，旧指针会让他继续读写那个团队的数据，
    --    等于绕过了整套隔离机制。这个 join 是这段 SQL 里最要紧的一行。
    (select ha.household_id
       from household_active ha
       join household_member hm
         on hm.household_id = ha.household_id
        and hm.email        = ha.email
      where ha.email = (auth.jwt() ->> 'email')),
    -- 2) 没选过、或者选的那个已经失效（被移出/团队被删）：回落到 0017 那条
    --    确定性规则——最早加入的团队。household_id 做兜底比较，保证完全无歧义。
    (select hm.household_id
       from household_member hm
      where hm.email = (auth.jwt() ->> 'email')
      order by hm.created_at, hm.household_id
      limit 1)
  )
$$;

comment on function current_household_id() is
  '当前登录者所在的团队ID。优先读 household_active 里明确选定的团队（但会重新校验'
  '成员身份，被移出后旧指针立刻失效），没有则回落到"最早加入的团队"。'
  '用 security definer 是因为调用者在 RLS 生效后不一定能直接查 household_member；'
  '函数只返回一个团队ID，不泄露其他信息。'
  '回落分支的排序必须与客户端 src/domain/household.ts 的 getCurrentHouseholdId() 完全'
  '一致，两边挑到不同团队会导致写入被 RLS 静默拒绝。';

-- ---------------------------------------------------------------------
-- RPC 1：列出我属于的所有团队（给切换界面用）
-- ---------------------------------------------------------------------
-- 输出列名刻意用 team_id / team_name 而不是 id / name：returns table 的输出列名会
-- 进入 SQL 体的作用域，跟被 join 的表的列名（household.id、household.name、
-- household_member.household_id）撞名时会报 "column reference is ambiguous"。
-- 用一组在所有相关表里都不存在的名字，从根上避免这个坑。
create or replace function list_my_households()
returns table (team_id uuid, team_name text, is_active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select h.id, h.name, h.id = current_household_id()
  from household h
  join household_member hm on hm.household_id = h.id
  where hm.email = (auth.jwt() ->> 'email')
  order by hm.created_at, h.id
$$;

comment on function list_my_households() is
  '当前登录者属于的团队列表，附带标记哪个是当前选中的。排序与'
  'current_household_id() 的回落规则一致，所以"列表第一个"就是没设过指针时的默认。'
  '只返回自己的团队——查不到别人的团队，也查不到总共有多少团队（团队隐蔽性，见0004）。';

grant execute on function list_my_households() to authenticated;

-- ---------------------------------------------------------------------
-- RPC 2：切换当前团队
-- ---------------------------------------------------------------------
create or replace function set_active_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  v_email := auth.jwt() ->> 'email';
  if v_email is null then
    raise exception '未登录';
  end if;

  -- 只能切到自己确实属于的团队。少了这个检查，任何登录用户都能把指针指向
  -- 任意团队ID——虽然 current_household_id() 那边的 join 会再挡一次（所以不至于
  -- 泄露数据），但那样指针里会存着无效值、行为变得难以推理。在写入口就拦掉更干净。
  if not exists (
    select 1 from household_member
    where email = v_email and household_id = p_household_id
  ) then
    raise exception '你不属于这个团队';
  end if;

  insert into household_active (email, household_id, updated_at)
  values (v_email, p_household_id, now())
  on conflict (email) do update
    set household_id = excluded.household_id,
        updated_at   = now();
end;
$$;

comment on function set_active_household(uuid) is
  '把当前登录者的"当前团队"指针指向 p_household_id。会先校验他确实属于这个团队，'
  '不属于就报错。一个邮箱只有一行指针，切换就是覆盖。'
  '注意：客户端调完这个之后必须清空本地已同步的表并重新拉取——本地数据带着旧团队的'
  'household_id，不清掉会和新团队的数据混在一起。清本地时必须用 withoutOutboxTracking，'
  '否则"清本地"会被同步机制当成"删云端"。';

grant execute on function set_active_household(uuid) to authenticated;
