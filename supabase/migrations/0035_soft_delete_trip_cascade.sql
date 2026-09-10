-- =====================================================================
-- 0035_soft_delete_trip_cascade.sql
-- 删除行程从级联硬删改成软删除——2026-09-10讨论定稿。
--
-- 【为什么改】之前删一趟行程是真的把它名下所有行程安排/账目/分摊/预算/
-- 结算级联DELETE掉，只有一个确认框，没有任何二次保护、也没有任何找回的
-- 余地，是全APP风险最大的一处删除操作（对照：成员用is_active、汇率簿用
-- archived，两处都是软删除，唯独行程这条最重的路径反而是硬删）。
--
-- 【为什么是这14张表】trip自己 + deleteTripCascade（本地dexie.ts）级联
-- 处理的全部十张表（trip_member/itinerary_day/itinerary_item/expense/
-- expense_split/expense_day_allocation/expense_rate_allocation/budget/
-- settlement）+ 之前从没被这个cascade碰过、会变成孤儿数据的四张新表
-- （day_satisfaction/expense_satisfaction/expense_line_item/
-- expense_line_item_member，2026-09-08上线时漏掉的，这次一起补上）。
--
-- 【为什么不面向用户开放恢复入口】用户明确要求：软删除的数据不需要被
-- 看见，只要存在后台——万一真出事，能手动去数据库里找回来，但不做
-- "回收站"这类UI，减少这次改动的范围。
--
-- 【安全性】纯新增可空列，不涉及任何数据改写，不是bulk-update+DDL那种
-- 有坑的组合，风险很低。
-- =====================================================================

alter table trip add column deleted_at timestamptz null;
alter table trip_member add column deleted_at timestamptz null;
alter table itinerary_day add column deleted_at timestamptz null;
alter table itinerary_item add column deleted_at timestamptz null;
alter table expense add column deleted_at timestamptz null;
alter table expense_split add column deleted_at timestamptz null;
alter table expense_day_allocation add column deleted_at timestamptz null;
alter table expense_rate_allocation add column deleted_at timestamptz null;
alter table budget add column deleted_at timestamptz null;
alter table settlement add column deleted_at timestamptz null;
alter table day_satisfaction add column deleted_at timestamptz null;
alter table expense_satisfaction add column deleted_at timestamptz null;
alter table expense_line_item add column deleted_at timestamptz null;
alter table expense_line_item_member add column deleted_at timestamptz null;

comment on column trip.deleted_at is
  '软删除时间戳，非null表示这趟行程已被用户删除。不面向用户开放恢复入口，'
  '数据本身还在——客户端所有列表查询都要自己过滤掉deleted_at非null的行。';
