-- =====================================================================
-- 0046_expense_split_proxy.sql
-- 代购：一笔账里帮没来旅行的人（妈妈、同事小王……）买的那部分
--
-- 【为什么塞进 expense_split，不另开一张表】
-- expense_split 有一道"分摊合计 = expense.home_amount"的延迟约束（0001 的
-- trg_check_expense_split_sum），而且整笔账的分摊是用 replace_expense_splits()
-- 原子替换推上来的（0009）。代购那部分钱如果放在另一张表，这道约束就得改成
-- "分摊 + 代购 = 总额"，两张表还得一起原子推送，同步那套全要重做。
-- 放进 expense_split 当成特殊的一行：member_id 记这笔的付款人（钱是他垫的、
-- 也是他收回来），proxy_name 记帮谁买的。合计约束、原子推送一行都不用改。
-- 代价是读分摊的地方要认出这种行：算同行者之间谁欠谁、"我的花费"时跳过它们
-- （见 src/domain/splits.ts 的 isProxySplit）。
--
-- 【三列】
-- proxy_name：帮谁买的，只是个名字——这些人不是团队成员，不用这个 APP。
-- proxy_amount：按这笔账自己的币种记的金额（照收据填的 ¥4,600）。share_amount
--   照旧是折成本位币的 RM，由客户端按这笔的汇率算；刷卡补了实际扣款后跟着重算。
-- proxy_repaid_at：对方还钱后"标已还"的时间；null = 还没还。
--
-- 【唯一约束】
-- 原来的 unique (expense_id, member_id) 不能留：付款人自己有一份分摊，同一笔里
-- 又挂着几行代购（member_id 都是付款人）。改成两条部分唯一索引：普通分摊仍然
-- 一人一行；代购行同一笔里同一个名字只能一行。
--
-- 【安全性】只加可空的新列、换唯一约束、更新一个函数；不改任何已有数据，
-- 没有 bulk update + 同表 DDL 的坑。老版本 APP 调 replace_expense_splits 不带
-- 新字段，插进去就是普通分摊行，跟以前完全一样。
-- =====================================================================

alter table expense_split add column if not exists proxy_name text;
alter table expense_split add column if not exists proxy_amount numeric(14, 2);
alter table expense_split add column if not exists proxy_repaid_at timestamptz;

alter table expense_split drop constraint if exists expense_split_proxy_fields_check;
alter table expense_split add constraint expense_split_proxy_fields_check check (
  (proxy_name is null and proxy_amount is null and proxy_repaid_at is null)
  or (proxy_name is not null and char_length(trim(proxy_name)) > 0 and proxy_amount is not null and proxy_amount > 0)
);

comment on column expense_split.proxy_name is
  '代购：帮谁买的（不是团队成员，只是名字）。非 null 时这一行不是同行者的分摊，'
  'member_id = 付款人，share_amount = 这部分折成本位币的金额，不算进同行者之间的结算。';
comment on column expense_split.proxy_amount is '代购：按这笔账自己的币种记的金额（照收据填的外币）。';
comment on column expense_split.proxy_repaid_at is '代购：对方还钱后标"已还"的时间；null = 还没还。';

alter table expense_split drop constraint if exists expense_split_expense_id_member_id_key;
create unique index if not exists uq_expense_split_member
  on expense_split (expense_id, member_id) where proxy_name is null;
create unique index if not exists uq_expense_split_proxy
  on expense_split (expense_id, proxy_name) where proxy_name is not null;

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

  insert into expense_split (id, household_id, expense_id, member_id, share_amount, proxy_name, proxy_amount, proxy_repaid_at)
  select
    (r->>'id')::uuid,
    v_household_id,
    p_expense_id,
    (r->>'member_id')::uuid,
    (r->>'share_amount')::numeric,
    nullif(r->>'proxy_name', ''),
    (r->>'proxy_amount')::numeric,
    (r->>'proxy_repaid_at')::timestamptz
  from jsonb_array_elements(p_rows) as r;
end;
$$;

-- 生产库原本就有这条授权（0009），测试库当时缺了整个函数，补上不影响生产
grant execute on function replace_expense_splits(uuid, jsonb) to authenticated;
