import { useEffect, useRef } from 'react'

// 给弹层加"按安卓返回键关闭"——和 useEscapeKey 是同一类东西（键盘的Escape对应
// 手机的返回键），所以放在一起、用同样的调用形状。
//
// 为什么需要这个：装成PWA之后没有浏览器的返回按钮，安卓的系统返回键是用户唯一的
// "退一步"手势。而这个APP整个是单页面、没有为弹层做任何历史记录，所以打开一个
// bottom sheet 之后按返回键会**直接退出整个APP**——这是体感上最不像原生APP的一处。
//
// 做法：弹层打开时往历史里推一条状态，返回键触发 popstate 时关闭弹层而不是退出。
// 关闭要区分是"用户按了返回"还是"用户点了关闭按钮"：后者要顺手把刚才推进去的那条
// 历史消费掉（history.back()），否则历史里会堆一堆废状态，用户得连按好几次返回键
// 才能真正退出。用 ref 记住"这次卸载是不是由 popstate 引起的"来区分这两条路径。
export function useBackDismiss(active: boolean, onDismiss: () => void) {
  const dismissedByBack = useRef(false)
  // 回调放进 ref、effect 只依赖 active：调用方几乎肯定会传一个内联箭头函数
  // （`() => setXOpen(false)`），每次渲染都是新的函数引用。如果把它放进依赖数组，
  // 每次重渲染都会触发一轮 cleanup+setup，也就是 history.back() 紧接着 pushState，
  // 把用户的历史记录搅乱。这里只有"开/关"这个状态变化才应该动历史
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  useEffect(() => {
    if (!active) return
    dismissedByBack.current = false
    window.history.pushState({ sheet: true }, '')

    function onPopState() {
      dismissedByBack.current = true
      onDismissRef.current()
    }
    window.addEventListener('popstate', onPopState)

    return () => {
      window.removeEventListener('popstate', onPopState)
      // 用户是自己点关闭/保存关掉的，那条 pushState 还留在历史里，回收掉它。
      // 如果是返回键触发的，浏览器已经把它弹掉了，再调 back() 会多退一步跑出APP
      if (!dismissedByBack.current) window.history.back()
    }
  }, [active])
}
