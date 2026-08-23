-- =====================================================================
-- 0019_settlement_expense_link.sql
-- 结算记录可以关联到具体某一笔账目——"按笔结算"功能：之前一笔结算只能是
-- "A付给B多少钱"的聚合金额，现在可以额外指定"这是在还哪一笔账"。
--
-- 纯新增、可空字段，不影响任何已有数据：老的结算记录 expense_id 全部是
-- null，含义完全不变，还是"聚合结算"，现有的 computeBalances 汇总口径
-- （不管 expense_id 是不是空，都照样累加进 settledOut/settledIn）不用改。
--
-- on delete cascade 而不是 restrict：应用层已经不允许删除"被结算过的账目"
-- （哪怕只结算了一部分），所以唯一会触发这个外键的场景是整趟行程被删除
-- （trip 那边是 on delete cascade，会把这张行程下的账目和结算记录一起清掉），
-- 这时结算记录跟着账目一起消失是正确行为，不是意外丢数据。
-- =====================================================================

alter table settlement
  add column expense_id uuid references expense (id) on delete cascade;

comment on column settlement.expense_id is
  '这笔结算具体对应哪一笔账目——null表示这是聚合结算（旧版"结算建议"生成的那种，'
  '不对应单一账目）。有值表示这是"按笔结算"针对某一笔账目记的还款，应用层会据此'
  '禁止编辑/删除已经有结算记录指向自己的账目。';

create index idx_settlement_expense_id on settlement (expense_id);
