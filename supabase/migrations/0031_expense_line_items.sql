-- =====================================================================
-- 0031_expense_line_items.sql
-- 逐项拆账——2026-09-08讨论定稿，详见docs/功能路线图-竞品借鉴版.md
-- 第2节第17条。一笔账目拆成好几个子项，每个子项自己勾选归属哪些成员
-- （同一子项可以几个人一起分），服务费/税按比例摊给每一项，不用单独
-- 为税费吵。
--
-- 【为什么是两张新表，不是直接改expense_split】
-- 最终算出来的"每人该付多少"依然写进现有的expense_split表（走跟
-- "精确分摊"完全一样的路径），这两张新表只负责"这个数字是怎么算出来的"
-- 这份明细，纯粹用来在编辑页回显子项——按笔结算、谁付了多少这些下游
-- 逻辑完全不用知道、也不用碰这两张新表。
--
-- 【为什么没有updated_at/触发器】
-- 跟0027的wishlist_place_link一个道理：这两张表永远是整份替换（改一笔
-- 逐项拆账的账目，就是删掉旧的子项+成员关联、重新写入新的一份），
-- 没有"编辑单个字段"这个操作，不需要更新时间戳。
--
-- 【为什么能用通用逐行同步，不用像expense_split那样搞原子推送】
-- 这两张表之间、以及跟expense之间都没有"总额必须等于XX"这种跨行数据库
-- 约束——那道约束只挂在expense_split上（真正的每人份额落地的地方），
-- 这两张表逐行推送不会撞上那道延迟约束触发器。
--
-- 【安全性】split_type枚举加一个新值（ADD VALUE不能跟同一事务里"使用"
-- 这个新值的DML混在一起，但这次迁移完全没有插入任何'itemized'数据，
-- 纯DDL，没问题）；expense加一列可空字段；两张全新的表。没有bulk-update
-- +DDL的坑，风险很低。
-- =====================================================================

alter type split_type add value 'itemized';

alter table expense add column itemized_fee_percent numeric(5, 2)
  check (itemized_fee_percent is null or itemized_fee_percent >= 0);

comment on column expense.itemized_fee_percent is
  '逐项拆账时的服务费/税百分比快照，只用于编辑页回显，不参与任何结算计算。';

create table if not exists expense_line_item (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household (id),
  expense_id    uuid not null references expense (id) on delete cascade,
  name          text not null,
  amount        numeric(14, 2) not null check (amount >= 0),
  order_index   integer not null default 0
);

create table if not exists expense_line_item_member (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references household (id),
  line_item_id   uuid not null references expense_line_item (id) on delete cascade,
  member_id      uuid not null references member (id) on delete restrict,

  unique (line_item_id, member_id)
);

create index if not exists idx_expense_line_item_expense on expense_line_item (expense_id);
create index if not exists idx_expense_line_item_household on expense_line_item (household_id);
create index if not exists idx_expense_line_item_member_line_item on expense_line_item_member (line_item_id);
create index if not exists idx_expense_line_item_member_household on expense_line_item_member (household_id);

comment on table expense_line_item is
  '逐项拆账的子项明细（名称+金额），只用于编辑页回显，真正的每人份额已经算进expense_split。';
comment on table expense_line_item_member is
  '子项对成员的多对多关系——同一个子项可以勾选好几个成员一起分。';

alter table expense_line_item enable row level security;
alter table expense_line_item_member enable row level security;

drop policy if exists expense_line_item_household_isolated on expense_line_item;
create policy expense_line_item_household_isolated on expense_line_item
  for all
  using (household_id = current_household_id())
  with check (household_id = current_household_id());

drop policy if exists expense_line_item_member_household_isolated on expense_line_item_member;
create policy expense_line_item_member_household_isolated on expense_line_item_member
  for all
  using (household_id = current_household_id())
  with check (household_id = current_household_id());
