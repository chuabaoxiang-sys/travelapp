-- =====================================================================
-- 0025_enable_self_serve_signup.sql
-- 正式打开0022留的总开关——自助创建团队功能上线。
--
-- 0022的注释写得很明确：这一步必须是"以后另一个单独、明确的动作"，不能
-- 跟0022本身混在一起（那次上线要求生产行为零变化）。这就是那个单独的动作。
--
-- 打开之后，is_invited_email() 对任何邮箱都返回true——登录页不再限制"只有
-- 被邀请的邮箱才能收验证码"，任何人都能自助登录+建团队。这也意味着
-- domain/household.ts的sendLoginCode()里那句"防止陌生人在登录框里乱试
-- 邮箱耗尽发信额度"的注释描述的防线不再生效，需要接受这个风险（已经跟
-- 用户确认：网站没有公开推广、不会被搜索引擎收录，被陌生人刷到的概率低，
-- 先开、真出问题再关）。
--
-- 团队隔离本身不受影响：新团队照样是完全独立的household，跟其他团队互相
-- 看不到，这个开关只影响"谁能登录+建团队"，不影响"建完之后能看到什么"。
--
-- 可逆：真要关掉，另外单独跑一条 select false 的版本即可，不影响已经
-- 建好的团队。
-- =====================================================================

create or replace function self_serve_signup_enabled()
returns boolean
language sql
stable
set search_path = public
as $$
  select true
$$;

comment on function self_serve_signup_enabled() is
  '自助创建团队功能的总开关，0025起为true（已开放）。要关闭时另外单独跑一条'
  'create or replace function ... select false 语句。';
