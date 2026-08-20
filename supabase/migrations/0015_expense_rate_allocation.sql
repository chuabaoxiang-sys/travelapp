-- =====================================================================
-- 0015_expense_rate_allocation.sql
-- 一笔开销拆给不止一批换汇的钱：之前汇率簿一笔账只能选一个汇率标签，但实际上
-- 一笔钱完全可能一部分来自机场换的、一部分来自银行换的，汇率还不一样。
--
-- 【为什么存外币金额，不是本位币金额】
-- "这笔钱几分来自哪批"天然发生在外币这一侧（跟开销本身同一个币种），不是本位币
-- 那一侧——本位币金额（home_amount）反而是要靠外币金额乘各自汇率算出来的结果。
--
-- 【为什么没有"按剩余比例自动分"的字段/逻辑】
-- 换汇批次之间没有"平均分摊"的自然含义，试算过"按剩余比例分"和"先用完一批
-- 再用下一批"两种分法，算出来的实际花费不一样，没有唯一正确的默认分法——每一批
-- 具体用了多少完全由用户自己填，这张表只是存结果，不参与"怎么分"的计算。
--
-- 【为什么不加"各行加总必须等于开销总额"的约束】
-- 跟 0011（expense_day_allocation）同样的取舍：expense_split 那道延迟约束触发器
-- 在 0009 里让分摊记录卡住同步好几个月。这里即使总额有偏差，后果也只是"已用/已换"
-- 那个进度数字略有出入，不像分账那样牵扯谁欠谁钱，不值得为它再引入一道会卡住
-- 同步的约束。金额有没有分完由前端实时校验（RateChipRow 里那个"刚好分完这笔钱"）。
--
-- 【安全性】纯新增迁移：新表 + 一个可空的新列，没有 bulk UPDATE，也没有对既有表
-- 做 SET NOT NULL，不会触发 0004 在生产上遇到的 pending trigger events 问题。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. expense 新增一列：这笔开销是不是拆给了不止一批换汇
-- ---------------------------------------------------------------------

-- 可空，null = 普通情况（所有历史数据都是这种），继续按 rate_book_entry_id 单选算
alter table expense add column if not exists rate_spread boolean;

comment on column expense.rate_spread is
  '这笔开销是不是来自不止一批换汇：null/false=普通情况，rate_book_entry_id/rate_used/'
  'home_amount 照旧直接用；true 时 rate_book_entry_id 为空，rate_used 改存加权平均汇率、'
  'home_amount 改为 expense_rate_allocation 里各行加总，两者仍是给老代码看的快照。';

-- ---------------------------------------------------------------------
-- 2. expense_rate_allocation：一笔开销拆给每一批换汇多少
-- ---------------------------------------------------------------------

create table if not exists expense_rate_allocation (
  id                 uuid primary key default gen_random_uuid(), -- 正常由客户端生成并传入
  household_id       uuid not null references household (id),
  expense_id         uuid not null references expense (id) on delete cascade,
  -- 冗余存 trip_id：客户端要按行程一次性拉出所有分摊行来算每个汇率标签"已用多少"，
  -- 没有这一列就得先查出这趟行程的全部 expense_id 再 in 查询，多绕一圈
  trip_id            uuid not null references trip (id) on delete cascade,
  -- 跟 expense.rate_book_entry_id 保持一致的 FK 行为：标签被删掉不该连带删掉历史分摊行
  rate_book_entry_id uuid references rate_book_entry (id) on delete set null,

  foreign_amount     numeric(14, 2) not null check (foreign_amount > 0),
  rate_used          numeric(18, 8) not null check (rate_used > 0),
  home_amount        numeric(14, 2) not null check (home_amount >= 0),

  created_at         timestamptz not null default now(),

  -- 同一笔开销引用同一个汇率标签只应该有一行
  unique (expense_id, rate_book_entry_id)
);

-- 按行程查这趟所有分摊行（算每个汇率标签"已用多少"用），是最主要的查询路径
create index if not exists idx_expense_rate_allocation_trip on expense_rate_allocation (trip_id);

comment on table expense_rate_allocation is
  '一笔开销拆给不止一批换汇时，每一批分到多少外币。只有 expense.rate_spread 为 true '
  '的开销才会有这里的行。foreign_amount/rate_used/home_amount 都是记账当下的快照。';

-- ---------------------------------------------------------------------
-- 3. RLS：跟 0004 建立的 household 隔离保持一致
-- ---------------------------------------------------------------------

alter table expense_rate_allocation enable row level security;

drop policy if exists expense_rate_allocation_household_isolated on expense_rate_allocation;
create policy expense_rate_allocation_household_isolated on expense_rate_allocation
  for all
  using (household_id = current_household_id())
  with check (household_id = current_household_id());
