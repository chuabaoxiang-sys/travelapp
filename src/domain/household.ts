import { supabase } from '../api/supabaseClient'

// 当前登录者所属的团队ID——整个APP运行期间只查一次（登录状态不会频繁变化），
// 查过之后缓存在内存里，创建新记录时直接读这个值打进 householdId 字段
let cachedHouseholdId: string | null = null

export async function sendLoginLink(email: string): Promise<void> {
  if (!supabase) throw new Error('云端服务未配置')
  const { error } = await supabase.auth.signInWithOtp({ email: email.trim() })
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

// 查"当前登录邮箱属于哪个团队"——对应 household_member 表，RLS 只放行查自己那一条。
// 如果查不到（邮箱还没被邀请进任何团队），返回 null，调用方要提示"此邮箱还没被邀请"
export async function getCurrentHouseholdId(): Promise<string | null> {
  if (cachedHouseholdId) return cachedHouseholdId
  if (!supabase) return null
  const { data, error } = await supabase.from('household_member').select('household_id').limit(1).maybeSingle()
  if (error || !data) return null
  cachedHouseholdId = data.household_id
  return cachedHouseholdId
}

export function clearHouseholdCache() {
  cachedHouseholdId = null
}
