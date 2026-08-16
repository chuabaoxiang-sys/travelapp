// __APP_COMMIT__/__APP_BUILD_TIME__ 是 vite.config.ts 在构建时用 define 注入的
// 全局常量（取自 git commit短SHA + 构建时刻），不是运行时能改变的普通变量
export const APP_COMMIT = __APP_COMMIT__
export const APP_BUILD_TIME = __APP_BUILD_TIME__

// 给人看的版本标签，比如"82df227 · 2026-08-16 17:32"
export function formatAppVersion(): string {
  const d = new Date(APP_BUILD_TIME)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${APP_COMMIT} · ${y}-${m}-${day} ${hh}:${mm}`
}
