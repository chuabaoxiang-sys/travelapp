import { supabase } from '../api/supabaseClient'
import { isLocalTestModeEnabled } from '../dev/localTestMode'

// 当前登录者所属的团队ID——整个APP运行期间只查一次（登录状态不会频繁变化），
// 查过之后缓存在内存里，创建新记录时直接读这个值打进 householdId 字段
let cachedHouseholdId: string | null = null

// 没配置Supabase（本地没建 .env.local），或者在登录页手动开了本地测试模式
// （localTestMode.ts）时用的固定假团队ID——两种情况App.tsx都会跳过登录直接
// 放行，但创建成员/行程等操作都要求有householdId，如果这里还返回null会导致
// 这些操作静默抛错（界面上看起来像没反应）。纯本地场景不会真的同步到任何云端，
// 用哪个字符串都无所谓，固定一个方便辨认。
const LOCAL_TEST_HOUSEHOLD_ID = 'local-test-household'

// 未被邀请的邮箱专用错误——EmailLogin.tsx 靠这个类型区分"没被邀请"和其他发送失败，
// 分别展示不同的提示文案
export class NotInvitedError extends Error {}

export async function sendLoginCode(email: string): Promise<void> {
  if (!supabase) throw new Error('Cloud service isn\'t configured')
  const trimmed = email.trim()

  // 真正调用发送登录邮件之前，先问一句"这个邮箱在邀请名单里吗"——不在的话直接
  // 拦掉，不触发真实发信，防止陌生人在登录框里乱试邮箱耗尽发信额度（网站已经
  // 没有密码墙拦着，任何人都能打开登录页，这个检查是唯一的防线）。
  // 这个检查本身失败（比如网络问题）不应该挡住正常登录，交给下面 signInWithOtp
  // 自己的报错处理，所以只在明确查到 false 时才拦截
  const { data: invited, error: checkError } = await supabase.rpc('is_invited_email', { check_email: trimmed })
  if (!checkError && invited === false) {
    throw new NotInvitedError('这个邮箱还没被邀请')
  }

  // signInWithOtp 这个API名字虽然还留着"Otp"，但发的是链接还是验证码完全由
  // Supabase后台的邮件模板决定（模板里放{{ .Token }}就是验证码）——调用方式
  // 不用变，只是邮箱那头收到的形式变了
  const { error } = await supabase.auth.signInWithOtp({ email: trimmed })
  if (error) throw error
}

// 校验用户填的6位验证码——成功后Supabase客户端会自动建立session并触发
// App.tsx 里监听的 onAuthStateChange，不需要这里手动处理后续跳转
export async function verifyLoginCode(email: string, code: string): Promise<void> {
  if (!supabase) throw new Error('Cloud service isn\'t configured')
  const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
  if (error) throw error
}

export async function getSession() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session
}

export async function signOut() {
  if (!supabase) return
  await supabase.auth.signOut()
  cachedHouseholdId = null
}

