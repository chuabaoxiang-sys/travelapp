import { useEffect } from 'react'

// 给弹层/下拉加"按Escape关闭"——所有 Modal/Sheet/下拉选择器共用这一个 hook，
// 而不是各自实现一遍，保证以后要统一调整关闭行为时只用改一个地方
export function useEscapeKey(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onEscape()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [active, onEscape])
}
