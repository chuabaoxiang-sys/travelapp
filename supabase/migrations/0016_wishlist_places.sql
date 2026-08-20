-- =====================================================================
-- 0016_wishlist_places.sql
-- "想去的地点"——独立于任何行程的长期收藏清单（餐厅/景点等），按团队(household)
-- 而不是按行程(trip)存，规划新行程时可以从这里一键挑一个塞进当次的行程安排。
--
-- 【为什么不挂在 trip 下面】用户明确要求：这份清单要跨行程长期保留，不随着
-- 某一趟行程规划/结束/删除而变化——它的生命周期比任何单趟行程都长。
--
-- 【为什么 itinerary_item 加的是"来源"指针，而不是反过来在 wishlist_place 上
-- 存一个"已使用"标记】"是否已经排入某趟行程"必须是现查出来的——本项目已经
-- 在 rate_book_entry.use_count 上踩过这个坑（存的计数器会因为引用行被删除而
-- 与事实脱节，被完全移除换成现查，见 domain/rates.ts 的 usageByEntry）。这里
-- 直接不重蹈覆辙：itinerary_item.source_wishlist_id 只是一个可空的追溯指针，
-- 客户端用它反查 itinerary_item 表来现算"这条想去的地点有没有被用过"，
-- wishlist_place 表本身不存任何计数/布尔标记。
--
-- 【为什么 source_wishlist_id 用 on delete set null】wishlist_place 被删除时，
-- 已经生成的 itinerary_item 是真实存在过的行程安排，不应该被连带删除或报错——
-- 这条追溯关系只是个软引用/痕迹，跟 expense.rate_book_entry_id 的处理原则一致。
--
-- 【安全性】纯新增迁移：新表 + itinerary_item 上一个可空新列，没有 bulk UPDATE，
-- 不会触发 0004 遇到的 pending trigger events 问题。
-- =====================================================================

create table if not exists wishlist_place (
  id            uuid primary key default gen_random_uuid(), -- 正常由客户端生成并传入
  household_id  uuid not null references household (id),
  name          text not null,
  lat           numeric(10, 7),
  lng           numeric(10, 7),
  notes         text,
  visited       boolean not null default false,
  created_by    uuid references member (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_wishlist_place_household on wishlist_place (household_id);

comment on table wishlist_place is
  '想去的地点——按团队长期保存的收藏清单，独立于任何单趟行程，规划新行程时'
  '可以一键挑选加入该行程的 itinerary_item。';

alter table wishlist_place enable row level security;

drop policy if exists wishlist_place_household_isolated on wishlist_place;
create policy wishlist_place_household_isolated on wishlist_place
  for all
  using (household_id = current_household_id())
  with check (household_id = current_household_id());

create trigger trg_wishlist_place_set_updated_at
  before update on wishlist_place
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- itinerary_item 新增一列：这一项如果是从"想去的地点"里一键选出来的，记一下
-- 来源，供反查"这条想去的地点有没有被排入过行程"（现查，不存计数器）
-- ---------------------------------------------------------------------

alter table itinerary_item add column if not exists source_wishlist_id uuid
  references wishlist_place (id) on delete set null;

comment on column itinerary_item.source_wishlist_id is
  '这个行程项如果是从"想去的地点"一键选出来生成的，这里记录来源 wishlist_place.id，'
  '纯粹是追溯用途——用来现查"这条想去的地点是否已经排入某趟行程"，wishlist_place '
  '本身不存任何计数/布尔标记。来源被删除时置空，不影响这个行程项本身。';
