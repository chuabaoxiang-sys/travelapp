// 这个仓库需要鉴权的接口共用的鉴权逻辑：
//   - verifyLoggedIn：只验证请求带的Supabase登录token确实有效（"是不是一个已登录的
//     用户"）。给route-directions/resolve-link-preview/resolve-maps-link用——这几个
//     接口本身不碰任何团队数据，挡掉未登录请求是为了不让人拿它们刷第三方额度
//     （2026-10安全检查：之前谁都能直接调用，可以刷光OpenRouteService的免费额度）
//   - verifyHouseholdAccess：在此基础上再重新核对这个人是否真的属于客户端声称的那个
//     household——不信任客户端传来的householdId本身。给create-checkout-session用
//
// 用anon key + 用户自己的token建客户端，而不是service_role：household_member的RLS
// (email = auth.jwt() ->> 'email'，见0004迁移)本身就会把结果收窄到"这人名下的团队"，
// 不需要绕过RLS就能完成校验。返回的supabase客户端也带着同一个token，调用方
// 可以直接拿它去读其他RLS保护的表（比如household_subscription），不用再建一次。
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface HouseholdAuthOk {
  ok: true
  email: string
  supabase: SupabaseClient
}
export interface HouseholdAuthError {
  ok: false
  status: number
  error: string
}

export async function verifyLoggedIn(request: Request): Promise<HouseholdAuthOk | HouseholdAuthError> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return { ok: false, status: 500, error: 'Supabase 未配置' }
  }

  // 必须是"Bearer <token>"：只有一个"Bearer"（HTTP 会把结尾空格裁掉）或者没带前缀的
  // 都当成没登录，不把这种东西当 token 拿去问 Supabase
  const authHeader = request.headers.get('authorization') ?? ''
  const token = authHeader.match(/^Bearer\s+(\S+)\s*$/i)?.[1] ?? ''
  if (!token) {
    return { ok: false, status: 401, error: '未登录' }
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  const email = userData?.user?.email
  if (userError || !email) {
    return { ok: false, status: 401, error: '登录状态无效' }
  }

  return { ok: true, email, supabase }
}

export async function verifyHouseholdAccess(
  request: Request,
  householdId: unknown
): Promise<HouseholdAuthOk | HouseholdAuthError> {
  if (typeof householdId !== 'string' || !householdId) {
    return { ok: false, status: 400, error: '缺少 householdId' }
  }

  const auth = await verifyLoggedIn(request)
  if (!auth.ok) return auth
  const { email, supabase } = auth

  // 显式带上email条件是为了让意图更清楚，实际收窄靠的是household_member自己的RLS——
  // 即使漏写这个条件，也不可能查到别人名下的行
  const { data: memberRow, error: memberError } = await supabase
    .from('household_member')
    .select('household_id')
    .eq('household_id', householdId)
    .eq('email', email)
    .maybeSingle()
  if (memberError || !memberRow) {
    return { ok: false, status: 403, error: '你不属于这个团队' }
  }

  return { ok: true, email, supabase }
}
