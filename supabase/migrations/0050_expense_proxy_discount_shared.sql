-- =====================================================================
-- 0050_expense_proxy_discount_shared.sql
-- 代购遇到优惠：每笔账一个开关「优惠分给代购的人」（2026-11-07 用户定的规则）
--
-- 【规则】一笔账有优惠（discount_amount）又有代购行时：
--   - 代购行的 proxy_amount 一律按收据上的「原价」填，加起来不超过 原价 = 实付 + 优惠
--   - 代购这部分的成本按原价比例摊优惠：share_amount = home_amount × 代购原价 / 整笔原价，
--     剩下的才是同行者分的——所以同行者自己那份是折后价，分摊合计约束照旧成立
--   - proxy_discount_shared = false（默认）：代购的人按「原价」还；他那部分省下的钱
--     （应还 − 成本）归这笔的付款人，跟返现一样只扣付款人的"我的花费"
--   - proxy_discount_shared = true：代购的人按折后成本还，没有多收
--   "应还多少"由客户端从 proxy_amount、home_amount、expense_amount 现算，不另存一列：
--   刷卡补了实际扣款后自动跟着新汇率变
--
-- 【安全性】纯新增一个 not null default false 的列：Postgres 11+ 加带常量默认值的列
-- 不重写整张表，已有行直接读到 false；没有 bulk update + DDL 的坑。
-- 老版本 APP 推开销时 payload 里不带这一列，upsert 不会把它冲掉。
-- =====================================================================

alter table expense add column if not exists proxy_discount_shared boolean not null default false;

comment on column expense.proxy_discount_shared is
  '有优惠又有代购时：false = 代购的人按原价还，多出的归付款人；true = 优惠按原价比例分给代购的人。';
