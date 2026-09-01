import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { CenteredModal } from './CenteredModal'

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
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
  const { t } = useTranslation()
  return (
    <CenteredModal onClose={onCancel}>
      <div className="font-serif-sc text-[15px] text-ink">{title}</div>
      {message && <div className="text-[12.5px] text-muted mt-2 leading-relaxed">{message}</div>}
      <div className="flex gap-2 mt-4">
        <button onClick={onCancel} className="flex-1 rounded-xl border border-line py-2 text-muted flex items-center justify-center" title={t('common.cancel')}>
          <X className="w-4 h-4" strokeWidth={1.8} />
        </button>
        <button
          onClick={onConfirm}
          className={`flex-1 rounded-xl py-2 text-sm font-medium ${
            danger ? 'bg-negative text-card' : 'bg-plan text-card'
          }`}
        >
          {confirmLabel ?? t('common.delete')}
        </button>
      </div>
    </CenteredModal>
  )
}
