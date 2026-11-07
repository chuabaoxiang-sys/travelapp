-- =====================================================================
-- 0047_expense_discount.sql
-- 优惠：单子标价 ¥18,000、实付 ¥16,000，这 ¥2,000 想记下来"省了多少"
--
-- 【为什么只是一个可空列】
-- 用户明确只想"看省了多少"——账的金额照旧填实付，花费、预算、分摊全部照实付算，
-- 优惠只是旁边多记的一个数字。所以不碰 expense_amount / home_amount，也不需要
-- 跟分摊合计约束打交道。
--
-- discount_amount：按这笔账自己的币种记的优惠金额（照收据上"割引/免税/优惠券"
--   那一行抄）；null = 没记优惠。折成本位币时客户端用 rate_used 现算，刷卡补了
--   实际扣款后自动跟着变，不另存一份本位币快照。
--
-- 【安全性】纯新增一个可空列，不改任何已有数据，没有 bulk update + DDL 的坑。
-- 老版本 APP 推开销时 payload 里不带这一列，PostgREST 的 upsert 只更新 payload
-- 里有的列，不会把它冲掉。
-- =====================================================================

alter table expense add column if not exists discount_amount numeric(14, 2);

alter table expense drop constraint if exists expense_discount_amount_check;
alter table expense add constraint expense_discount_amount_check
  check (discount_amount is null or discount_amount > 0);

comment on column expense.discount_amount is
  '优惠金额（按这笔账自己的币种，照收据上割引/免税/优惠券抄）；null = 没记。'
  '只用于显示"省了多少"，不参与花费、预算、分摊。';
