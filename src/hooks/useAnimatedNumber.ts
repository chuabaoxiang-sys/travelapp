import { useEffect, useRef, useState } from 'react'
import { easeOutCubic } from '../lib/easing'

// 数字变化时不硬切，而是先快后慢地滚到新值——目前只用在记账页顶部那个
// "唯一一个每记一笔就会变的大数字"（SpendHero）上，不是全局通用规则，
// 别处的数字暂时保持瞬间跳变。
//
// 起点用displayRef（当前正显示的插值），不是"上一次动画完整跑完的目标值"：
// 如果数字在动画播放到一半时又变了（比如手快连着记了两笔），会从当前视觉
// 位置顺着接着滚到新终点，不会先跳回上一个终点再重新滚一遍。
//
// MOUNT_GRACE_MS：这个组件的数字来自useLiveQuery，挂载瞬间拿到的往往是
// 还没查完的默认值（比如空数组算出来的0），真实值紧接着才会到——如果这个
// "从0变成真实值"的过程也被当成正常变化去滚动，效果就是每次打开这个页面
// 数字都会从0数上来，而不是想要的"记账那一刻才滚"。挂载后这段时间内的变化
// 直接跳过去，之后的变化才当作真的数值变动来滚动
const MOUNT_GRACE_MS = 300

export function useAnimatedNumber(value: number, duration = 480) {
  const [display, setDisplay] = useState(value)
  const displayRef = useRef(value)
  const mountedAtRef = useRef<number | null>(null)

  useEffect(() => {
    mountedAtRef.current = performance.now()
  }, [])

  useEffect(() => {
    const from = displayRef.current
    const to = value
    if (Math.abs(to - from) < 0.005) return

    const justMounted = mountedAtRef.current === null || performance.now() - mountedAtRef.current < MOUNT_GRACE_MS
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (justMounted || reducedMotion) {
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
