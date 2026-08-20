-- =====================================================================
-- 0014_rate_book_exchange_amount.sql
-- 汇率簿条目可选记录一次真实换汇的本位币/外币金额（比如"用500 MYR换了
-- 16,500 JPY"），不再只是估一个汇率数字。这是"提前换汇"功能的第一部分——
-- 后续还会有一笔开销拆分成多批汇率的功能，会再加一张新表，这次先只加
-- 这两个可空列。
--
-- 【为什么是可空列，不是必填】
-- 汇率簿现有的用法（手动估一个汇率、或采信API参考汇率）完全不受影响，这两列
-- 纯粹是给"真的记录过一次换汇"这种情况用的，绝大多数条目不会有值。
--
-- 【为什么不加"两者必须同时有值"的约束】
-- 前端保证两个字段要么一起填要么都不填，但数据库层不必为此加 check——
-- 万一以后允许只记一个大概金额（比如只记换了多少外币，不记花了多少本位币），
-- 不希望被这道约束卡住，前端校验已经够用。
--
-- 【安全性】纯新增的可空列，没有任何 bulk UPDATE，也没有对既有表做
-- SET NOT NULL 之类的结构调整，可以整段一次性执行。
-- =====================================================================

alter table rate_book_entry add column if not exists exchanged_home_amount numeric(14, 2)
  check (exchanged_home_amount is null or exchanged_home_amount > 0);
alter table rate_book_entry add column if not exists exchanged_foreign_amount numeric(14, 2)
  check (exchanged_foreign_amount is null or exchanged_foreign_amount > 0);

comment on column rate_book_entry.exchanged_home_amount is
  '如果这条标签背后真实发生过一次换汇，这里记当时给出多少本位币；'
  '纯手动估的汇率、没有对应真实换汇动作时为 null。';
comment on column rate_book_entry.exchanged_foreign_amount is
  '同上，换到了多少外币。rate 字段始终是唯一参与计算的值——这两列纯粹是给用户看的'
  '换汇记录，之后 rate 被单独编辑时这两列不会跟着联动，允许两者不再精确对应。';
