import type { ReactNode } from 'react'
import { useEscapeKey } from '../hooks/useEscapeKey'

// 居中弹层的通用外壳（背景遮罩 + 点击遮罩关闭 + 内容区域阻止冒泡 + 卡片容器）——
// ConfirmDialog 和 RateBookScreen 的"另存为新标签"弹层原来是各自复制一份完全一样的
// markup，这里抽成一个共用组件，以后新增类似的居中弹层也不用再复制一遍
export function CenteredModal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEscapeKey(true, onClose)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-scrim/45" />
      <div onClick={(e) => e.stopPropagation()} className="relative bg-card rounded-2xl p-5 w-full max-w-[300px] shadow-2xl">
        {children}
      </div>
    </div>
  )
}
