-- =====================================================================
-- 0023_member_preferred_locale.sql
-- 给每个成员加一个语言偏好，为中英双语APP铺路（这次只加字段，不改任何UI）。
--
-- 存在 member 表而不是 household_member：household_member 只是邮箱→团队
-- 的访问控制映射，没有同步到本地；member 才是APP里真正代表"这个人"的、
-- 已经在同步的实体（IdentitySwitcher切换的就是它）。语言偏好挂在这里，
-- 换设备登录、切换"你是谁"身份时，语言都能跟着这个人走，而不是停留在
-- 设备上（深色模式那种纯设备级localStorage方案在这里不适用）。
--
-- null 表示"跟随系统"（呼应 src/lib/theme.ts 里 'system' 的语义——不存
-- 具体值，交给客户端实时读 navigator.language 判断），'zh'/'en' 是用户
-- 在"更多"里手动选定的明确值。
--
-- 纯新增、可空、无默认值副作用，不影响任何已有数据：老的成员行 preferred_locale
-- 全是 null，含义就是"照常跟随系统"，跟加这个字段之前的实际行为完全一样。
-- =====================================================================

alter table member
  add column preferred_locale text
    check (preferred_locale in ('zh', 'en'));

comment on column member.preferred_locale is
  '这个人手动选定的界面语言，null表示跟随设备/浏览器语言实时判断，不是存了'
  '具体的检测结果。';
