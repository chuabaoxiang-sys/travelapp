import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Check } from 'lucide-react'

// 记一次真实换汇的"给出/换到"金额，任一变化时自动算好汇率（仍可手动改）。
// 给 RateBookScreen 的新增入口和 RateChipRow 的"新汇率"内联表单共用，避免同样的
// 自动算汇率逻辑写两遍。默认收起——不干扰原来"只填标签+汇率"的极简用法
export function ExchangeAmountFields({
  homeCurrency,
  foreignCurrency,
  homeAmount,
  foreignAmount,
  onChangeHomeAmount,
  onChangeForeignAmount,
}: {
  homeCurrency: string
  foreignCurrency: string
  homeAmount: string
  foreignAmount: string
  onChangeHomeAmount: (v: string) => void
  onChangeForeignAmount: (v: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(!!(homeAmount || foreignAmount))
  const homeNum = parseFloat(homeAmount)
  const foreignNum = parseFloat(foreignAmount)
  const hasBoth = homeNum > 0 && foreignNum > 0

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[12px] font-semibold text-plan py-1"
      >
        <ChevronRight className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} strokeWidth={2.5} />
        {t('exchangeFields.toggle')}
      </button>
      {open && (
        <div className="bg-paper rounded-xl p-2.5 flex flex-col gap-2 mb-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <div className="text-[10px] tracking-widest uppercase text-muted mb-1">{t('exchangeFields.gave', { currency: homeCurrency })}</div>
              <input
                value={homeAmount}
                onChange={(e) => onChangeHomeAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm tabular outline-none focus:border-plan"
              />
            </div>
            <div className="flex-1">
              <div className="text-[10px] tracking-widest uppercase text-muted mb-1">{t('exchangeFields.got', { currency: foreignCurrency })}</div>
              <input
                value={foreignAmount}
                onChange={(e) => onChangeForeignAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm tabular outline-none focus:border-plan"
              />
            </div>
          </div>
          {hasBoth && (
            <div className="text-[11px] text-positive flex items-center gap-1">
              <Check className="w-3 h-3 flex-shrink-0" strokeWidth={2.5} />
              {t('exchangeFields.autoComputed')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
