import { useTranslation } from 'react-i18next'
import { formatMoney } from '../../../lib/money'
import { categoryLabel } from '../../../lib/categoryLabel'
import { formatDow, formatMD } from '../formatShared'
import type { ShareTemplateProps } from './types'

// 模板：旅程结算单——反转层级，金额在最上面，行程是下面的"活动记录"，
// 直接把"行程+账本一体化"这个差异化优势做成视觉主体
export function StatementTemplate({ data }: ShareTemplateProps) {
  const { t, i18n } = useTranslation()
  const showItinerary = (data.scope === 'itinerary' || data.scope === 'both') && !!data.days?.length
  const showExpense = (data.scope === 'expenses' || data.scope === 'both') && data.expenseTotal != null

  return (
    <div className="min-h-screen bg-white text-[#111111]" style={{ fontFamily: '"Noto Sans SC", -apple-system, system-ui, sans-serif' }}>
      <div className="max-w-[600px] mx-auto pb-20">
        {showExpense && (
          <div className="bg-[#111111] text-white px-7 pt-10 pb-7">
            <div className="text-[11px] tracking-[0.18em] text-white/50 uppercase">{t('shareTemplates.statement.eyebrow', { brand: t('common.appName') })}</div>
            <div className="mt-2 font-semibold text-[22px] tracking-tight text-wrap-balance">{data.name}</div>
            {data.startDate && data.endDate && (
              <div className="text-[12.5px] text-white/55 tabular">
                {data.startDate} – {data.endDate}
              </div>
            )}
            <div className="mt-6 pt-5 border-t border-dashed border-white/20">
              <div className="text-[11px] tracking-[0.14em] text-white/50 uppercase">{t('shareTemplates.common.totalExpenseLabel')}</div>
              <div className="text-[40px] font-bold tabular tracking-tight mt-1">{formatMoney(data.expenseTotal!)}</div>
              {!!data.expenseCategories?.length && (
                <div className="flex flex-wrap gap-x-4.5 mt-4">
                  {data.expenseCategories.map((c) => (
                    <div key={c.id} className="flex items-baseline gap-1.5 text-[12px] text-white/60 py-1">
                      <span>{categoryLabel(c, t)}</span>
                      <span className="tabular text-white font-semibold">{formatMoney(c.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {!showExpense && (
          <div className="px-7 pt-10 pb-7 border-b border-[#E6E6E6]">
            <div className="text-[11px] tracking-[0.18em] text-[#7A7A7A] uppercase">{t('shareTemplates.statement.eyebrow', { brand: t('common.appName') })}</div>
            <div className="mt-2 font-semibold text-[22px] tracking-tight text-wrap-balance">{data.name}</div>
            {data.startDate && data.endDate && (
              <div className="text-[12.5px] text-[#7A7A7A] tabular">
                {data.startDate} – {data.endDate}
              </div>
            )}
          </div>
        )}

        {showItinerary && (
          <div className="px-7 pt-7">
            <div className="text-[11px] tracking-[0.12em] text-[#7A7A7A] uppercase mb-1">{t('shareTemplates.statement.activityLogTitle')}</div>
            {data.days!.map((day, i) => (
              <div key={i} className="mt-5.5">
                <div className="flex items-baseline gap-2.5 pb-2 mb-1 border-b border-[#111111]">
                  {day.dayTitle && <div className="text-[13.5px] font-bold">{day.dayTitle}</div>}
                  <div className="text-[11px] text-[#7A7A7A] tabular ml-auto">
                    {formatMD(day.dayDate, i18n.language)} {formatDow(day.dayDate, i18n.language)}
                  </div>
                </div>
                {day.items.map((it, j) => (
                  <div key={j} className="flex items-baseline gap-2.5 py-1.5 text-[12.5px]">
                    {it.time && <div className="tabular text-[#0E7C66] font-bold w-10 flex-shrink-0">{it.time}</div>}
                    <div className="font-medium whitespace-nowrap">{it.title}</div>
                    <div className="flex-1 border-b border-dotted border-[#E6E6E6] mx-1" style={{ transform: 'translateY(-3px)' }} />
                    {it.locationName && <div className="text-[11px] text-[#7A7A7A] whitespace-nowrap">{it.locationName}</div>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        <div className="text-center text-[11.5px] text-[#7A7A7A] mx-7 mt-10 pt-5 border-t border-[#E6E6E6]">
          {t('shareTemplates.common.footerFamily', { brand: t('common.appName') })}
        </div>
      </div>
    </div>
  )
}
