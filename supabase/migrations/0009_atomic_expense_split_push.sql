-- =====================================================================
-- 0009_atomic_expense_split_push.sql
-- 修复：多人分摊账目的 expense_split 明细同步不上去，永远卡在"待同步"
--
-- 【根因】0001_init.sql 里 trg_check_expense_split_sum 这道延迟约束触发器，
-- 设计假设是"一笔费用的所有 expense_split 行会在同一个事务里一起插入"——
-- 但客户端实际的同步方式（src/db/sync.ts 的 pushOutbox）是把每一行当成
-- 独立一次网络请求（=独立一个事务）推上去的。于是"总额还没凑齐"的中间状态
-- 就被单独拿去检查，检查不过就被拒绝、永远重试永远失败，真实分摊数据从未
-- 到达服务器。
--
-- 【修复方式】新增一个数据库函数，把"删掉某笔费用的旧分摊行 + 插入新的一整套"
-- 打包在这一个函数调用（=一个事务）里原子性地完成，让延迟约束只在全部新行
-- 都插入完毕后检查一次。同步逻辑改为按 expense_id 打包调用这个函数，
-- 不再逐行推送 expense_split。
-- =====================================================================

create or replace function replace_expense_splits(p_expense_id uuid, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id          uuid;
  v_expense_household_id  uuid;
begin
  v_household_id := current_household_id();
  if v_household_id is null then
    raise exception '未登录或不属于任何团队';
  end if;

  select household_id into v_expense_household_id from expense where id = p_expense_id;
  if v_expense_household_id is null or v_expense_household_id <> v_household_id then
    raise exception '无权操作这笔费用的分摊记录';
  end if;

  delete from expense_split where expense_id = p_expense_id;

  insert into expense_split (id, household_id, expense_id, member_id, share_amount)
  select
    (r->>'id')::uuid,
    v_household_id,
    p_expense_id,
    (r->>'member_id')::uuid,
    (r->>'share_amount')::numeric
  from jsonb_array_elements(p_rows) as r;
end;
$$;

comment on function replace_expense_splits(uuid, jsonb) is
  '把某笔费用的分摊记录整体替换（先删旧的，再插入新的一整套），全程在同一个'
  '事务里完成，让 trg_check_expense_split_sum 这道"分摊总额=费用总额"的延迟'
  '约束检查只在全部新行插入完毕后触发一次，不会在中间状态被提前拒绝。'
  'p_rows 是形如 [{"id":"...","member_id":"...","share_amount":123.45}, ...] 的数组，'
  '由客户端 src/db/sync.ts 的 pushOutbox 按 expense_id 打包调用。';

grant execute on function replace_expense_splits(uuid, jsonb) to authenticated;
