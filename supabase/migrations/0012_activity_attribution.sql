-- =====================================================================
-- 0012_activity_attribution.sql
-- 给行程项和结算记录补上"是谁加的"，让"行程动态"能显示人名。
--
-- 【为什么需要】这个APP的数据一直是一家人共享的，但同步是静默的后台轮询——别人加的
-- 行程项、结的账，会悄无声息地出现在列表里，跟自己三天前加的那条毫无区别，谁都不会
-- 被告知对方做了什么。account 那边本来就有 recorded_by（虽然以前从没显示过），
-- 这两张表却连字段都没有，所以动态流没法说清"谁"做的。
--
-- 【为什么可以放心跑】纯增量：只加一列、可空、不动任何现有数据、不改任何RLS策略。
-- 历史数据的 created_by 会是 null，前端会退化成"有人加了…"，不会报错。
-- 属于和 0005 同一类的低风险迁移，不需要先做CSV备份（但仍然先在测试项目跑一遍）。
-- =====================================================================

alter table itinerary_item add column if not exists created_by uuid references member (id) on delete set null;
alter table settlement     add column if not exists created_by uuid references member (id) on delete set null;

comment on column itinerary_item.created_by is
  '加这条行程项的成员。可空——这一列是后加的，之前的历史数据没有归属信息。'
  'on delete set null 而不是 restrict：成员被删掉不该连带挡住行程项的删除，'
  '丢掉"谁加的"这个信息可以接受，挡住用户删数据不行。';

comment on column settlement.created_by is
  '记这笔结算的成员（不一定是转账双方之一——可能是家里管账的人代记）。可空，理由同上。';
