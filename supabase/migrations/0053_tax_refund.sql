-- =====================================================================
-- 0053_tax_refund.sql
-- 退税：机场现金退税、网上退到信用卡
--
-- 【用户定下的规则（2026-11-08）】
-- - 退税单独记一条，不挂在某一笔购物上（一次退税常常对应好几笔购物，而且
--   现金退税会改变手上的外币现金，跟某一笔账对不上）
-- - 方式：现金 / 退到卡。外币现金退税同时进汇率簿（rate_book_entry_id 指向
--   自动建的那条"退税现金"），加进这种外币现金的"还剩"，之后记现金账能选它；
--   汇率默认带这趟这种外币现金的汇率，可以改
-- - 退到卡还没到账：先按 外币金额 × 汇率 估一个本位币数算进去（pending=true，
--   界面上带"含估算"），到账后填实际本位币金额（pending=false）
-- - "算谁的"（member_ids）每条都要选，进同行者之间的结算，也从"实际花费"里扣；
--   "谁收到的"不单独选，就是记这条的人（received_by）
--
-- 【为什么不跟 card_cashback 合并】返现只归一个人、不进结算；退税要按人分、
-- 进结算，还牵涉汇率簿和"待到账"，规则差得多，硬塞进一张表反而处处要分支。
--
-- 【rate_book_entry_id 不加外键】汇率簿那条是同一次保存里由客户端先建、后推；
-- 两张表各自走离线同步队列，加外键的话推送先后稍有颠倒就会被拒收。删退税时
-- 客户端自己处理那条汇率（没用过就删，用过就停用）。
--
-- 【安全性】一张全新的表，不改任何已有数据。
-- =====================================================================

create table if not exists tax_refund (
  id                  uuid primary key default gen_random_uuid(), -- 正常由客户端生成并传入
  household_id        uuid not null references household (id),
  trip_id             uuid not null references trip (id) on delete cascade,
  method              text not null check (method in ('cash', 'card')),
  currency            text not null,                                  -- 退税单上的币种（JPY / MYR…）
  foreign_amount      numeric(14, 2) not null check (foreign_amount > 0),
  rate                numeric(18, 8) not null check (rate > 0),        -- 折本位币用的汇率；本位币本身 = 1
  home_amount         numeric(14, 2) not null check (home_amount >= 0), -- 算进账的本位币金额（待到账时是估算）
  pending             boolean not null default false,                  -- 退到卡还没到账
  member_ids          uuid[] not null check (cardinality(member_ids) > 0), -- 算谁的，平分
  received_by         uuid references member (id) on delete set null, -- 钱在谁手上 / 退到谁的卡
  rate_book_entry_id  uuid,                                            -- 外币现金退税自动建的汇率簿那条
  refund_date         date not null,
  note                text,
  created_by          uuid references member (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint tax_refund_pending_only_card check (method = 'card' or pending = false)
);

create index if not exists idx_tax_refund_trip on tax_refund (trip_id);
create index if not exists idx_tax_refund_household on tax_refund (household_id);

comment on table tax_refund is
  '退税：哪趟行程、现金还是退到卡、退了多少（外币+汇率+本位币）、算谁的（平分，进结算）。'
  '外币现金退税同时在汇率簿有一条（rate_book_entry_id）。不改"这趟已花"和预算，只从"实际花费"里扣。';

alter table tax_refund enable row level security;

drop policy if exists tax_refund_household_isolated on tax_refund;
create policy tax_refund_household_isolated on tax_refund
  for all
  using (household_id = current_household_id())
  with check (household_id = current_household_id());

-- APP 只用登录后的 authenticated 角色读写；匿名角色用不到这张表
revoke all on tax_refund from anon;

drop trigger if exists trg_tax_refund_set_updated_at on tax_refund;
create trigger trg_tax_refund_set_updated_at
  before update on tax_refund
  for each row execute function set_updated_at();
