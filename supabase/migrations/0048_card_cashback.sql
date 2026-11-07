-- =====================================================================
-- 0048_card_cashback.sql
-- Cashback：刷卡的返现，"相当于为旅途减少了开销"
--
-- 【用户定下的规则（2026-11-07）】
-- - 返现算卡主自己的：不影响同行者之间的结算，只让"归谁"那个人这趟的
--   "我的花费"少这么多
-- - "这趟已花"和预算照账面算（跟银行扣款对得上），旁边另列"Cashback · 实际"
-- - 按卡记一笔返现（可以有好几笔，比如每个月账单一笔）；卡设了返现比例的话，
--   APP 按这趟刷卡总额帮忙估一个数，点一下就填上
--
-- 【为什么返现是单独一张表，不是 expense 上的一列】
-- 返现常常是事后一笔总数（"这个月返了 RM45.60"），对不上具体哪一笔账；
-- 而且它跟分摊、结算完全无关，挂在 expense 上反而要处处排除。
--
-- 【卡没有"卡主"】payment_card 按团队存、所有人共用，所以"返现归谁"记在每一笔
-- 返现上（member_id），不是卡上。
--
-- 【安全性】一张全新的表 + payment_card 一个可空新列，不改任何已有数据。
-- =====================================================================

alter table payment_card add column if not exists cashback_percent numeric(5, 2);
alter table payment_card drop constraint if exists payment_card_cashback_percent_check;
alter table payment_card add constraint payment_card_cashback_percent_check
  check (cashback_percent is null or (cashback_percent > 0 and cashback_percent <= 100));
comment on column payment_card.cashback_percent is
  '返现比例（%，可选，所有旅行通用）；只用来帮忙估算"这趟大概返多少"，实际以记下的 card_cashback 为准。';

create table if not exists card_cashback (
  id               uuid primary key default gen_random_uuid(), -- 正常由客户端生成并传入
  household_id     uuid not null references household (id),
  trip_id          uuid not null references trip (id) on delete cascade,
  payment_card_id  uuid not null,
  member_id        uuid not null references member (id) on delete restrict, -- 返现归谁
  amount           numeric(14, 2) not null check (amount > 0),              -- 本位币
  note             text,
  created_by       uuid references member (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  -- 跟 expense 一样用复合外键保证"卡必须属于同一个团队"（普通外键检查会绕过 RLS）
  constraint card_cashback_payment_card_fk
    foreign key (payment_card_id, household_id) references payment_card (id, household_id)
);

create index if not exists idx_card_cashback_trip on card_cashback (trip_id);
create index if not exists idx_card_cashback_household on card_cashback (household_id);

comment on table card_cashback is
  '刷卡返现：某趟行程、某张卡、归谁、返了多少本位币。只影响"归谁"那个人的"我的花费"'
  '和"实际花费"的展示，不进同行者之间的结算，不改"这趟已花"和预算。';

alter table card_cashback enable row level security;

drop policy if exists card_cashback_household_isolated on card_cashback;
create policy card_cashback_household_isolated on card_cashback
  for all
  using (household_id = current_household_id())
  with check (household_id = current_household_id());

-- APP 只用登录后的 authenticated 角色读写；匿名角色用不到这张表
revoke all on card_cashback from anon;

drop trigger if exists trg_card_cashback_set_updated_at on card_cashback;
create trigger trg_card_cashback_set_updated_at
  before update on card_cashback
  for each row execute function set_updated_at();
