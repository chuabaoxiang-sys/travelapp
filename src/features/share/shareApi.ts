import { supabase } from '../../api/supabaseClient'
import type { SharedTripData } from '../../types'

// 分享页是唯一一处完全不需要登录就能访问的页面——直接用 anon key 调用
// get_shared_trip 这个数据库函数（见 supabase/migrations/0006_public_share.sql），
// 不经过本地 Dexie，也不需要当前用户属于哪个 household
export async function fetchSharedTrip(token: string): Promise<SharedTripData | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('get_shared_trip', { p_token: token })
  if (error || !data) return null
  return data as SharedTripData
}
