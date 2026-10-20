-- =====================================================================
-- 0043_trip_member_household_isolation.sql
-- 收紧 trip_member：从"所有人都能读写"改成"只能读写自己团队行程的记录"。
--
-- 【问题是什么】
-- 0001 建库时所有表都是 allow_all（using true / with check true）。0004 做团队隔离时
-- 把其他表都换成了"household_id = current_household_id()"，唯独 trip_member 因为
-- 从来没被真正写入过、而且没有 household_id 列，被故意跳过（见 0004 的注释）。
-- 结果一直到 2026-10 安全检查时，它还是对所有人（包括匿名访客）开放读写：
-- 拿着网页里公开的 anon key 就能往这张表写东西、读里面的内容。表里一直是 0 行，
-- 写入也必须知道别人行程和成员的随机 uuid，实际危害很小——但门不该开着。
--
-- 【怎么修】
-- 1. 去掉 trip_member_allow_all_v1，换成按团队隔离。这张表没有 household_id 列，
--    通过它引用的行程判断"是不是自己团队的"：读写都要求 trip 属于
--    current_household_id()；写入时还要求 member 也属于同一个团队，免得把别的团队
--    的成员挂到自己的行程上。
-- 2. 只给已登录用户（authenticated），收回 anon 对这张表的全部权限——跟 0039 起的
--    "门不该开"原则一致。
--
-- 【对现有东西的影响】
-- 不改表结构、不动数据（表里是 0 行）。APP 的同步照样会 select 这张表，只是只能
-- 读到自己团队的（本来就是空的）；本地也从来没有真实的 tripMembers 数据会推上来
-- （只有本地测试模式的种子数据，那个模式不连云端）。前端不用改。
-- =====================================================================

drop policy if exists trip_member_allow_all_v1 on public.trip_member;

drop policy if exists trip_member_household_isolated on public.trip_member;
create policy trip_member_household_isolated on public.trip_member
  for all
  to authenticated
  using (
    exists (
      select 1 from public.trip t
       where t.id = trip_member.trip_id
         and t.household_id = public.current_household_id()
    )
  )
  with check (
    exists (
      select 1 from public.trip t
       where t.id = trip_member.trip_id
         and t.household_id = public.current_household_id()
    )
    and exists (
      select 1 from public.member m
       where m.id = trip_member.member_id
         and m.household_id = public.current_household_id()
    )
  );

revoke all on public.trip_member from anon;
