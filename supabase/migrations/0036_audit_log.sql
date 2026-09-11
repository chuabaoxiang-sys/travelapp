-- =====================================================================
-- 0036_audit_log.sql
-- 粗粒度审计日志——2026-09-10数据审计讨论的第三点，2026-09-11定稿实现。
--
-- 【为什么是"粗粒度"，不存改动前后的字段快照】
-- 讨论时明确选了"谁/什么时候/哪张表/新增改动删除"这个颗粒度，不存每次
-- 改动具体变了哪个字段、改前改后是什么值——那需要更大的存储量，也要
-- 考虑隐私字段怎么处理，这次不做，够回答"这条记录是谁在什么时候动的"
-- 这类问题就行。
--
-- 【为什么没有给用户看的界面】
-- 定位是纯后台安全网——真出问题了直接用Supabase查，不值得为此单独做
-- 一个"变更历史"页面占用开发时间，以后想看了再补。
--
-- 【为什么trip_id/actor_id不加on delete cascade】
-- 审计日志的意义就是"即使被记录的东西后来没了，也留得下曾经发生过什么"，
-- 如果trip/member删除时把相关审计记录也级联删掉，等于审计日志在最该
-- 有用的那一刻（东西真的被删除的时候）反而先把自己删了。trip_id干脆不设
-- 外键约束（软引用，trip不管是软删还是真的没了都不影响这行留着）；
-- actor_id设外键但不加cascade——这个app里member从不会被真正删除
-- （用is_active表示停用），不会撞上这个问题。
--
-- 【为什么只推不拉，不出现在客户端的TABLE_ORDER里】
-- 见 src/db/dexie.ts 的 SYNCED_TABLES 和 src/db/sync.ts 的 TABLE_ORDER
-- 注释——没有任何设备需要把全家的审计记录同步回本地。
--
-- 【安全性】纯新增表，没有bulk update+DDL的坑，风险很低。
-- =====================================================================

create type audit_log_operation as enum ('insert', 'update', 'delete');

create table if not exists audit_log (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household (id),
  trip_id       uuid null,
  table_name    text not null,
  record_id     text not null,
  operation     audit_log_operation not null,
  actor_id      uuid null references member (id),
  created_at    timestamptz not null default now()
);

create index if not exists idx_audit_log_household on audit_log (household_id, created_at);
create index if not exists idx_audit_log_trip on audit_log (trip_id) where trip_id is not null;

comment on table audit_log is
  '粗粒度审计日志——谁在什么时候对哪张表的哪条记录做了新增/改动/删除，不存字段级快照。'
  '纯后台安全网，APP里没有给用户看的界面。只由客户端推送写入，不会被拉取回任何设备。';

alter table audit_log enable row level security;

drop policy if exists audit_log_household_isolated on audit_log;
create policy audit_log_household_isolated on audit_log
  for all
  using (household_id = current_household_id())
  with check (household_id = current_household_id());
