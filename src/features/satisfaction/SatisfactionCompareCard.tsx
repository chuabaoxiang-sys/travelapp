import { useTranslation } from 'react-i18next'
import type { RatingBreakdown } from '../../domain/satisfaction'
import { useStaggerEntrance } from '../../hooks/useStaggerEntrance'

// "我的回顾"里的并列对比——2026-09-11讨论定的方案：行程体验（天）和花销
// 价值（账目）本来是两个不同维度的"值不值"，硬平均成一个数字没有意义，
// 所以用同一套三色条视觉并排放，让人自己比、不替用户下"哪个更值"的结论。
function StackBar({ breakdown, entered }: { breakdown: RatingBreakdown; entered: boolean }) {
  const total = breakdown.worth + breakdown.neutral + breakdown.regret
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0)
  return (
    <div className="flex h-2.5 rounded-full overflow-hidden bg-line">
      <div className="bar-fill h-full bg-positive" style={{ width: entered ? `${pct(breakdown.worth)}%` : '0%' }} />
      <div className="bar-fill h-full bg-faint" style={{ width: entered ? `${pct(breakdown.neutral)}%` : '0%' }} />
      <div className="bar-fill h-full bg-negative" style={{ width: entered ? `${pct(breakdown.regret)}%` : '0%' }} />
    </div>
  )
}

export function SatisfactionCompareCard({ days, expenses }: { days: RatingBreakdown; expenses: RatingBreakdown }) {
  const { t } = useTranslation()
  const { entered, enterClass, nextDelayMs, delayStyle } = useStaggerEntrance()
  const dayTotal = days.worth + days.neutral + days.regret
  const expenseTotal = expenses.worth + expenses.neutral + expenses.regret

  return (
    <div className="flex flex-col gap-3">
      <div className={enterClass()} style={delayStyle(nextDelayMs())}>
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[12px] font-semibold">{t('satisfaction.tripExperience')}</span>
          <span className="text-[10.5px] text-muted">
            {dayTotal > 0 ? t('satisfaction.dayBreakdownSummary', { total: dayTotal, worth: days.worth }) : t('satisfaction.noDaysRated')}
          </span>
        </div>
        <StackBar breakdown={days} entered={entered} />
      </div>
      <div className={enterClass()} style={delayStyle(nextDelayMs())}>
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[12px] font-semibold">{t('satisfaction.expenseValue')}</span>
          <span className="text-[10.5px] text-muted">
            {expenseTotal > 0 ? t('satisfaction.expenseBreakdownSummary', { total: expenseTotal, worth: expenses.worth }) : t('satisfaction.noExpensesRated')}
          </span>
        </div>
        <StackBar breakdown={expenses} entered={entered} />
      </div>
      <div className="flex gap-3 text-[10px] text-muted">
        <span className="flex items-center gap-1"><i className="w-1.5 h-1.5 rounded-full bg-positive inline-block" />{t('satisfaction.ratingWorth')}</span>
        <span className="flex items-center gap-1"><i className="w-1.5 h-1.5 rounded-full bg-faint inline-block" />{t('satisfaction.ratingNeutral')}</span>
        <span className="flex items-center gap-1"><i className="w-1.5 h-1.5 rounded-full bg-negative inline-block" />{t('satisfaction.ratingRegret')}</span>
      </div>
    </div>
  )
}
