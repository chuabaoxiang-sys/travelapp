import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// url/anonKey 可能没配置（比如还没接云端同步的开发环境）——这种情况下同步功能
// 应该整体不工作，而不是让整个APP崩溃，所以 supabase 允许是 null，调用方要判空
export const supabase = url && anonKey ? createClient(url, anonKey) : null
