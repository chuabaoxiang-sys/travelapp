-- =====================================================================
-- 0027_wishlist_place_links.sql
-- "想去的地点"可以挂参考链接（YouTube/Facebook/Bilibili/小红书的视频或帖子），
-- 服务端抓下来的缩略图/标题一起存着，方便回头翻看那条链接介绍的是什么。
--
-- 【为什么用cascade，跟0016的source_wishlist_id处理方式不一样】
-- itinerary_item.source_wishlist_id是"软引用"——那个行程项是真实发生过的安排，
-- 来源地点被删不该连带消失，所以用on delete set null。这里反过来：一条参考
-- 链接脱离了它所属的地点没有独立存在的意义，地点被删，链接理应跟着消失，
-- 所以用on delete cascade。
--
-- 【为什么没有updated_at】链接只有增/删两种操作，没有"编辑"——字段从贴上去
-- 那一刻起就不会再变，想改内容就删掉重贴一条。没有编辑就不需要更新时间戳，
-- 也不需要set_updated_at触发器。
--
-- 【安全性】纯新增表，没有bulk update+DDL的坑，风险很低。
-- =====================================================================

create table if not exists wishlist_place_link (
  id                 uuid primary key default gen_random_uuid(),
  wishlist_place_id  uuid not null references wishlist_place (id) on delete cascade,
  household_id       uuid not null references household (id),
  url                text not null,
  platform           text not null check (platform in ('youtube', 'facebook', 'bilibili', 'xiaohongshu', 'other')),
  title              text,
  thumbnail_url      text,
  created_by         uuid references member (id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists idx_wishlist_place_link_place on wishlist_place_link (wishlist_place_id);
create index if not exists idx_wishlist_place_link_household on wishlist_place_link (household_id);

comment on table wishlist_place_link is
  '挂在wishlist_place下面的参考链接（YouTube/Facebook/Bilibili/小红书等）——'
  'title/thumbnail_url是加链接那一刻服务端抓一次存下来的，不支持编辑、不会自动刷新。';

alter table wishlist_place_link enable row level security;

drop policy if exists wishlist_place_link_household_isolated on wishlist_place_link;
create policy wishlist_place_link_household_isolated on wishlist_place_link
  for all
  using (household_id = current_household_id())
  with check (household_id = current_household_id());
