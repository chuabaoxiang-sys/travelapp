-- =====================================================================
-- 0003_sync_fixes.sql
-- 接同步之前发现的几处本地Dexie / 远端Postgres结构不一致，趁数据库还是
-- 全新的（还没有真实行程/账目数据）现在修，成本最低：
--
-- 1) expense_category.id 类型不一致：本地用固定字符串id（如 'seed-cat-food'），
--    远端0001迁移让Postgres自动生成随机UUID——两边的预置分类id完全对不上，
--    任何引用了分类的 expense/budget 一同步就会外键失败。改成 text 类型，
--    用跟本地完全相同的固定字符串重新播种。
-- 2) 本地有、远端缺失的字段：trip.destinationCountries、member.colorTag、
--    member.isActive、rateBookEntry.createdBy。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) 修正 expense_category 的 id 类型，跟本地固定字符串id对齐
-- ---------------------------------------------------------------------
alter table expense drop constraint if exists expense_category_id_fkey;
alter table budget drop constraint if exists budget_category_id_fkey;

-- 全新数据库，目前只有播种的预置分类、还没有真实费用/预算引用它们，可以安全清空重播种
delete from expense_category;

alter table expense_category alter column id drop default;
alter table expense_category alter column id type text using id::text;
alter table expense alter column category_id type text using category_id::text;
alter table budget alter column category_id type text using category_id::text;

alter table expense add constraint expense_category_id_fkey
  foreign key (category_id) references expense_category (id) on delete restrict;
alter table budget add constraint budget_category_id_fkey
  foreign key (category_id) references expense_category (id) on delete cascade;

insert into expense_category (id, name, phase, trip_id, is_default, sort_order) values
  ('seed-cat-insurance',    '保险',     'pre_trip',    null, true, 10),
  ('seed-cat-flight',       '机票',     'pre_trip',    null, true, 20),
  ('seed-cat-visa',         '签证',     'pre_trip',    null, true, 30),
  ('seed-cat-stay-prepaid', '酒店预付', 'pre_trip',    null, true, 40),
  ('seed-cat-food',         '餐饮',     'during_trip', null, true, 50),
  ('seed-cat-transport',    '交通',     'during_trip', null, true, 60),
  ('seed-cat-shopping',     '购物',     'during_trip', null, true, 70),
  ('seed-cat-ticket',       '门票',     'during_trip', null, true, 80),
  ('seed-cat-stay-onsite',  '住宿现付', 'during_trip', null, true, 90),
  ('seed-cat-misc',         '杂项',     'either',      null, true, 100);

-- ---------------------------------------------------------------------
-- 2) 补上本地有、远端缺失的字段
-- ---------------------------------------------------------------------
alter table trip add column if not exists destination_countries text[];

alter table member add column if not exists color_tag text;
alter table member add column if not exists is_active boolean not null default true;

alter table rate_book_entry add column if not exists created_by uuid references member (id) on delete set null;

comment on column trip.destination_countries is
  '目的地国家（ISO 3166-1 alpha-2 小写代码数组），用来把地点搜索限制在这些国家范围内。';
