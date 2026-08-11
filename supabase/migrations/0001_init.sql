-- =====================================================================
-- 0001_init.sql
-- 家庭旅游记账 PWA —— 初始数据库结构
-- 对应实施计划「数据模型（核心表）」章节，实体范围：
--   trip / member / trip_member / itinerary_day / itinerary_item /
--   expense_category / rate_book_entry / expense / expense_split / budget
--
-- 【关于登录/RLS 的重要说明】
-- v1 不做登录，任何拿到链接的人都可以任意身份记账（信任模型，非安全边界）。
-- 因此本迁移里所有表的 Row Level Security 都设置为"放行"（启用 RLS 但用
-- `using (true) / with check (true)` 的permissive策略），保证 Supabase
-- 匿名 key 能直接读写。
--
-- 但 `member.auth_user_id` 字段从第一天就预留出来（可为 null），专门是为了
-- 未来引入真登录时，不需要重写表结构——只需要：
--   1) 把 auth_user_id 填上真实的 auth.uid()；
--   2) 把下面这些 `using (true)` 策略，逐个替换成类似
--        using (member_id in (select id from member where auth_user_id = auth.uid()))
--      这种基于 auth.uid() 的收紧策略。
-- 这次迁移只负责挖好这个钩子，不在这里实现收紧逻辑。
-- =====================================================================

-- 兼容性：确保 gen_random_uuid() 可用（PG13+ 已内置于核心，这里加 pgcrypto 只是为了
-- 兼容更旧的 Postgres/本地环境，Supabase 标准环境下通常是多余但无害的）。
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 通用：updated_at 自动维护触发器
-- ---------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function set_updated_at() is
  '通用触发器函数：在 UPDATE 时自动把 updated_at 刷新为当前时间，所有带 updated_at 列的表都挂这个触发器。';

-- ---------------------------------------------------------------------
-- 枚举类型
-- ---------------------------------------------------------------------

-- 行程状态。计划文档没有把具体取值列到字段级，这里按常见旅行记账场景补充。
create type trip_status as enum ('planning', 'ongoing', 'completed', 'archived');

-- 费用所属阶段：出行前 / 途中 / 两者皆可（用于 expense_category 和 expense 的快照字段）
create type expense_phase as enum ('pre_trip', 'during_trip', 'either');

-- 汇率簿条目的来源：手动输入 / 采纳了 API 建议值 / 在 API 建议值基础上手动改过
create type rate_source as enum ('manual', 'api_accepted', 'api_edited');

-- 费用分摊方式
--   none       ：不分摊，全部算记录人/付款人自己的（个人消费，不进入 Splitwise 式结算）
--   equal      ：行程成员平均分摊
--   exact      ：手动指定每人分摊的具体金额
--   percentage ：按百分比分摊
create type split_type as enum ('none', 'equal', 'exact', 'percentage');

