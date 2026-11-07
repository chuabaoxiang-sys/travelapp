-- =====================================================================
-- 0052_proxy_repaid_amount_gift.sql
-- 代购结算的两个新选项（2026-11-08 用户定的规则）
--
-- 1) 实际还了多少：标"已还"时可以填实际收到的钱，比算出来的多或少都算还清。
--    差额只归收钱的人（这笔的付款人），跟"代购多收"同一套口径：多还扣他的"我的花费"，
--    少还由他自己承担；其他同行者不受影响。
--    proxy_repaid_amount：这一行实际收回的本位币；null = 照算出来的数（以前标的已还都是 null）。
--    一个人好几笔一起标已还时，客户端按每笔"该还"的比例把实际总额摊到各行。
--
-- 2) 送给他/她：这个人的代购不用还了，按这部分的成本（折后，share_amount）由选中的
--    同行者平分，算进同行者的花费和结算。
--    proxy_gift_member_ids：一起送的同行者 id；null = 没送。送了的行 proxy_repaid_at 也会写上
--    （= 送的时间），这样"还没还"列表自然不再列它。撤销送礼 = 两列都清空。
--    份额不另存：每次算结算时从 share_amount 现分，刷卡补实际扣款后自动跟着变。
--
-- 【为什么不直接把送礼改写成普通分摊行】那样编辑这笔账、补刷卡扣款时会按"怎么分"重算
-- 分摊，送礼就悄悄没了，也没法撤销；留一个标记、计算时再分，这两种情况都不会丢。
--
-- 【安全性】两列都是可空新列，不改已有数据；同时更新 replace_expense_splits 让它带上
-- 新字段（老版本 APP 调它时不带，插进去就是 null，跟以前一样）。
-- =====================================================================

alter table expense_split add column if not exists proxy_repaid_amount numeric(14, 2);
alter table expense_split add column if not exists proxy_gift_member_ids uuid[];

alter table expense_split drop constraint if exists expense_split_proxy_extra_check;
alter table expense_split add constraint expense_split_proxy_extra_check check (
  (proxy_name is not null or (proxy_repaid_amount is null and proxy_gift_member_ids is null))
  and (proxy_repaid_amount is null or proxy_repaid_amount >= 0)
);

comment on column expense_split.proxy_repaid_amount is
  '代购：标已还时实际收回的本位币；null = 照算出来的该还金额。差额只归付款人。';
comment on column expense_split.proxy_gift_member_ids is
  '代购：送给对方时一起送的同行者 id；null = 没送。成本（share_amount）由这些人平分。';

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

  insert into expense_split (id, household_id, expense_id, member_id, share_amount, proxy_name, proxy_amount, proxy_repaid_at, proxy_repaid_amount, proxy_gift_member_ids)
  select
    (r->>'id')::uuid,
    v_household_id,
    p_expense_id,
    (r->>'member_id')::uuid,
    (r->>'share_amount')::numeric,
    nullif(r->>'proxy_name', ''),
    (r->>'proxy_amount')::numeric,
    (r->>'proxy_repaid_at')::timestamptz,
    (r->>'proxy_repaid_amount')::numeric,
    case when jsonb_typeof(r->'proxy_gift_member_ids') = 'array'
      then array(select jsonb_array_elements_text(r->'proxy_gift_member_ids')::uuid)
      else null end
  from jsonb_array_elements(p_rows) as r;
end;
$$;

grant execute on function replace_expense_splits(uuid, jsonb) to authenticated;
