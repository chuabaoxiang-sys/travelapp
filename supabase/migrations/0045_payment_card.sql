-- =====================================================================
-- 0045_payment_card.sql
-- 刷卡记账：信用卡/借记卡每一笔都是银行当下给的汇率，跟"换一批现金、按同一个
-- 汇率慢慢花"是两种完全不同的东西。以前只能在汇率簿里给每张卡建一条"汇率"凑合，
-- 结果汇率簿里一堆"TNG VISA 0.0294"这种其实每笔都不一样的数。
--
-- 【为什么卡单独一张表，不塞进 rate_book_entry】
-- rate_book_entry 是按"行程+外币"存的，一条就是一个固定汇率；卡恰好相反——
-- 没有固定汇率，而且用户明确要求"建一次所有旅行通用"（去日本用、去泰国也用）。
-- 所以卡跟 wishlist_place 一样按团队(household)存，不挂 trip_id、不挂币种。
--
-- 【expense 上加的两列】
-- payment_card_id：这笔是用哪张卡刷的。刷卡的开销 rate_book_entry_id 为空，
--   rate_used/home_amount 照旧是这笔自己的快照（= 银行实际扣的 RM / 外币金额），
--   所以结算、预算、统计这些只看 home_amount 的老逻辑一行都不用改。
-- card_charge_pending：刷卡当下还不知道银行扣了多少，先按估算汇率记的——
--   true 表示 home_amount 是估的，等用户补了真实扣款再变回 false。
--
-- 【为什么是复合外键 (payment_card_id, household_id)】
-- 普通外键检查会绕过 RLS：只用 payment_card_id 的话，理论上可以把别的团队的卡
-- 的 uuid 填进自己的开销里。复合外键把"卡必须属于同一个团队"交给数据库保证。
-- 不写 on delete 动作（= 有开销挂着就删不掉）：跟 APP 里"有关联数据只能停用、
-- 不能删"的规矩一致，数据库这边兜底。
--
-- 【安全性】纯新增（一张新表 + expense 两个可空/有默认值的新列），不改任何已有
-- 数据，没有 bulk update + DDL 的坑。老版本 APP 推开销时不带这两列，PostgREST
-- 的 upsert 只更新 payload 里有的列，不会把它们冲掉。
-- =====================================================================

create table if not exists payment_card (
  id            uuid primary key default gen_random_uuid(), -- 正常由客户端生成并传入
  household_id  uuid not null references household (id),
  name          text not null check (char_length(trim(name)) > 0),
  -- 停用而不是物理删除：已经挂在开销上的卡要一直保持有效
  archived_at   timestamptz,
  created_by    uuid references member (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- 给 expense 的复合外键用
  unique (id, household_id)
);

create index if not exists idx_payment_card_household on payment_card (household_id);

comment on table payment_card is
  '刷卡记账用的卡（信用卡/借记卡）——按团队存，所有行程通用，没有固定汇率；'
  '每一笔刷卡开销自己的汇率存在 expense.rate_used。停用(archived_at 非空)只是'
  '不再出现在记账时的选择列表里。';

alter table payment_card enable row level security;

drop policy if exists payment_card_household_isolated on payment_card;
create policy payment_card_household_isolated on payment_card
  for all
  using (household_id = current_household_id())
  with check (household_id = current_household_id());

-- APP 只用登录后的 authenticated 角色读写；匿名角色用不到这张表，直接收回
revoke all on payment_card from anon;

drop trigger if exists trg_payment_card_set_updated_at on payment_card;
create trigger trg_payment_card_set_updated_at
  before update on payment_card
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- expense 新增两列
-- ---------------------------------------------------------------------

alter table expense add column if not exists payment_card_id uuid;
alter table expense add column if not exists card_charge_pending boolean not null default false;

alter table expense drop constraint if exists expense_payment_card_fk;
alter table expense add constraint expense_payment_card_fk
  foreign key (payment_card_id, household_id) references payment_card (id, household_id);

-- "待补扣款"只对刷卡的开销有意义
alter table expense drop constraint if exists expense_card_pending_needs_card;
alter table expense add constraint expense_card_pending_needs_card
  check (not card_charge_pending or payment_card_id is not null);

create index if not exists idx_expense_payment_card_id on expense (payment_card_id)
  where payment_card_id is not null;

comment on column expense.payment_card_id is
  '这笔是用哪张卡刷的（见 payment_card）。刷卡的开销 rate_book_entry_id 为空，'
  'rate_used/home_amount 是这一笔自己的汇率和银行实际扣款。';
comment on column expense.card_charge_pending is
  'true = 刷卡当下还不知道银行扣了多少，home_amount 是按估算汇率先记的，等补了真实扣款再变回 false。';