// 查"我现在在哪个团队"。如果查不到（邮箱还没被邀请进任何团队），返回 null，
// 调用方要提示"此邮箱还没被邀请"。
//
// 【为什么必须问服务端，不能自己算】这个值会被打进新记录的 householdId 字段，而服务端
// RLS 的 `with check (household_id = current_household_id())` 会独立地判断一次。两边
// 不一致时写入会被静默拒绝，表现成"这条数据同步不上去"。
//
// 曾经这里是自己查 household_member 取"最早加入的那个团队"，和 0017 的规则对齐。
// 但 0018 给服务端加了"当前团队指针"（优先读指针、回落到最早加入），客户端这份
// 自己算的逻辑就再也追不上了——切换团队之后服务端认为你在B团队，客户端还以为在A团队。
// 所以改成直接读服务端的答案：list_my_households() 里的 is_active 就是
// current_household_id() 在服务端算出来的结果，没有第二套逻辑可以走偏。
export async function getCurrentHouseholdId(): Promise<string | null> {
  if (cachedHouseholdId) return cachedHouseholdId
  if (!supabase || isLocalTestModeEnabled()) return LOCAL_TEST_HOUSEHOLD_ID

  const teams = await listMyHouseholds()
  const active = teams.find((t) => t.isActive) ?? teams[0]
  if (active) {
    cachedHouseholdId = active.id
    return cachedHouseholdId
  }

  // 兜底：万一 list_my_households 这个 RPC 不可用（比如某个环境还没跑 0018 迁移），
  // 退回旧的查表方式。宁可选到"最早加入的团队"，也不要因为一个 RPC 缺失就让所有人
  // 都卡在"这个邮箱还没被邀请"进不去
  const { data, error } = await supabase
    .from('household_member')
    .select('household_id')
    .order('created_at', { ascending: true })
    .order('household_id', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  cachedHouseholdId = data.household_id
  return cachedHouseholdId
}

export function clearHouseholdCache() {
  cachedHouseholdId = null
}

export interface MyHousehold {
  id: string
  name: string
  isActive: boolean
}

// 我属于的所有团队（对应 list_my_households RPC，见 0018）。只返回自己的团队，
// 查不到别人的、也查不到总共有多少个团队。返回 1 条以下时界面不该显示切换入口。
export async function listMyHouseholds(): Promise<MyHousehold[]> {
  // 本地开发环境给两个假团队，否则切换入口在本地永远不显示（它只在属于2个以上
  // 团队时才渲染），这一屏就没法本地验证。双重限制在 DEV 构建 + 本地测试模式内，
  // 生产构建里这段不可能生效。真正的切换动作在这种模式下会失败（没有云端），
  // 弹层会正常显示失败提示——本地能验证的是布局和交互，不是切换本身
  if (import.meta.env.DEV && (!supabase || isLocalTestModeEnabled())) {
    return [
      { id: LOCAL_TEST_HOUSEHOLD_ID, name: '本地测试团队', isActive: true },
      { id: 'local-test-household-2', name: '另一个测试团队', isActive: false },
    ]
  }
  if (!supabase || isLocalTestModeEnabled()) return []
  const { data, error } = await supabase.rpc('list_my_households')
  if (error || !data) return []
  // RPC 的输出列刻意叫 team_id/team_name（不是 id/name），原因见 0018 里的注释
  return (data as { team_id: string; team_name: string; is_active: boolean }[]).map((r) => ({
    id: r.team_id,
    name: r.team_name,
    isActive: r.is_active,
  }))
}

// 把服务端的"当前团队"指针指向某个团队。数据库那边会先校验你确实属于它，
// 不属于会抛错。注意：调用这个之后本地数据还是旧团队的，必须接着走
// domain/teamSwitch.ts 里的完整流程，不要单独调用这个函数
export async function setActiveHousehold(householdId: string): Promise<void> {
  if (!supabase) throw new Error('Cloud service isn\'t configured')
  const { error } = await supabase.rpc('set_active_household', { p_household_id: householdId })
  if (error) throw error
}

// 拿当前团队的邀请码（第一次调用时数据库会懒生成）——给已登录成员看/复制，
// 分享给想邀请的家人朋友
export async function getHouseholdInviteCode(): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('get_household_invite_code')
  if (error) return null
  return data
}

// 邀请码泄露了，作废重新生成一个
export async function regenerateHouseholdInviteCode(): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('regenerate_household_invite_code')
  if (error) return null
  return data
}

// 未登录也能调用——用邀请码把邮箱加入对应团队。邀请码本身不区分大小写
// （数据库存的都是大写），这里统一转大写，方便对方直接复制粘贴或手打
export async function joinHouseholdByInviteCode(email: string, code: string): Promise<boolean> {
  if (!supabase) return false
  const { data, error } = await supabase.rpc('join_household_by_invite_code', {
    p_email: email.trim(),
    p_code: code.trim().toUpperCase(),
  })
  if (error) return false
  return data === true
}

// 自助创建一个全新团队（0022）——只在 self_serve_signup_enabled() 开关打开时数据库
// 才会真的成功，开关关闭时 RPC 会抛错，这里刻意不吞掉，把报错文案原样交给调用方
// 展示（跟上面几个"失败就返回 false/null"的函数不一样，因为这里的报错是给已登录
// 用户看的，不是"猜错了"这种可以用布尔值表达的情况）。
// 数据库那边的 create_household 已经在同一个事务里调用了 set_active_household，
// 这里不需要再调一次。
export async function createHousehold(name: string): Promise<string> {
  if (!supabase) throw new Error('Cloud service isn\'t configured')
  const { data, error } = await supabase.rpc('create_household', { p_name: name.trim() })
  if (error) throw error
  clearHouseholdCache()
  return data as string
}
