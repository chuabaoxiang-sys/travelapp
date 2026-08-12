-- =====================================================================
-- 0004_household_isolation.sql
-- 多租户数据隔离：邀请陌生团队共用同一个部署时，团队之间必须完全看不到
-- 彼此的数据、也不能互相知道对方存在（不只是数据隔离，团队本身也要隐蔽）
--
-- 【登录方式的选择】用 Supabase 自带的邮箱验证登录（magic link），不用
-- "团队共享一个邀请码"——共享码泄露了防不住、也没法单独收回某一个人的权限。
-- 全程不需要 service_role（数据库管理员密钥）出现在任何运行中的代码里：
-- 邀请新人＝管理员直接在 Supabase 后台手动往 household_member 插一行，
-- 权限判断是"实时查这个邮箱属于哪个团队"，不是相信一个提前发好的令牌。
--
-- 【团队隐蔽性怎么保证】
--   1. household.id 用随机 UUID，不用连续数字——避免暴露"总共有几个团队"
--   2. 被 RLS 挡住的行为默认 SELECT 返回0行、不是"存在但拒绝"，天然不泄露信息
--   3. household 表和 household_member 表自己也套上 RLS，只能查到自己那一条，
--      查不到团队总数、查不到别的团队叫什么名字
--   4. APP 本身不做任何"查看所有团队"的界面/接口——管理团队全程是管理员在
--      Supabase 后台手动操作，没有留后门
-- =====================================================================

