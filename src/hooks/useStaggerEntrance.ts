import { useEffect, useState } from 'react'

// 页面/卡片挂载时"淡入+上移，逐项错开"的进场动效——原来在RetrospectiveContent、
// OverviewTab的BeforeTrip/DuringTrip里各抄了一份完全一样的双重rAF+计数器，
// 这里收成一个hook，纯粹去重，动效本身还是CSS transition，视觉不变。
//
// 双重RAF是必须的：这几个tab都是条件渲染，每次切回来都是重新mount，
// 挂载瞬间就要让数字/占比条已经是"隐藏"状态渲染出第一帧，下一帧再翻转成
// entered=true，CSS transition才有从"隐藏"到"显示"这段过程可以过渡——
// 单次rAF会跟首次渲染挤在同一帧，等于没有起点。
export function useStaggerEntrance(step = 90) {
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    let raf1 = 0
    let raf2 = 0
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntered(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [])

  // 每次渲染重置——对应原来几处组件里手写的 `let step = 0`，靠JSX里调用
  // nextDelayMs()的先后顺序给"渲染出来的第几块"错开时间，跳过没渲染的块。
  let counter = 0
  function nextDelayMs() {
    return counter++ * step
  }

  function delayStyle(ms: number) {
    return { transitionDelay: `${ms}ms` }
  }

  function enterClass(extra = '') {
    const base = `transition-[opacity,transform] duration-300 ease-out ${entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}`
    return extra ? `${extra} ${base}` : base
  }

  return { entered, enterClass, nextDelayMs, delayStyle }
}
