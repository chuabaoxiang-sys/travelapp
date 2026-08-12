import { X } from 'lucide-react'

export function ConfirmDialog({
  title,
  message,
  confirmLabel = '删除',
  danger = true,
  onConfirm,
  onCancel,
}: {
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onCancel}>
      <div className="absolute inset-0 bg-ink/45" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-card rounded-2xl p-5 w-full max-w-[300px] shadow-2xl"
      >
        <div className="font-serif-sc text-[15px] text-ink">{title}</div>
        {message && <div className="text-[12.5px] text-muted mt-2 leading-relaxed">{message}</div>}
        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} className="flex-1 rounded-xl border border-line py-2 text-muted flex items-center justify-center" title="取消">
            <X className="w-4 h-4" strokeWidth={1.8} />
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 rounded-xl py-2 text-sm font-medium ${
              danger ? 'bg-negative text-card' : 'bg-plan text-card'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
