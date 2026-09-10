import { useEffect, useRef, useState } from 'react'

// 盖章落章动效的计时逻辑——三处地方（翻卡回顾、账目页盖章、心情曲线改评分）
// 现在共用同一套时间轴：选完之后先播动效，播完（COMMIT_DELAY_MS）才真正提交，
// 提交完立刻清掉动效状态。原来只有翻卡回顾一处实现，这次账目/改评分两处也要
// 接上同一效果，抽成一个hook避免第三次抄一份一模一样的setTimeout。
// 具体视觉（.stamp-jolt/.stamp-slam/.stamp-ripple）在index.css，这里只管时机。
const JOLT_START_MS = 260
const JOLT_DURATION_MS = 500
export const STAMP_COMMIT_DELAY_MS = 1050

export function useStampSlam<T>(commit: (value: T) => void) {
  const [animating, setAnimating] = useState<T | null>(null)
  const [jolt, setJolt] = useState(false)
  // 用ref记住动效开始那一刻选的是哪个值，不依赖动效播放期间外部状态有没有变——
  // 跟SatisfactionFlipDeck原来的animatingDayIdRef是同一个考虑
  const pendingRef = useRef<T | null>(null)

  function trigger(value: T) {
    if (animating !== null) return
    pendingRef.current = value
    setAnimating(value)
  }

  useEffect(() => {
    if (animating === null) return
    const value = pendingRef.current
    const joltOnTimer = setTimeout(() => setJolt(true), JOLT_START_MS)
    const joltOffTimer = setTimeout(() => setJolt(false), JOLT_START_MS + JOLT_DURATION_MS)
    const commitTimer = setTimeout(() => {
      if (value !== null) commit(value)
      setAnimating(null)
    }, STAMP_COMMIT_DELAY_MS)
    return () => {
      clearTimeout(joltOnTimer)
      clearTimeout(joltOffTimer)
      clearTimeout(commitTimer)
    }
    // 故意不把commit放进依赖——调用方大多是每次渲染都重新生成的内联函数，
    // 放进去会导致这个effect每次渲染都重跑，把还在播的计时器提前打断重开
  }, [animating])

  return { animating, jolt, trigger }
}
