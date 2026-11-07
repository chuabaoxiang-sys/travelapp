import { useTranslation } from 'react-i18next'
import { X, Banknote, CreditCard, RotateCcw, Check } from 'lucide-react'
import { BottomSheet } from '../../components/BottomSheet'
import { categoryLabel } from '../../lib/categoryLabel'
import { categoryColor } from '../../lib/categoryColors'
import { PAY_CASH, PAY_PENDING, type LedgerFilter } from '../../domain/ledgerFilter'
import type { ExpenseCategory, PaymentCard } from '../../types'

// 账目筛选面板（2026-11-07）：选了就立刻生效（背后的列表跟着变），底部按钮只是
// 关掉面板、顺便告诉你现在筛出几笔——不用先选好再"应用"，少一步
export function LedgerFilterSheet({
  categories,
  cards,
  hasCash,
  hasPending,
  value,
  onChange,
  matchCount,
  onClose,
}: {
  categories: ExpenseCategory[] // 只给这趟真的记过账的分类
  cards: PaymentCard[] // 只给这趟真的刷过的卡
  hasCash: boolean
  hasPending: boolean
  value: LedgerFilter
  onChange: (f: LedgerFilter) => void
  matchCount: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const toggle = (key: keyof LedgerFilter, id: string) => {
    const cur = value[key]
    onChange({ ...value, [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
  }
  const chipClass = (on: boolean) =>
    `flex items-center gap-1.5 text-[12.5px] ${on ? 'border-[1.5px] border-plan bg-plan/[.08] text-plan font-medium' : 'border border-line bg-card text-soft'}`

  return (
    <BottomSheet onClose={onClose} cardClassName="px-5 pt-3.5 pb-5 max-h-[88%] flex flex-col">
      <div className="w-[38px] h-1 rounded-full bg-handle mx-auto mb-2 flex-shrink-0" />
      <div className="flex items-center justify-between flex-shrink-0">
        <h2 className="font-serif-sc text-[15px] font-semibold">{t('ledger.filter.title')}</h2>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-muted" title={t('activity.close')} aria-label={t('activity.close')}>
          <X className="w-[18px] h-[18px]" strokeWidth={1.8} />
        </button>
      </div>

      <div className="overflow-y-auto no-scrollbar flex-1 min-h-0 flex flex-col gap-2.5 mt-1">
        <div className="text-[10.5px] tracking-widest uppercase text-muted">{t('ledger.filter.categories')}</div>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button key={c.id} type="button" onClick={() => toggle('categoryIds', c.id)} className={`${chipClass(value.categoryIds.includes(c.id))} rounded-[11px] pl-1.5 pr-3 py-1.5`}>
              <span className="w-[3px] h-4 rounded-full" style={{ background: categoryColor(c) }} />
              {categoryLabel(c, t)}
            </button>
          ))}
        </div>
        <div className="text-[10.5px] text-muted">{t('ledger.filter.categoriesHint')}</div>

        <div className="text-[10.5px] tracking-widest uppercase text-muted mt-1">{t('ledger.filter.payments')}</div>
        <div className="flex flex-wrap gap-1.5">
          {hasCash && (
            <button type="button" onClick={() => toggle('payments', PAY_CASH)} className={`${chipClass(value.payments.includes(PAY_CASH))} rounded-full px-3 py-1.5`}>
              <Banknote className="w-3.5 h-3.5" strokeWidth={1.8} />
              {t('ledger.filter.cash')}
            </button>
          )}
          {cards.map((c) => (
            <button key={c.id} type="button" onClick={() => toggle('payments', c.id)} className={`${chipClass(value.payments.includes(c.id))} rounded-full px-3 py-1.5`}>
              <CreditCard className="w-3.5 h-3.5" strokeWidth={1.8} />
              {c.name}
            </button>
          ))}
          {hasPending && (
            <button type="button" onClick={() => toggle('payments', PAY_PENDING)} className={`${chipClass(value.payments.includes(PAY_PENDING))} rounded-full px-3 py-1.5`}>
              {t('ledger.filter.pending')}
            </button>
          )}
        </div>
        <div className="text-[10.5px] text-muted leading-relaxed">{t('ledger.filter.paymentsHint')}</div>
      </div>

      <div className="flex gap-2.5 mt-3 flex-shrink-0">
        <button
          type="button"
          onClick={() => onChange({ categoryIds: [], payments: [] })}
          className="min-h-[44px] px-4 rounded-full border border-line bg-card text-soft text-[13px] flex items-center gap-1.5"
        >
          <RotateCcw className="w-[15px] h-[15px]" strokeWidth={1.8} />
          {t('ledger.filter.clear')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 min-h-[44px] rounded-full bg-plan text-card text-[13px] font-semibold flex items-center justify-center gap-1.5"
        >
          <Check className="w-[15px] h-[15px]" strokeWidth={2} />
          {t('ledger.filter.show', { count: matchCount })}
        </button>
      </div>
    </BottomSheet>
  )
}