create table household (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

comment on table household is
  '一个"团队"（可能是一个家庭，也可能是一个朋友旅行群）——数据隔离的边界。'
  '只能由管理员手动创建（在 Supabase 后台直接 insert），APP 里没有自助注册新团队的入口。';

-- 一个邮箱可以属于多个团队（万一同一个人参与了两趟不同团队的行程），
-- 所以是 (household_id, email) 复合主键，不是给 email 单独建唯一索引
create table household_member (
  household_id  uuid not null references household (id) on delete cascade,
  email         text not null,
  created_at    timestamptz not null default now(),
  primary key (household_id, email)
);

comment on table household_member is
  '哪个邮箱属于哪个团队——RLS 判断权限时实时查这张表，不依赖登录时发的令牌里'
  '固化的信息，收回权限（删掉这一行）立刻生效。管理员手动维护，APP 不提供编辑入口。';

create index idx_household_member_email on household_member (email);

-- 给所有会同步的表加 household_id。itinerary_item 通过 day_id 才能追到 trip，
-- feedback.trip_id 本身允许为空——直接在每张表上加一列最简单可靠，
-- RLS 策略不用为了省一列而写一堆跨表 join 的子查询
alter table member add column household_id uuid references household (id);
alter table trip add column household_id uuid references household (id);
alter table itinerary_day add column household_id uuid references household (id);
alter table itinerary_item add column household_id uuid references household (id);
alter table expense add column household_id uuid references household (id);
alter table expense_split add column household_id uuid references household (id);
alter table budget add column household_id uuid references household (id);
alter table settlement add column household_id uuid references household (id);
alter table feedback add column household_id uuid references household (id);
alter table rate_book_entry add column household_id uuid references household (id);

-- expense_category 比较特殊：trip_id 为 null 的是全局预置分类（所有团队共用，
-- 比如"餐饮""交通"），trip_id 不为空的才是某个团队在某趟行程下自建的分类——
-- 预置分类不需要 household_id（本来就该所有人可见），只有自建分类才需要
alter table expense_category add column household_id uuid references household (id);

-- =====================================================================
-- 迁移已有数据：建一个"默认团队"，把这次迁移之前就存在的所有行都打上这个
-- 团队的标签——在生产库上跑这一步是最关键的一步，绝对不能跳过或者顺序搞错，
-- 不然现有数据会因为 household_id 是 not null 约束或者 RLS 生效而读不出来
-- =====================================================================
do $$
declare
  v_household_id uuid;
begin
  insert into household (name) values ('默认团队') returning id into v_household_id;

  update member set household_id = v_household_id where household_id is null;
  update trip set household_id = v_household_id where household_id is null;
  update itinerary_day set household_id = v_household_id where household_id is null;
  update itinerary_item set household_id = v_household_id where household_id is null;
  update expense set household_id = v_household_id where household_id is null;
  update expense_split set household_id = v_household_id where household_id is null;
  update budget set household_id = v_household_id where household_id is null;
  update settlement set household_id = v_household_id where household_id is null;
  update feedback set household_id = v_household_id where household_id is null;
  update rate_book_entry set household_id = v_household_id where household_id is null;
  -- expense_category 只回填"自建分类"（trip_id 不为空的），预置分类保持 household_id 为空
  update expense_category set household_id = v_household_id
    where household_id is null and trip_id is not null;
end;
$$;

-- 回填完成后才能把这一列设成不允许为空（expense_category 例外，见上面的注释）
alter table member alter column household_id set not null;
alter table trip alter column household_id set not null;
alter table itinerary_day alter column household_id set not null;
alter table itinerary_item alter column household_id set not null;
alter table expense alter column household_id set not null;
alter table expense_split alter column household_id set not null;
alter table budget alter column household_id set not null;
alter table settlement alter column household_id set not null;
alter table feedback alter column household_id set not null;
alter table rate_book_entry alter column household_id set not null;

-- =====================================================================
-- 权限判断函数：实时查"当前登录邮箱属于哪个团队"，不依赖 JWT 里固化的信息
-- =====================================================================
create or replace function current_household_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select hm.household_id
  from household_member hm
  where hm.email = (auth.jwt() ->> 'email')
  limit 1
$$;

comment on function current_household_id() is
  '当前登录者所属的团队ID。用 security definer 是因为调用者本身在 RLS 生效后'
  '不一定能直接查 household_member 这张表，函数内部需要绕过那层限制去查一次，'
  '但函数本身只返回"属于哪个团队"这一个ID，不会泄露其他信息。';

-- =====================================================================
-- household / household_member 自己也要上 RLS——只能查到自己所属的那一条，
-- 查不到团队总数、查不到别的团队叫什么名字，这是"团队隐蔽性"要求的核心
-- =====================================================================
alter table household enable row level security;
create policy household_self_only on household
  for select
  using (id = current_household_id());

alter table household_member enable row level security;
create policy household_member_self_only on household_member
  for select
  using (email = (auth.jwt() ->> 'email'));

-- =====================================================================
-- 把 0001/0002 里所有表的 using(true) 全放行策略，换成按 household 隔离。
-- trip_member 这张表从建库到现在都没被真正写入过（详见 syncMapping.ts 里的
-- 注释），故意不动它、留着原本的 allow_all 策略——不然还要为一张空表额外
-- 加 household_id 列，没有实际意义
-- =====================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'member', 'trip', 'itinerary_day', 'itinerary_item',
    'rate_book_entry', 'expense', 'expense_split', 'budget', 'settlement', 'feedback'
  ]
  loop
    execute format('drop policy if exists %I on %I', t || '_allow_all_v1', t);
    execute format(
      'create policy %I on %I for all using (household_id = current_household_id()) with check (household_id = current_household_id())',
      t || '_household_isolated', t
    );
  end loop;
end;
$$;

-- expense_category 单独处理：预置分类(trip_id is null)所有团队都能读，
-- 自建分类只有所属团队能读/改——不能像其他表一样一刀切成"必须匹配household_id"，
-- 否则所有团队都会看不到预置的"餐饮""交通"这些默认分类
drop policy if exists expense_category_allow_all_v1 on expense_category;
create policy expense_category_read_scoped on expense_category
  for select
  using (trip_id is null or household_id = current_household_id());
create policy expense_category_write_scoped on expense_category
  for insert
  with check (household_id = current_household_id());
create policy expense_category_update_scoped on expense_category
  for update
  using (household_id = current_household_id());

comment on schema public is
  '第二版权限模型：按 household（团队）隔离。current_household_id() 实时查'
  'household_member 表判断当前登录邮箱属于哪个团队，不依赖登录时固化的令牌信息。';
