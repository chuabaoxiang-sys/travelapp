-- =====================================================================
-- 0005_invite_check_rpc.sql
-- 登录前的"这个邮箱是否被邀请"检查——不需要登录就能调用，只回答true/false，
-- 不暴露任何团队信息（哪个团队、团队总数等），符合0004里"团队隐蔽性"的要求。
--
-- 【要解决的问题】household_member 表本身有RLS（只能查自己那一条），所以APP
-- 在真正发起登录（signInWithOtp）之前，没法判断这个邮箱是否在邀请名单里——
-- 结果是任何拿到网站密码墙密码的人，都能在登录框里乱试邮箱，每一次都会真的
-- 触发一封邮件发出去，可能耗尽发信额度、甚至连累发信邮箱的信誉。
--
-- 【方案】加一个 security definer 函数，绕开RLS去查一次，但只返回一个布尔值——
-- 调用者拿到的信息量和"我猜这个邮箱存在" vs "不存在"一样多，不会多泄露团队
-- 名字、数量等信息。APP在调用 signInWithOtp 之前先调这个函数，false就直接
-- 提示"还没被邀请"，完全不触发真实发信。
-- =====================================================================

create or replace function is_invited_email(check_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from household_member where email = check_email)
$$;

comment on function is_invited_email(text) is
  '登录前的邀请名单检查，只返回true/false。用于在真正发送登录邮件之前拦掉'
  '不在邀请名单里的邮箱，避免被人乱试邮箱耗尽发信额度或损害发信邮箱信誉。'
  '不需要登录即可调用（未登录请求也需要在发信前判断"值不值得发"）。';

grant execute on function is_invited_email(text) to anon;
grant execute on function is_invited_email(text) to authenticated;
