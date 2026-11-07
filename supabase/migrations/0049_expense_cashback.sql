-- =====================================================================
-- 0049_expense_cashback.sql
-- 每笔返现：TNG VISA 这类卡是每刷一笔马上返一笔 Cashback，用户想在每一笔
-- 账上看到"这笔返了多少"
--
-- 【为什么记在 expense 上，而不是往 card_cashback 里每笔插一行】
-- 这个数跟着那一笔走：改账、删账（软删）时它天然跟着改、跟着消失，不用再维护
-- 一条"这条返现属于哪笔账"的外键和同步删除逻辑。card_cashback 继续管"按卡记
-- 一笔总数"那种（比如月底账单才返的）。两种来源在客户端加总。
--
-- cashback_amount：本位币（RM），照 TNG App 上显示的抄；null = 这笔没记返现。
--   归这笔的付款人（paid_by），只扣他自己的"我的花费"和黑卡的"实际花费"，
--   不参与分摊合计约束，不影响结算——跟按卡记的返现同一套口径（2026-11-07 用户确认）。
--
-- 【安全性】纯新增一个可空列，不改任何已有数据，没有 bulk update + DDL 的坑。
-- 老版本 APP 推开销时 payload 里不带这一列，PostgREST 的 upsert 只更新 payload
-- 里有的列，不会把它冲掉。
-- =====================================================================

alter table expense add column if not exists cashback_amount numeric(14, 2);

alter table expense drop constraint if exists expense_cashback_amount_check;
alter table expense add constraint expense_cashback_amount_check
  check (cashback_amount is null or cashback_amount > 0);

comment on column expense.cashback_amount is
  '这笔的返现（本位币，照卡的 App 抄）；null = 没记。归付款人，'
  '只扣他的"我的花费"和"实际花费"，不参与分摊。';