-- ---------------------------------------------------------------------
-- member：家庭成员
-- ---------------------------------------------------------------------
create table member (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null check (char_length(trim(display_name)) > 0),

  -- 未来登录预留钩子：v1 恒为 null，不加外键约束到 auth.users，避免在还没有真正
  -- 引入 Supabase Auth 之前就产生耦合；等接入登录后再补 FK + 收紧 RLS。
  auth_user_id  uuid,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column member.auth_user_id is
  '预留字段，v1 恒为 null。未来接入 Supabase Auth 后，用于把某个登录账号绑定到某个家庭成员，'
  '从而把 RLS 策略从 using(true) 收紧为 auth.uid() = member.auth_user_id 风格。';

-- 一个 auth 账号未来最多绑定一个 member（一旦开始使用登录）
create unique index idx_member_auth_user_id on member (auth_user_id) where auth_user_id is not null;

create trigger trg_member_set_updated_at
  before update on member
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- trip：行程
-- ---------------------------------------------------------------------
create table trip (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (char_length(trim(name)) > 0),

  -- 本位币，ISO 4217 三位字母代码，默认马币
  home_currency         text not null default 'MYR' check (home_currency ~ '^[A-Z]{3}$'),

  start_date            date,
  end_date              date,
  status                trip_status not null default 'planning',

  -- 只读分享链接
  public_share_enabled  boolean not null default false,
  public_share_token    uuid unique,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  check (end_date is null or start_date is null or end_date >= start_date),
  -- 开启分享时必须已生成 token；关闭时 token 是否保留由应用决定（保留也没关系，
  -- 因为访问入口由 public_share_enabled 把关）
  check (not public_share_enabled or public_share_token is not null)
);

comment on column trip.public_share_token is
  '只读分享链接的 token。这不是真正的访问控制，只是不易猜到的随机字符串——'
  '拿到链接的任何人都能看到行程安排（但看不到账目，账目相关表在查询层完全不引用这个 token）。';

create trigger trg_trip_set_updated_at
  before update on trip
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- trip_member：行程与成员的关联
-- ---------------------------------------------------------------------
create table trip_member (
  trip_id     uuid not null references trip (id) on delete cascade,
  member_id   uuid not null references member (id) on delete cascade,
  joined_at   timestamptz not null default now(),

  primary key (trip_id, member_id)
);

-- 复合主键 (trip_id, member_id) 已经能服务 "按 trip_id 查成员" 的查询（最左前缀）；
-- 但反过来"某个成员参与了哪些行程"需要单独索引 member_id。
create index idx_trip_member_member_id on trip_member (member_id);

-- ---------------------------------------------------------------------
-- expense_category：费用分类
-- ---------------------------------------------------------------------
create table expense_category (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) > 0),
  phase       expense_phase not null,

  -- null = 全局预置分类（所有行程共用）；非 null = 某个行程下用户自建的分类
  trip_id     uuid references trip (id) on delete cascade,

  -- 区分系统预置分类 vs 用户自建分类，方便 UI 上区分展示/禁止误删预置项
  is_default  boolean not null default false,
  sort_order  integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table expense_category is
  '费用分类。trip_id 为 null 表示全局预置分类，非 null 表示某趟行程下用户自建的分类。'
  '分类被 expense 引用后不允许物理删除（见 expense.category_id 的 on delete restrict），'
  '应用层应该用"停用/隐藏"而不是删除来退役一个分类，避免破坏历史费用记录的引用完整性。';

-- 同一个"作用域"（全局 or 某个行程）内分类名不能重名
create unique index idx_expense_category_global_name
  on expense_category (name) where trip_id is null;
create unique index idx_expense_category_trip_name
  on expense_category (trip_id, name) where trip_id is not null;

create index idx_expense_category_trip_id on expense_category (trip_id) where trip_id is not null;
create index idx_expense_category_phase on expense_category (phase);

create trigger trg_expense_category_set_updated_at
  before update on expense_category
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- itinerary_day：行程记录核心表——按行程+日期存一天的安排
--
-- 【client-generated PK 说明】
-- 这张表的 id 由前端离线写入时生成（客户端 UUID），同步到 Supabase 时用
-- "upsert by id" 的方式写入，天然幂等、重试安全（见实施计划"离线同步架构"节）。
-- 这里仍然保留 default gen_random_uuid()，只是作为服务端直接插入（如脚本/种子数据）
-- 时的兜底；正常前端离线写入路径一定会显式传入客户端生成的 id。
-- ---------------------------------------------------------------------
create table itinerary_day (
  id          uuid primary key default gen_random_uuid(), -- 正常由客户端生成并传入
  trip_id     uuid not null references trip (id) on delete cascade,
  day_date    date not null,
  title       text,
  summary     text,
  notes       text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- 同一趟行程同一天只有一条 itinerary_day 记录，时间线视图和日历视图共用这份数据
  unique (trip_id, day_date)
);

