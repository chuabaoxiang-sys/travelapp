import { type ReactNode } from 'react'

// 8个底部弹层之前各自复制了一份"遮罩+浮动卡片"外壳，抽成共用组件，顺便
// 统一接上开启动效（见 index.css 的 .sheet-enter）。cardClassName 留给
// 调用方控制卡片内部的padding/滚动/flex布局——这部分两种弹层长得不一样
// （大多数是整卡片overflow-y-auto，BudgetSheet/AddExpensePage是flex-col
// 内部单独滚动，为了留出固定底部按钮），没有统一成一种形状的必要
export function BottomSheet({
  onClose,
  children,
  cardClassName = '',
}: {
  onClose: () => void
  children: ReactNode
  cardClassName?: string
}) {
  return (
    <div className="absolute inset-0 z-30 bg-scrim/35" onClick={onClose}>
      <div className="absolute inset-0 flex flex-col justify-end px-2.5 pb-2.5 pointer-events-none">
        <div
          onClick={(e) => e.stopPropagation()}
          className={`sheet-enter pointer-events-auto bg-paper rounded-[26px] shadow-[0_-6px_28px_rgba(31,27,22,0.22)] ${cardClassName}`}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
