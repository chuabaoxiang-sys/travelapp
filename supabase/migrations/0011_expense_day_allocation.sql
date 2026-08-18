-- =====================================================================
-- 0011_expense_day_allocation.sql
-- 跨天开销按天分摊：住宿、周游券这类开销本来就横跨好几天，之前只能整笔算在
-- 某一天头上（expense.itinerary_day_id 是单选），导致那天的"当日花费"虚高、
-- 其他天虚低，每日数据不反映真实情况。
--
-- 【为什么是一行一个日期，而不是起止范围两列】
-- 用户明确要求支持不连续的天（比如周游券只在第1天和第4天用，中间那两天没用到
-- 就不该被摊进去）。起止范围表达不了"跳过中间"，所以选中几天就存几行。
--
-- 【为什么不加"分摊总额必须等于费用总额"的约束】
-- expense_split 有这么一道延迟约束触发器（0001 的 fn_check_expense_split_sum），
-- 结果在 0009 里付出了很大代价：客户端逐行推送时，"总额还没凑齐"的中间状态被
-- 拿去检查，检查不过就永远同步不上去，真实分摊数据几个月都没到过服务器。
-- 这里刻意不重蹈覆辙——每日分摊即使总额有偏差，后果也只是某天的统计数字略有
-- 出入，不像分账那样牵扯到家人之间谁欠谁钱，不值得为它再引入一道会卡住同步的
-- 约束。金额是否分完由前端实时校验（AddExpenseSheet 里那个"刚好分完 ✓"）。
-- 因此这张表也可以走通用的逐行同步，不需要 replace_expense_splits 那种原子替换函数。
--
-- 【安全性】这是纯新增的迁移：新表 + 一个可空的新列，没有任何 bulk UPDATE，
-- 也没有对既有表做 SET NOT NULL 之类的结构调整，不会触发 0004 在生产上遇到的
-- "pending trigger events"问题，可以整段一次性执行。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. expense 新增一列：这笔开销是不是跨天的、按哪种方式摊
-- ---------------------------------------------------------------------

-- 可空，null = 普通单日开销（所有历史数据都是这种，不需要回填）
alter table expense add column if not exists day_spread_mode text
  check (day_spread_mode is null or day_spread_mode in ('equal', 'exact'));

comment on column expense.day_spread_mode is
  '跨天开销摊到每一天的方式：null=普通单日开销（按 itinerary_day_id 整笔算在一天）；'
  'equal=平均分；exact=每天金额由用户自己填。不为 null 时，这笔钱按 '
  'expense_day_allocation 里的行分别计入各天，itinerary_day_id 不再参与当日花费统计。';

-- ---------------------------------------------------------------------
-- 2. expense_day_allocation：一笔跨天开销在每一天分到多少
-- ---------------------------------------------------------------------

create table if not exists expense_day_allocation (
  id            uuid primary key default gen_random_uuid(), -- 正常由客户端生成并传入
  household_id  uuid not null references household (id),
  expense_id    uuid not null references expense (id) on delete cascade,
  -- 冗余存 trip_id：客户端要按行程一次性拉出所有分摊行来算每日合计，
  -- 没有这一列就得先查出这趟行程的全部 expense_id 再 in 查询，多绕一圈
  trip_id       uuid not null references trip (id) on delete cascade,

  -- 存具体日期而不是 itinerary_day_id：用户可能把开销摊到还没建过任何行程项的
  -- 那一天，按日期存就不用为此凭空造一条 itinerary_day 出来
  day_date      date not null,
  amount        numeric(14, 2) not null check (amount >= 0),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- 同一笔开销在同一天只应该有一条分摊记录
  unique (expense_id, day_date)
);

-- 按行程查这趟所有分摊行（算每日合计用），是最主要的查询路径
create index if not exists idx_expense_day_allocation_trip on expense_day_allocation (trip_id, day_date);

comment on table expense_day_allocation is
  '跨天开销（住宿、周游券等）摊到每一天的金额。选中的日子不要求连续，'
  '所以一行一个具体日期，而不是起止范围两列。只有 expense.day_spread_mode '
  '不为 null 的开销才会有这里的行。';

-- ---------------------------------------------------------------------
-- 3. RLS：跟 0004 建立的 household 隔离保持一致
-- ---------------------------------------------------------------------

alter table expense_day_allocation enable row level security;

drop policy if exists expense_day_allocation_household_isolated on expense_day_allocation;
create policy expense_day_allocation_household_isolated on expense_day_allocation
  for all
  using (household_id = current_household_id())
  with check (household_id = current_household_id());
