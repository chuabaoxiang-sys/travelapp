import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check } from 'lucide-react'
import type { RateBookEntry } from '../../types'

// 汇率名字重名时贴在名字输入框下面的提示（判断规则见 domain/rates.ts 的
// findRateLabelConflict）。记账页传 onUse，可以一键改用那条已有的汇率；
// 已归档的那条在记账页本来就不显示，不给"用它"按钮，只提示换名字
export function RateLabelConflictNote({ conflict, onUse }: { conflict: RateBookEntry; onUse?: () => void }) {
  const { t } = useTranslation()
  const canUse = !!onUse && !conflict.archived
  const messageKey = conflict.archived ? 'rateLabel.takenArchived' : canUse ? 'rateLabel.takenOrUse' : 'rateLabel.taken'
  return (
    <div className="flex flex-col gap-1.5 mt-1.5">
      <div className="text-[11px] text-negative leading-snug flex gap-1">
        <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" strokeWidth={2.2} />
        <span>{t(messageKey, { label: conflict.label, currency: conflict.foreignCurrency })}</span>
      </div>
      {canUse && (
        <button
          type="button"
          onClick={onUse}
          className="self-start rounded-full border border-plan text-plan px-2.5 py-1 text-[11.5px] font-semibold tabular flex items-center gap-1"
        >
          <Check className="w-3 h-3" strokeWidth={2.4} />
          {t('rateLabel.use', { label: conflict.label, rate: conflict.rate })}
        </button>
      )}
    </div>
  )
}
