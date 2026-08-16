const KEY = 'trip-journal:local-test-mode'

// 让开发者在登录页跳过邮箱登录、直接进本地测试数据——不用改 .env.local、不碰
// Supabase配置，纯粹是一个本地localStorage开关。isLocalTestModeEnabled()额外
// 判断了 import.meta.env.DEV，生产构建里这个值恒为false，这个开关形同虚设，
// 不会给真实用户开一道后门
export function isLocalTestModeEnabled(): boolean {
  return import.meta.env.DEV && localStorage.getItem(KEY) === 'true'
}

export function enableLocalTestMode() {
  localStorage.setItem(KEY, 'true')
}

export function disableLocalTestMode() {
  localStorage.removeItem(KEY)
}
