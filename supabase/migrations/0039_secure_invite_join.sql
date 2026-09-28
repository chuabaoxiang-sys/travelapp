-- =====================================================================
-- 0039_secure_invite_join.sql
-- 堵上"用邀请码加入团队"的冒名漏洞。
--
-- 【漏洞是什么】
-- 0007的join_household_by_invite_code(p_email, p_code)允许匿名调用，而且直接把
-- 调用方传进来的p_email写进household_member，完全不核对"你是谁"。任何人都可以：
-- 自助建一个团队 → 拿到自己团队的邀请码 → 把"别人的邮箱"塞进自己的团队。对方
-- 以后第一次登录时，current_household_id()找不到household_active，会回落到他最早
-- 的一条成员记录——也就是攻击者的团队；create_household又会因为"这个邮箱已经属于
-- 一个团队"拒绝他另建团队。从此他记的每一笔账、每个行程都写进攻击者的团队，
-- 攻击者正常登录就能看到。只需要知道对方的邮箱。
-- 2026-09-28数据后台上线前的安全审核里发现；当时生产库全部6条成员记录都核对过，
-- 都是认识的人，没有被利用过的迹象。
--
-- 【怎么修】
-- 1. 只认"当前登录账号此刻已验证的邮箱"：用auth.uid()去auth.users查
--    email_confirmed_at不为空的那一行——不用调用方传的邮箱，也不用JWT里的email
--    claim（理由同0038：claim是签发时的快照）。没登录/邮箱没验证直接返回false。
-- 2. 收回anon的执行权限——"没登录先替某个邮箱加入"这条路本身就是漏洞。前端改成
--    验证码登录成功之后，再用登录页填的邀请码加入。
-- 3. 保留p_email参数只是为了兼容：手机上缓存的旧版本APP在"还没加入团队"页调用时
--    还会带上它。这个参数被完全忽略，传什么都改变不了"加入的是谁"。新前端只传
--    p_code。参数顺序换成(p_code, p_email default null)——PostgREST按参数名匹配，
--    新旧两种调用都能对上。
-- 4. 加入不切换当前团队（跟0007一样只加成员记录）。新用户只有这一个团队，
--    current_household_id()本来就会回落到它；已经有团队的人如果在这里直接改
--    household_active指针，会绕开前端"切换团队"的安全步骤（先确认同步队列清空、
--    清掉本地旧团队数据）——还没同步上去的旧团队数据会被按新团队推送、被RLS拒绝、
--    又切不回去，永远卡住。所以新加入的团队只出现在团队切换器里，由用户自己切。
-- 5. 邀请码生成改用pgcrypto的gen_random_bytes（密码学安全随机数）+拒绝采样。原来
--    的random()可以被预测，而且(random()*31)::int+1是四舍五入，首尾两个字符概率
--    只有一半，偶尔还会取到第32个位置（空字符，生成出9位码）。generate_invite_code
--    只在库内部用，不再对外开放执行权限。
--
-- 【安全性】只重写函数，不动表结构、不改现有数据。已经发出去的邀请码继续有效。
-- search_path设成空、所有对象写schema全名（理由同0038）。
--
-- 【注意：登录页邀请码现在依赖自助注册开关】
-- 以前是"登录前先加入、再发验证码"，发验证码时is_invited_email一定能查到这个邮箱。
-- 现在是"先发验证码、登录后再加入"，一个全新的受邀人能拿到验证码，靠的是
-- self_serve_signup_enabled()为true（目前一直是true）。以后如果把这个开关关掉，
-- 全新的受邀人就不能在登录页用邀请码了，只能走Google登录→"还没加入团队"页填码，
-- 或者走invite-team skill里的人工SQL。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 邀请码生成：密码学安全随机数
-- ---------------------------------------------------------------------
-- 字母表跟0007一样去掉容易看混的0/O、1/I/L，共31个字符。248 = 31×8，
-- 随机字节落在248～255时丢掉重抽，保证31个字符出现概率完全相等
create or replace function public.generate_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text := '';
  v_byte int;
begin
  while length(v_code) < 10 loop
    v_byte := get_byte(extensions.gen_random_bytes(1), 0);
    if v_byte < 248 then
      v_code := v_code || substr(v_alphabet, (v_byte % 31) + 1, 1);
    end if;
  end loop;
  return v_code;
end;
$$;

revoke execute on function public.generate_invite_code() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 用邀请码加入团队：只能加入"已登录的本人"
-- ---------------------------------------------------------------------
drop function if exists public.join_household_by_invite_code(text, text);

create function public.join_household_by_invite_code(p_code text, p_email text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_household_id uuid;
begin
  -- p_email故意不用，见文件头【怎么修】第3条
  select u.email into v_email
    from auth.users u
   where u.id = auth.uid()
     and u.email_confirmed_at is not null;

  if v_email is null or p_code is null then
    return false;
  end if;

  select h.id into v_household_id
    from public.household h
   where h.invite_code = upper(btrim(p_code));

  if v_household_id is null then
    return false;
  end if;

  insert into public.household_member (household_id, email)
  values (v_household_id, v_email)
  on conflict (household_id, email) do nothing;

  return true;
end;
$$;

comment on function public.join_household_by_invite_code(text, text) is
  '用邀请码把"当前登录的本人"加入对应团队（不切换当前团队）。只认auth.uid()在'
  'auth.users里已验证的邮箱，p_email参数只为兼容旧版APP保留、完全忽略。只返回'
  'true/false，不区分失败原因（没登录/码不对），避免被用来试探。匿名不可调用。';

revoke execute on function public.join_household_by_invite_code(text, text) from public, anon;
grant  execute on function public.join_household_by_invite_code(text, text) to authenticated;
