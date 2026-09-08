-- =====================================================================
-- 0029_satisfaction_ratings.sql
-- "值/一般/后悔"满意度标记——2026-09-08讨论定稿，详见
-- docs/功能路线图-竞品借鉴版.md 第2节第19条。
--
-- 【为什么是两张新表，不是在 itinerary_day/expense 上加字段】
-- 每个成员对同一天/同一笔账目的感受是各自独立的一份（一家人对同一天可能
-- 感受不一样），不是整个household共享一个值——所以形状要跟 expense_split
-- 一样：一个父记录对多个member，各自一行，而不是父表上加一个字段。
--
-- 【为什么用 unique 约束，不只是靠前端逻辑保证"一人一份"】
-- 前端 domain/satisfaction.ts 已经会先查有没有现成的一行再决定新增/更新，
-- 但跟 expense_split 的思路一致——前端校验是给用户及时反馈，不是唯一防线，
-- 数据库层面的约束才是真正兜底（万一多设备并发写入撞车）。
--
-- 【为什么 rating 没有 'skip' 这个值】
-- "跳过"= 不强制填，语义上就是"这一行不存在"，不是"存在但值是skip"——
-- 跳过之后这个人对这一天/这笔账目的态度就是"没有数据"，不是"我特意选了
-- 不表态"，两者在统计口径上应该完全等价，用 null（没这行）表达最直接。
--
-- 【安全性】纯新增表，没有bulk update+DDL的坑，风险很低。
-- =====================================================================

create type satisfaction_rating as enum ('worth', 'neutral', 'regret');

create table if not exists day_satisfaction (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household (id),
  trip_id       uuid not null references trip (id) on delete cascade,
  day_id        uuid not null references itinerary_day (id) on delete cascade,
  member_id     uuid not null references member (id) on delete cascade,
  rating        satisfaction_rating not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (day_id, member_id)
);

create table if not exists expense_satisfaction (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household (id),
  trip_id       uuid not null references trip (id) on delete cascade,
  expense_id    uuid not null references expense (id) on delete cascade,
  member_id     uuid not null references member (id) on delete cascade,
  rating        satisfaction_rating not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (expense_id, member_id)
);

create index if not exists idx_day_satisfaction_trip on day_satisfaction (trip_id);
create index if not exists idx_day_satisfaction_household on day_satisfaction (household_id);
create index if not exists idx_expense_satisfaction_trip on expense_satisfaction (trip_id);
create index if not exists idx_expense_satisfaction_household on expense_satisfaction (household_id);

create trigger trg_day_satisfaction_set_updated_at
  before update on day_satisfaction
  for each row execute function set_updated_at();

create trigger trg_expense_satisfaction_set_updated_at
  before update on expense_satisfaction
  for each row execute function set_updated_at();

comment on table day_satisfaction is
  '每个成员对某一天行程的"值/一般/后悔"打分——按日期解锁的翻卡片仪式产出的数据，'
  '一天一个成员最多一行，跳过=不存在这一行。';

comment on table expense_satisfaction is
  '每个成员对某一笔账目的"值/一般/后悔"打分——账目卡片盖章功能产出的数据，'
  '不进翻卡片流程，随时自选打分，一笔账目一个成员最多一行。';

alter table day_satisfaction enable row level security;
alter table expense_satisfaction enable row level security;

drop policy if exists day_satisfaction_household_isolated on day_satisfaction;
create policy day_satisfaction_household_isolated on day_satisfaction
  for all
  using (household_id = current_household_id())
  with check (household_id = current_household_id());

drop policy if exists expense_satisfaction_household_isolated on expense_satisfaction;
create policy expense_satisfaction_household_isolated on expense_satisfaction
  for all
  using (household_id = current_household_id())
  with check (household_id = current_household_id());
