import { useTranslation } from 'react-i18next'
import { Info, Check } from 'lucide-react'
import type { RateBookEntry } from '../../types'

// 记账页新汇率的名字跟一条还在用的汇率同名时，贴在名字输入框下面的提示（判断规则
// 见 domain/rates.ts 的 findRateWithSameName）。同名是允许的，所以只是灰字提醒、
// 不拦保存；"用它"按钮一键改用那条已有的汇率
export function RateSameNameNote({ entry, onUse }: { entry: RateBookEntry; onUse: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1.5 mt-1.5">
      <div className="text-[11px] text-muted leading-snug flex gap-1">
        <Info className="w-3 h-3 flex-shrink-0 mt-0.5" strokeWidth={2.2} />
        <span>{t('rateLabel.sameName', { label: entry.label, rate: entry.rate })}</span>
      </div>
      <button
        type="button"
        onClick={onUse}
        className="self-start rounded-full border border-plan text-plan px-2.5 py-1 text-[11.5px] font-semibold tabular flex items-center gap-1"
      >
        <Check className="w-3 h-3" strokeWidth={2.4} />
        {t('rateLabel.use', { label: entry.label, rate: entry.rate })}
      </button>
    </div>
  )
}
