import { useEffect, type ReactNode } from 'react'

// 8个底部弹层之前各自复制了一份"遮罩+浮动卡片"外壳，抽成共用组件。
// cardClassName 留给调用方控制卡片内部的padding/滚动/flex布局——这部分
// 两种弹层长得不一样（大多数是整卡片overflow-y-auto，BudgetSheet/
// AddExpensePage是flex-col内部单独滚动，为了留出固定底部按钮），没有
// 统一成一种形状的必要
//
// 曾经加过一版开启动效（.sheet-enter，2026-08-25），后来发现所有弹层弹出
// 时都有真机卡顿，will-change和"关掉导航栏模糊"两轮排查都没能确认解决，
// 关闭动效又会牵出返回键那条路径动效对不上的新问题——干脆把开启动效也
// 撤掉，弹层恢复瞬间出现/消失，不再为了动效去猜卡顿病因

// 底部导航栏(BottomNav)自带backdrop-blur，且不会因为弹层开着就卸载——
// 弹层从下往上滑正好经过导航栏那片区域，安卓上backdrop-filter实时合成的
// 开销很大，被怀疑是"所有弹层弹出时都卡顿"的真正病因（比"卡片没提前建层"
// 更吻合"will-change加了也还是卡"这个现象）。用一个模块级计数器而不是
// 布尔值——弹层可能嵌套（比如更多面板里再弹出反馈面板），单纯的布尔值在
// 内层关闭时会错误地把外层还开着的导航栏模糊也提前打开
let openSheetCount = 0
function markSheetOpen() {
  openSheetCount += 1
  document.documentElement.classList.add('sheet-open')
}
function markSheetClosed() {
  openSheetCount = Math.max(0, openSheetCount - 1)
  if (openSheetCount === 0) document.documentElement.classList.remove('sheet-open')
}

export function BottomSheet({
  onClose,
  children,
  cardClassName = '',
}: {
  onClose: () => void
  children: ReactNode
  cardClassName?: string
}) {
  useEffect(() => {
    markSheetOpen()
    return markSheetClosed
  }, [])

  return (
    <div className="absolute inset-0 z-30 bg-scrim/35" onClick={onClose}>
      <div className="absolute inset-0 flex flex-col justify-end px-2.5 pb-2.5 pointer-events-none">
        <div
          onClick={(e) => e.stopPropagation()}
          className={`pointer-events-auto bg-paper rounded-[26px] shadow-[0_-6px_28px_rgba(31,27,22,0.22)] ${cardClassName}`}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
