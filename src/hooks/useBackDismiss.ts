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
//
// 真正嵌套两层的场景（教程库首页+详情页那种"外层开关"和"内层切换"同时是true）
// 之前踩过坑：如果两层各自独立 addEventListener('popstate', ...)，同一次系统
// 返回键触发的popstate会被两个监听器同时收到，内层"退回上一级"这个动作会被外层
// 误判成"用户按了返回"，整层弹层跟着一起关掉——2026-09-08 TutorialLibraryScreen
// 就是因为这个坑，选择了"内层不接管返回键、只能点画面上的返回箭头"这个退让方案。
// 这里改成全局只装一个popstate监听器、维护一个共享栈，每次popstate只弹出并处理
// 栈顶那一个——不管嵌套几层，一次返回键只关掉最内层那一个，这样"内层不敢接返回键"
// 这个限制就不需要了
interface DismissEntry {
  onDismiss: () => void
}
const dismissStack: DismissEntry[] = []
// 弹层自己点击关闭时，cleanup里会调用history.back()把刚才push的那条历史记录
// 消费掉——这本身也会触发一次popstate，但这次不是用户按返回键，不该让共享监听器
// 去弹栈处理（这个条目已经在splice时自己从栈里摘掉了，此时栈顶是别的弹层，
// 会被错误地关掉）。用这个标记跳过"自己制造"的这一次popstate
let suppressNextPopstate = false
let listenerInstalled = false

function ensureGlobalListener() {
  if (listenerInstalled) return
  listenerInstalled = true
  window.addEventListener('popstate', () => {
    if (suppressNextPopstate) {
      suppressNextPopstate = false
      return
    }
    const top = dismissStack.pop()
    top?.onDismiss()
  })
}

export function useBackDismiss(active: boolean, onDismiss: () => void) {
  const dismissedByBack = useRef(false)
  // 回调放进 ref、effect 只依赖 active：调用方几乎肯定会传一个内联箭头函数
  // （`() => setXOpen(false)`），每次渲染都是新的函数引用。如果把它放进依赖数组，
  // 每次重渲染都会触发一轮 cleanup+setup，也就是 history.back() 紧接着 pushState，
  // 把用户的历史记录搅乱。这里只有"开/关"这个状态变化才应该动历史
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss
  const entryRef = useRef<DismissEntry | null>(null)

  useEffect(() => {
    if (!active) return
    ensureGlobalListener()
    dismissedByBack.current = false
    const entry: DismissEntry = {
      onDismiss: () => {
        dismissedByBack.current = true
        onDismissRef.current()
      },
    }
    entryRef.current = entry
    dismissStack.push(entry)
    window.history.pushState({ sheet: true }, '')

    return () => {
      // 正常情况下自己应该在栈顶（最后push的先被popstate弹出/自己先关闭）。
      // 用indexOf+splice而不是假设一定在末尾，是为了防御万一的异常关闭顺序
      // （比如上层被程序化关闭时连带把这层也卸载了），不留下野指针
      const idx = dismissStack.indexOf(entry)
      if (idx !== -1) dismissStack.splice(idx, 1)
      // 用户是自己点关闭/保存关掉的，那条 pushState 还留在历史里，回收掉它。
      // 如果是返回键触发的，浏览器已经把它弹掉了，再调 back() 会多退一步跑出APP
      if (!dismissedByBack.current) {
        suppressNextPopstate = true
        window.history.back()
      }
    }
  }, [active])
}
