-- =====================================================================
-- 0013_itinerary_booking_status.sql
-- 行程项新增"预约状态"：有些行程项（餐厅、周游券、酒店、活动）需要提前预约，
-- 之前完全没地方记录"这条订好了没有"，全靠脑子记，容易漏。
--
-- 【为什么是可空列，不是关联表】
-- 预约状态是1:1挂在一个行程项上的，不需要多行，建关联表纯属多余的join成本。
-- 参照 0011_expense_day_allocation.sql 定下来的风格：新增可空列 + 简单check约束，
-- 不加任何跨行汇总类的约束——那类约束正是 0009 那次同步卡死几个月的根因。
--
-- 【为什么只有 needed/booked 两个值，没有第三个"不需要预约"】
-- 大部分行程项根本不涉及预约，这类行程项这个字段直接是 null，不需要一个专门的
-- "confirmed-not-needed"值去表达"我确认过这条不用预约"——那是没必要的额外状态。
--
-- 【booking_deadline 是为以后的提醒功能预留】
-- 这次不做提醒，但先把字段加上，免得以后做提醒时又要跑一次迁移。
-- =====================================================================

alter table itinerary_item add column if not exists booking_status text
  check (booking_status is null or booking_status in ('needed', 'booked'));

alter table itinerary_item add column if not exists booking_deadline date;

comment on column itinerary_item.booking_status is
  '这条行程项的预约状态：null=不涉及预约；needed=需要预约但还没订；booked=已确认。'
  '没有"确认不需要预约"这个第三态，不适用的行程项就是 null。';

comment on column itinerary_item.booking_deadline is
  '预约截止日期，可选。目前只是存起来，还没有任何提醒功能读取它。';
