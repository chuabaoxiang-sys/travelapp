-- =====================================================================
-- 0008_feedback_app_version.sql
-- 提交反馈时自动带上当前APP版本（git短SHA）——用户不用自己说"我现在是哪个
-- 版本"，直接看反馈记录就知道是哪次构建产生的问题，排查更准。
-- =====================================================================

alter table feedback add column app_version text;

comment on column feedback.app_version is
  '提交这条反馈时的APP版本（git短SHA），前端在 domain/feedback.ts 里自动带上，'
  '不需要用户手动填写。老反馈记录这一列是空的，不代表数据有问题。';
