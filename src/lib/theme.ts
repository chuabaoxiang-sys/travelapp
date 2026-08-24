import { useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'

const THEME_KEY = 'trip-journal:theme'

// "跟随系统"不需要写 data-theme——不写就是交给 index.css 里的
// prefers-color-scheme 媒体查询去判断，跟手动选浅色/深色是两条不冲突的路径
function applyTheme(pref: ThemePreference) {
  if (pref === 'system') {
    delete document.documentElement.dataset.theme
  } else {
    document.documentElement.dataset.theme = pref
  }
}

function readStoredTheme(): ThemePreference {
  const v = localStorage.getItem(THEME_KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

// index.html 里的内联脚本已经在首次绘制前应用过一次（避免闪烁），这个hook负责
// "之后"的部分：读初始值供UI高亮当前选项，以及用户在"更多"面板点选时更新+持久化
export function useThemePreference() {
  const [pref, setPref] = useState<ThemePreference>(readStoredTheme)

  useEffect(() => {
    applyTheme(pref)
  }, [pref])

  function setPreference(next: ThemePreference) {
    if (next === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, next)
    setPref(next)
  }

  return [pref, setPreference] as const
}
