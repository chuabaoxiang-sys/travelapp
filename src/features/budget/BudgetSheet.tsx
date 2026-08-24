import { X } from 'lucide-react'
import type { Trip } from '../../types'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { BudgetTab } from './BudgetTab'

// "管理预算"——预算不再是独立的tab，而是账目页大卡片下面的一个次级入口。
// 表单逻辑完全没动，还是原来的 BudgetTab，只是从"整页显示"换成了"弹层里显示"。
export function BudgetSheet({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  useEscapeKey(true, onClose)
  return (
    <div className="absolute inset-0 z-30 bg-ink/35" onClick={onClose}>
      <div className="absolute inset-0 flex flex-col justify-end px-2.5 pb-2.5 pointer-events-none">
        <div
          onClick={(e) => e.stopPropagation()}
          className="relative pointer-events-auto bg-paper rounded-[26px] pt-3.5 shadow-[0_-6px_28px_rgba(31,27,22,0.22)] max-h-[90%] flex flex-col overflow-hidden"
        >
          <div className="w-[38px] h-1 rounded-full bg-[#D8CFC0] mx-auto mb-1 flex-shrink-0" />
          <button onClick={onClose} className="absolute top-4 right-5 text-muted z-10" title="关闭">
            <X className="w-[18px] h-[18px]" strokeWidth={1.8} />
          </button>
          <div className="flex-1 min-h-0">
            <BudgetTab trip={trip} />
          </div>
        </div>
      </div>
    </div>
  )
}
