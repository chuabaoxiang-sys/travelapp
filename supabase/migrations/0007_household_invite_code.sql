-- =====================================================================
-- 0007_household_invite_code.sql
-- 团队邀请码：现有成员想邀请家人/朋友加入自己的团队，不用再让管理员手动在
-- Supabase后台跑SQL——生成一个邀请码，对方在APP登录页输入邮箱+邀请码就能
-- 自助加入。
--
-- 【和0004文档里"不用团队共享邀请码"的初衷是否冲突】0004的注释明确写过当时
-- 选邮箱验证登录而不是共享邀请码，理由是"共享码泄露了防不住、也没法单独收回
-- 某一个人的权限"。这次是产品层面接受这个权衡：邀请码是静态的，泄露了靠
-- "重新生成"让旧码失效（做不到只收回其中一个人），换来不用每次都找开发者
-- 手动跑SQL的自助能力。这不会让整体安全性变得比现在更差——现在的流程本来就是
-- "管理员觉得这个邮箱可信就直接加"，零验证；邀请码只是把这份信任转移给"知道
-- 邀请码的人"。真正的数据保护边界始终是household级别的RLS，不受这次改动影响。
-- =====================================================================

alter table household add column invite_code text unique;

comment on column household.invite_code is
  '静态邀请码，现有成员邀请新人加入本团队用。首次调用 get_household_invite_code() '
  '时才会生成（懒生成），泄露后可以调用 regenerate_household_invite_code() 作废重来。';

-- 10位随机字符，字母表刻意去掉容易看混的字符(0/O、1/I/L)，方便口头转述/手打。
-- 31个字符的10次方组合数够大，光靠网络请求暴力枚举不现实
create or replace function generate_invite_code()
returns text
language sql
volatile
as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (random() * 31)::int + 1, 1), '')
  from generate_series(1, 10)
$$;

-- 已登录成员拿自己团队的邀请码——没有就现场生成一个（懒生成，不用在建团队时
-- 就预先分配，大部分团队可能永远用不到这个功能）
create or replace function get_household_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_code text;
begin
  v_household_id := current_household_id();
  if v_household_id is null then
    return null;
  end if;

  select invite_code into v_code from household where id = v_household_id;

  if v_code is null then
    loop
      v_code := generate_invite_code();
      begin
        update household set invite_code = v_code where id = v_household_id;
        exit;
      exception when unique_violation then
        -- 极小概率撞码，换一个再试
      end;
    end loop;
  end if;

  return v_code;
end;
$$;

comment on function get_household_invite_code() is
  '拿当前登录者所属团队的邀请码，第一次调用时懒生成。security definer原因同'
  'current_household_id()——调用者本身的RLS权限查不到/改不了household表。';

grant execute on function get_household_invite_code() to authenticated;

-- 邀请码泄露了，作废重新生成一个——旧码立刻失效
create or replace function regenerate_household_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_code text;
begin
  v_household_id := current_household_id();
  if v_household_id is null then
    return null;
  end if;

  loop
    v_code := generate_invite_code();
    begin
      update household set invite_code = v_code where id = v_household_id;
      exit;
    exception when unique_violation then
    end;
  end loop;

  return v_code;
end;
$$;

comment on function regenerate_household_invite_code() is
  '作废当前团队的邀请码，重新生成一个新的并返回。';

grant execute on function regenerate_household_invite_code() to authenticated;

-- 用邀请码加入团队——这是唯一一个允许匿名(未登录)调用的写入函数，因为这一步
-- 本来就发生在对方还没有账号/session之前。只返回布尔值，不区分"邀请码错"还是
-- "这个邮箱已经在团队里了"，避免被用来试探信息。email已经在团队里时用
-- on conflict do nothing保持幂等，不会报错也不会插出重复行
create or replace function join_household_by_invite_code(p_email text, p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
begin
  select id into v_household_id from household where invite_code = p_code;

  if v_household_id is null then
    return false;
  end if;

  insert into household_member (household_id, email)
  values (v_household_id, p_email)
  on conflict (household_id, email) do nothing;

  return true;
end;
$$;

comment on function join_household_by_invite_code(text, text) is
  '未登录也能调用——用邀请码把邮箱加入对应团队的household_member。只返回'
  'true/false，不暴露邀请码错误的具体原因（是码不对还是已经是成员），避免'
  '被用来试探团队信息。';

grant execute on function join_household_by_invite_code(text, text) to anon;
grant execute on function join_household_by_invite_code(text, text) to authenticated;
