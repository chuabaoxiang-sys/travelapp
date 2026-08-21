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
  if (!supabase) throw new Error('云端服务未配置')
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
  if (!supabase) throw new Error('云端服务未配置')
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

// 查"当前登录邮箱属于哪个团队"——对应 household_member 表，RLS 只放行查自己那些行。
// 如果查不到（邮箱还没被邀请进任何团队），返回 null，调用方要提示"此邮箱还没被邀请"
//
// 【排序必须和数据库端保持完全一致】household_member 允许一个邮箱属于多个团队
// （复合主键 (household_id, email)，0004 刻意的设计）。这里挑出来的团队ID会被打进
// 新记录的 householdId 字段，而服务端 RLS 用 current_household_id() 独立地再挑一次
// 校验 `with check`。两边如果挑到不同的团队，写入会被静默拒绝、表现成"这条数据同步
// 不上去"。所以两边都按 (created_at, household_id) 排序——改这里就必须同步改
// supabase/migrations/0017_deterministic_current_household.sql 里的那个函数。
export async function getCurrentHouseholdId(): Promise<string | null> {
  if (cachedHouseholdId) return cachedHouseholdId
  if (!supabase || isLocalTestModeEnabled()) return LOCAL_TEST_HOUSEHOLD_ID
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
