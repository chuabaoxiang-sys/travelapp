-- =====================================================================
-- 0002_settlement_feedback.sql
-- 补上 0001 之后新增的两张表：结算记录（阶段3d）、用户反馈（阶段6后追加）
-- 沿用 0001 同样的约定：client-generated PK、updated_at 触发器、v1 无登录 permissive RLS
-- =====================================================================

-- ---------------------------------------------------------------------
-- settlement：结算记录——分账页"去结算"产生的实际结款记录
-- ---------------------------------------------------------------------
create table settlement (
  id              uuid primary key default gen_random_uuid(), -- 正常由客户端生成并传入
  trip_id         uuid not null references trip (id) on delete cascade,
  from_member_id  uuid not null references member (id) on delete restrict,
  to_member_id    uuid not null references member (id) on delete restrict,

  amount          numeric(14, 2) not null check (amount > 0),
  settled_date    date not null,
  note            text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  check (from_member_id <> to_member_id)
);

comment on table settlement is
  '记录"谁实际付给谁多少钱"，用于抵扣 computeBalances 算出来的净额（应用层逻辑，'
  '不在数据库里重算）。支持部分结清——同一对 from/to 可以有多条记录累加。';

create index idx_settlement_trip_id on settlement (trip_id);
create index idx_settlement_from_member on settlement (from_member_id);
create index idx_settlement_to_member on settlement (to_member_id);

create trigger trg_settlement_set_updated_at
  before update on settlement
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- feedback：用户反馈——家人使用APP时提交的问题/建议，供后续整理参考
-- ---------------------------------------------------------------------
create type feedback_category as enum ('bug', 'suggestion', 'other');

create table feedback (
  id            uuid primary key default gen_random_uuid(), -- 正常由客户端生成并传入
  -- 反馈跟哪趟行程无关也可以提交，所以允许为 null；行程被删除时反馈本身不跟着删
  -- （反馈是关于APP本身的，不是行程数据的一部分）
  trip_id       uuid references trip (id) on delete set null,
  submitted_by  uuid not null references member (id) on delete restrict,

  category      feedback_category not null,
  content       text not null check (char_length(trim(content)) > 0),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_feedback_submitted_by on feedback (submitted_by);
create index idx_feedback_created_at on feedback (created_at desc);

create trigger trg_feedback_set_updated_at
  before update on feedback
  for each row execute function set_updated_at();

-- =====================================================================
-- Row Level Security：跟 0001 一样，v1 无登录，全表放行
-- =====================================================================
do $$
declare
  t text;
begin
  foreach t in array array['settlement', 'feedback']
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for all using (true) with check (true)',
      t || '_allow_all_v1', t
    );
  end loop;
end;
$$;
