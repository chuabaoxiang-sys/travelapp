-- =====================================================================
-- 0017_deterministic_current_household.sql
-- 修复：一个邮箱属于多个团队时，current_household_id() 返回哪个团队是不确定的
--
-- 【问题】0004 定义这个函数时用了 `limit 1` 但没有 `order by`。Postgres 对没有
-- 排序的查询不保证返回顺序（可能随执行计划、数据页物理顺序、甚至同一会话的两次
-- 调用而变化）。所以一个邮箱一旦属于两个团队，这个函数返回哪个团队就是不确定的；
-- 而所有业务表的 RLS 策略都是 `household_id = current_household_id()`，于是
-- "这个人能看到哪个团队的数据"也跟着变成不确定的。
--
-- 更糟的是客户端 src/domain/household.ts 里查 household_member 时做的是同样的
-- 无序 `limit 1`。两边各自独立地"随便挑一个"，完全可能挑到不同的团队：客户端
-- 拿 A 团队的 id 打进新记录的 household_id，服务端 RLS 却按 B 团队校验，
-- `with check (household_id = current_household_id())` 会直接拒绝这次写入。
-- 客户端看不出原因，只会表现成"这条数据同步不上去"。
--
-- 【为什么现在修】household_member 的主键是 (household_id, email) 复合键——
-- "一个邮箱属于多个团队"从 0004 开始就是被允许的（当时刻意这样设计，见那份
-- 迁移的注释）。只是生产环境目前还没有这样的邮箱，所以这个 bug 一直潜伏着没
-- 暴露。真正要做多团队支持之前，必须先有一条确定性的选择规则打底。
--
-- 【这次刻意不做的事】不新增"当前团队"指针表、不加团队切换界面、不动任何一张
-- 表的 RLS 策略。这次只让"挑哪一个"变成确定的，不改变"一个人能属于几个团队"，
-- 也不改变任何现有行为——对只属于一个团队的邮箱（目前生产环境的全部情况），
-- 加了 order by 之后选出来的还是同一行，完全等价。
--
-- 【排序键为什么是 (created_at, household_id)】created_at 表达"最早加入的那个
-- 团队"，语义上稳定、也符合直觉。但同一个邮箱可能在同一条语句里被加进两个团队
-- （比如一次 insert 里 union all 两行，created_at 默认值完全相同），所以再拿
-- household_id 做兜底比较，保证排序完全无歧义。
--
-- 【签名没变】返回类型、参数、volatility、security 都与 0004 一致，所以是纯粹的
-- 函数体替换，不影响任何依赖它的 RLS 策略，也不需要重建策略。
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
  order by hm.created_at, hm.household_id
  limit 1
$$;

comment on function current_household_id() is
  '当前登录者所属的团队ID。用 security definer 是因为调用者本身在 RLS 生效后'
  '不一定能直接查 household_member 这张表，函数内部需要绕过那层限制去查一次，'
  '但函数本身只返回"属于哪个团队"这一个ID，不会泄露其他信息。'
  'order by (created_at, household_id) 保证一个邮箱属于多个团队时返回结果稳定；'
  '客户端 src/domain/household.ts 的 getCurrentHouseholdId() 必须使用完全相同的'
  '排序，两边挑到不同团队会导致写入被 RLS 静默拒绝。改这里的排序就必须同步改那边。';
