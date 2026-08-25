import { useEffect, useRef, useState } from 'react'
import { easeOutCubic } from '../lib/easing'

// 数字变化时不硬切，而是先快后慢地滚到新值——目前用在记账页顶部那个大数字
// （SpendHero/LedgerTab）上，不是全局通用规则，别处的数字暂时保持瞬间跳变。
//
// 起点用displayRef（当前正显示的插值），不是"上一次动画完整跑完的目标值"：
// 如果数字在动画播放到一半时又变了（比如手快连着记了两笔），会从当前视觉
// 位置顺着接着滚到新终点，不会先跳回上一个终点再重新滚一遍。
//
// 组件挂载瞬间也会动画：这个数字来自useLiveQuery，第一次拿到的往往是还没
// 查完的默认值（比如空数组算出来的0），真实值紧接着才会到——之前特意跳过
// 这段"从0变成真实值"的过渡，怕每次打开页面数字都从0数上来显得多余；后来
// 明确要的就是这个效果（每次点进记账页，数字滚一遍是想要的"翻牌"感），
// 所以现在挂载后的变化跟其他变化一视同仁，照样滚动
export function useAnimatedNumber(value: number, duration = 480) {
  const [display, setDisplay] = useState(value)
  const displayRef = useRef(value)

  useEffect(() => {
    const from = displayRef.current
    const to = value
    if (Math.abs(to - from) < 0.005) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      setDisplay(to)
      displayRef.current = to
      return
    }

    let raf = 0
    const start = performance.now()
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration)
      const next = from + (to - from) * easeOutCubic(t)
      displayRef.current = next
      setDisplay(next)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])

  return display
}