create trigger trg_itinerary_day_set_updated_at
  before update on itinerary_day
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- itinerary_item：某一天下的具体行程项
-- 同样是 client-generated PK（离线创建，upsert by id 同步），见上方说明。
-- ---------------------------------------------------------------------
create table itinerary_item (
  id             uuid primary key default gen_random_uuid(), -- 正常由客户端生成并传入
  day_id         uuid not null references itinerary_day (id) on delete cascade,

  sort_order     integer not null default 0,
  start_time     time,              -- 可选，仅"当天大致时间"，不强制要求
  title          text not null check (char_length(trim(title)) > 0),

  location_name  text,
  lat            numeric(9, 6) check (lat is null or (lat >= -90 and lat <= 90)),
  lng            numeric(9, 6) check (lng is null or (lng >= -180 and lng <= 180)),
  -- 有经纬度才能在地图上标点；只填了地点名但没选点时 lat/lng 都为 null，地图视图跳过即可
  notes          text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index idx_itinerary_item_day_id on itinerary_item (day_id);
-- 行程项按天内顺序展示时的典型查询
create index idx_itinerary_item_day_sort on itinerary_item (day_id, sort_order);

create trigger trg_itinerary_item_set_updated_at
  before update on itinerary_item
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- rate_book_entry：汇率簿——按行程+外币存多条带标签的汇率
-- 同样是 client-generated PK（新建汇率标签这个动作本身也可能离线发生）。
--
-- rate 的方向约定：rate = 1 单位 currency_code 折算成多少单位 trip.home_currency
-- 例如 currency_code = 'USD'、home_currency = 'MYR' 时，rate ≈ 4.35 表示 1 USD ≈ 4.35 MYR。
-- ---------------------------------------------------------------------
create table rate_book_entry (
  id              uuid primary key default gen_random_uuid(), -- 正常由客户端生成并传入
  trip_id         uuid not null references trip (id) on delete cascade,
  currency_code   text not null check (currency_code ~ '^[A-Z]{3}$'),
  label           text not null check (char_length(trim(label)) > 0),

  rate            numeric(18, 8) not null check (rate > 0),
  source          rate_source not null default 'manual',

  use_count       integer not null default 0 check (use_count >= 0),
  last_used_at    timestamptz,

  -- 归档而不是物理删除："只影响未来的新记录，不追溯改历史记录"——已发生的 expense
  -- 已经把 rate_used/home_amount 快照下来了，归档一个标签完全不影响历史费用。
  archived_at     timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table rate_book_entry is
  '汇率簿。归档（archived_at 非空）只是让它不再出现在"记账时可复用"的推荐列表里，'
  '不会物理删除，因此已经引用它的 expense.rate_book_entry_id 永远保持有效，'
  '历史费用的 rate_used/home_amount 快照也永远不受影响。';

-- 同一趟行程同一币种下标签不能重名（"另存为新标签"必须是不同名字）
create unique index idx_rate_book_entry_trip_currency_label
  on rate_book_entry (trip_id, currency_code, label);

-- 记账时"最近用过的汇率"标签推荐排序：按币种分组，未归档优先，按最近使用时间排序
create index idx_rate_book_entry_recent
  on rate_book_entry (trip_id, currency_code, last_used_at desc)
  where archived_at is null;

-- 记账时"最常用的汇率"标签推荐排序：同上但按使用次数排序
create index idx_rate_book_entry_most_used
  on rate_book_entry (trip_id, currency_code, use_count desc)
  where archived_at is null;

create trigger trg_rate_book_entry_set_updated_at
  before update on rate_book_entry
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- expense：费用记录
-- 同样是 client-generated PK（离线记账场景的核心表，upsert by id 同步）。
-- ---------------------------------------------------------------------
create table expense (
  id                  uuid primary key default gen_random_uuid(), -- 正常由客户端生成并传入

  trip_id             uuid not null references trip (id) on delete cascade,
  category_id         uuid not null references expense_category (id) on delete restrict,

  -- 费用发生日期。即使这笔费用没有挂到任何具体的 itinerary_day 上（比如出行前买保险，
  -- 那时行程日历可能还没排出来），报表/预算统计仍然需要一个日期维度，所以这里独立存一份，
  -- 不依赖 itinerary_day_id 是否填写。
  expense_date        date not null,

  -- 【关键：phase 为什么在这里再存一份，而不是 join expense_category.phase 现算】
  -- expense_category.phase 是"分类当前的阶段标签"，未来分类可能被编辑（比如把某个分类
  -- 从 during_trip 改成 either）。如果 expense 的阶段永远靠 join 分类表现算，那么一旦
  -- 分类被改了，所有历史费用的"出行前/途中"归属会被静默地追溯改变——这正是实施计划里
  -- 明确排除的行为（"分类的 phase 标签...都是不追溯历史的设计"）。所以这里在记账当下把
  -- phase 快照下来，之后分类怎么改都不影响这条历史记录。
  phase               expense_phase not null,

  expense_currency    text not null check (expense_currency ~ '^[A-Z]{3}$'),
  expense_amount      numeric(14, 2) not null check (expense_amount > 0),

  -- 引用的汇率簿条目。为 null 表示：花费币种本身就是本位币，不需要汇率。
  rate_book_entry_id  uuid references rate_book_entry (id) on delete set null,

  -- 【关键：rate_used / home_amount 为什么是快照，而不是现算】
  -- 汇率簿里的汇率标签之后可能被编辑、另存为新标签、或归档（见 rate_book_entry 设计），
  -- 但已经记好的这笔费用当时到底用了什么汇率、折算成本位币是多少钱，必须原样保留，
  -- 否则历史账目会随着汇率簿的编辑"重写历史"。所以记账那一刻就把汇率和折算结果落地存死，
  -- rate_book_entry_id 只是"当时引用过哪个标签"的溯源信息，不参与之后的金额计算。
  rate_used           numeric(18, 8) check (rate_used is null or rate_used > 0),
  home_amount         numeric(14, 2) not null check (home_amount > 0),

  paid_by             uuid references member (id) on delete restrict,
  recorded_by         uuid references member (id) on delete restrict,

  split_type          split_type not null default 'none',

  -- 挂到具体某一天 / 某个具体行程项（都可选）。若填写了 itinerary_item_id，
  -- 其所属的 day_id 必须与这里的 itinerary_day_id 一致——由下面的触发器强制校验，
  -- 而不是简单的 check 约束（check 约束不能跨表查询 itinerary_item 的 day_id）。
  itinerary_day_id    uuid references itinerary_day (id) on delete set null,
  itinerary_item_id   uuid references itinerary_item (id) on delete set null,

  notes               text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on column expense.rate_used is
  '记账当时快照的汇率（1 单位 expense_currency = rate_used 单位本位币）。'
  '为 null 仅当 expense_currency 本身就是本位币时（无需汇率）。之后汇率簿怎么改都不会追溯影响这个值。';

comment on column expense.home_amount is
  '记账当时快照折算成本位币后的金额 = expense_amount * rate_used（币种为本位币时 = expense_amount）。'
  '预算/汇总统计全部基于这个字段，而不是实时重新换算。';

-- 挂到某天/某行程项时，行程视图据此汇总"当天/该项目花了多少钱"
create index idx_expense_itinerary_day_id
  on expense (itinerary_day_id) where itinerary_day_id is not null;
create index idx_expense_itinerary_item_id
  on expense (itinerary_item_id) where itinerary_item_id is not null;

-- 按行程查费用列表，通常按日期倒序展示
create index idx_expense_trip_date on expense (trip_id, expense_date desc);
create index idx_expense_category_id on expense (category_id);
create index idx_expense_rate_book_entry_id on expense (rate_book_entry_id) where rate_book_entry_id is not null;
create index idx_expense_paid_by on expense (paid_by) where paid_by is not null;
create index idx_expense_recorded_by on expense (recorded_by) where recorded_by is not null;

create trigger trg_expense_set_updated_at
  before update on expense
  for each row execute function set_updated_at();

-- itinerary_item.day_id 与 expense.itinerary_day_id 的一致性校验触发器
create or replace function fn_expense_check_item_day_consistency()
returns trigger
language plpgsql
as $$
declare
  v_item_day_id uuid;
begin
  if new.itinerary_item_id is not null then
    select day_id into v_item_day_id
    from itinerary_item
    where id = new.itinerary_item_id;

    if v_item_day_id is null then
      raise exception 'itinerary_item_id % 不存在', new.itinerary_item_id;
    end if;

    if new.itinerary_day_id is null then
      -- 只填了 itinerary_item_id，没填 itinerary_day_id：自动补齐，保持两者一致
      new.itinerary_day_id := v_item_day_id;
    elsif new.itinerary_day_id <> v_item_day_id then
      raise exception
        'expense.itinerary_day_id (%) 与 itinerary_item_id (%) 所属的 day_id (%) 不一致',
        new.itinerary_day_id, new.itinerary_item_id, v_item_day_id;
    end if;
  end if;

  return new;
end;
$$;

comment on function fn_expense_check_item_day_consistency() is
  '强制保证：若 expense 挂了 itinerary_item_id，则其 itinerary_day_id 必须等于'
  '该行程项所属的 day_id（对应计划里"若填写则其 day_id 需与 itinerary_day_id 一致"的要求）。'
  '用触发器而不是 check 约束实现，因为需要跨表查询 itinerary_item。';

create trigger trg_expense_check_item_day_consistency
  before insert or update on expense
  for each row execute function fn_expense_check_item_day_consistency();

-- ---------------------------------------------------------------------
-- expense_split：费用分摊明细，落地为具体金额
-- ---------------------------------------------------------------------
create table expense_split (
  id            uuid primary key default gen_random_uuid(),
  expense_id    uuid not null references expense (id) on delete cascade,
  member_id     uuid not null references member (id) on delete restrict,

  share_amount  numeric(14, 2) not null check (share_amount >= 0),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- 同一笔费用里，同一个人只应该有一条分摊记录
  unique (expense_id, member_id)
);

create index idx_expense_split_expense_id on expense_split (expense_id);
-- "按人统计/结算"视图需要按 member_id 聚合，跨行程/跨费用查询
create index idx_expense_split_member_id on expense_split (member_id);

create trigger trg_expense_split_set_updated_at
  before update on expense_split
  for each row execute function set_updated_at();

-- 分摊金额之和必须等于 expense.home_amount（允许 1 分钱的舍入误差），
-- 用 DEFERRABLE 约束触发器，在事务提交前才检查——因为一笔 expense 的多条
-- expense_split 通常是在同一个事务里跟 expense 一起插入的，不能在插入第一条
-- split 时就报"总和不对"。
create or replace function fn_check_expense_split_sum()
returns trigger
language plpgsql
as $$
declare
  v_expense_id     uuid;
  v_home_amount    numeric(14, 2);
  v_split_total    numeric(14, 2);
  v_split_type     split_type;
begin
  v_expense_id := coalesce(new.expense_id, old.expense_id);

  select home_amount, split_type into v_home_amount, v_split_type
  from expense
  where id = v_expense_id;

  -- expense 本身在同一事务里被删除的情况下（级联删除 split），无需再校验
  if v_home_amount is null then
    return null;
  end if;

  -- split_type = 'none' 表示这笔费用不分摊，不要求存在 expense_split 行，跳过校验
  if v_split_type = 'none' then
    return null;
  end if;

  select coalesce(sum(share_amount), 0) into v_split_total
  from expense_split
  where expense_id = v_expense_id;

  if abs(v_split_total - v_home_amount) > 0.01 then
    raise exception
      'expense % 的分摊总额 % 与 home_amount % 不一致（split_type=%）',
      v_expense_id, v_split_total, v_home_amount, v_split_type;
  end if;

  return null;
end;
$$;

comment on function fn_check_expense_split_sum() is
  '保证 expense_split 的分摊金额之和 = expense.home_amount（容许 0.01 的舍入误差）。'
  '金额分摊逻辑最容易出隐蔽 bug，这里作为数据库层的最后一道防线，而不是只靠前端计算保证正确。';

create constraint trigger trg_check_expense_split_sum
  after insert or update or delete on expense_split
  deferrable initially deferred
  for each row execute function fn_check_expense_split_sum();

-- ---------------------------------------------------------------------
-- budget：预算（整趟行程或按分类），含超支提醒阈值
-- ---------------------------------------------------------------------
create table budget (
  id                  uuid primary key default gen_random_uuid(),
  trip_id             uuid not null references trip (id) on delete cascade,

  -- null = 整趟行程的总预算；非 null = 该行程下某个分类的预算
  category_id         uuid references expense_category (id) on delete cascade,

  amount              numeric(14, 2) not null check (amount > 0),
  -- 超支提醒阈值（百分比），例如 80 表示花到预算的 80% 时提醒
  alert_threshold_pct numeric(5, 2) not null default 80 check (alert_threshold_pct > 0 and alert_threshold_pct <= 200),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 一趟行程最多一条"整体预算"（category_id 为 null），每个分类最多一条预算
create unique index idx_budget_trip_overall on budget (trip_id) where category_id is null;
create unique index idx_budget_trip_category on budget (trip_id, category_id) where category_id is not null;

create index idx_budget_trip_id on budget (trip_id);
create index idx_budget_category_id on budget (category_id) where category_id is not null;

create trigger trg_budget_set_updated_at
  before update on budget
  for each row execute function set_updated_at();

-- =====================================================================
-- Row Level Security：v1 无登录，全表放行
-- =====================================================================
-- 启用 RLS 但用 using(true)/with check(true) 的 permissive 策略，而不是直接不开 RLS，
-- 是为了让"以后要收紧"这件事只需要 DROP POLICY + CREATE POLICY，不需要先补 ALTER TABLE
-- ENABLE ROW LEVEL SECURITY（这一步本身在生产表上有一点点开销/风险，不如现在就做好）。

do $$
declare
  t text;
begin
  foreach t in array array[
    'member', 'trip', 'trip_member', 'expense_category',
    'itinerary_day', 'itinerary_item', 'rate_book_entry',
    'expense', 'expense_split', 'budget'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for all using (true) with check (true)',
      t || '_allow_all_v1', t
    );
  end loop;
end;
$$;

comment on schema public is
  'v1 无登录：所有表的 RLS 策略都是 <table>_allow_all_v1（using(true)/with check(true)）。'
  '未来引入 Supabase Auth 后，把这些策略逐个替换成基于 member.auth_user_id = auth.uid() 的收紧策略，'
  '不需要改表结构。';

-- =====================================================================
-- 种子数据：全局预置费用分类
-- =====================================================================
insert into expense_category (name, phase, trip_id, is_default, sort_order) values
  ('保险',     'pre_trip',     null, true, 10),
  ('机票',     'pre_trip',     null, true, 20),
  ('签证',     'pre_trip',     null, true, 30),
  ('酒店预付', 'pre_trip',     null, true, 40),
  ('餐饮',     'during_trip',  null, true, 50),
  ('交通',     'during_trip',  null, true, 60),
  ('购物',     'during_trip',  null, true, 70),
  ('门票',     'during_trip',  null, true, 80),
  ('住宿现付', 'during_trip',  null, true, 90),
  ('杂项',     'either',       null, true, 100);
