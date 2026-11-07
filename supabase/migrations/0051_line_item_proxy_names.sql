-- =====================================================================
-- 0051_line_item_proxy_names.sql
-- 逐项拆账 + 代购（2026-11-08 用户定的规则）：逐项拆账的每一项除了勾同行的人，
-- 还可以勾"帮谁代购"的名字，同一项里同行的人和代购的人一起均分这一项。
--
-- 【为什么是 expense_line_item 上的一个数组列，不是往 expense_line_item_member 塞行】
-- expense_line_item_member.member_id 是 not null 的团队成员外键，代购的人不是团队
-- 成员（只有名字），塞不进去；为了它把那张表改成可空、再加一列名字，会动到已有的
-- 约束。这里只是"回显编辑页"用的记录（真正的份额照旧写进 expense_split 的代购行，
-- 见 0046），一个 text[] 列最简单。
--
-- proxy_names：这一项勾了哪些代购的人的名字；空数组 = 没有。
--
-- 【安全性】纯新增一个 not null default '{}' 的列，常量默认值不重写表、已有行直接读到
-- 空数组；没有 bulk update + DDL 的坑。老版本 APP 推子项时 payload 里不带这一列，
-- upsert 不会把它冲掉。
-- =====================================================================

alter table expense_line_item add column if not exists proxy_names text[] not null default '{}';

comment on column expense_line_item.proxy_names is
  '逐项拆账里这一项勾的代购的人（名字）；跟勾的同行成员一起均分这一项。只用于回显编辑页。';
