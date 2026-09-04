import { useTranslation } from 'react-i18next'
import { formatMoney } from '../../../lib/money'
import { categoryLabel } from '../../../lib/categoryLabel'
import { formatDow, formatMD } from '../formatShared'
import type { ShareTemplateProps } from './types'

// 模板：旅记手账风——沿用APP自己的品牌色系(ink/paper/plan)，胶带贴纸日期条 +
// 虚线分隔的行程项，是10套里唯一延续APP自身视觉语言的一套
export function JournalTemplate({ data }: ShareTemplateProps) {
  const { t, i18n } = useTranslation()
  const showItinerary = (data.scope === 'itinerary' || data.scope === 'both') && !!data.days?.length
  const showExpense = (data.scope === 'expenses' || data.scope === 'both') && data.expenseTotal != null

  return (
    <div
      className="min-h-screen bg-[#F7F3EC] text-[#1F1B16]"
      style={{
        fontFamily: '"Noto Sans SC", -apple-system, system-ui, sans-serif',
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(140,120,90,0.045) 0 1px, transparent 1px 4px), repeating-linear-gradient(90deg, rgba(140,120,90,0.035) 0 1px, transparent 1px 4px)',
      }}
    >
      <div className="max-w-[640px] mx-auto px-7 pt-12 pb-16">
        <div className="text-center">
          <div className="text-[11px] tracking-[0.22em] text-[#8A8177] uppercase">{t('shareTemplates.journal.eyebrow', { brand: t('common.appName') })}</div>
          <div className="mt-2.5 font-bold text-[28px] leading-tight text-wrap-balance" style={{ fontFamily: '"Noto Serif SC", "Songti SC", STSong, SimSun, serif' }}>
            {data.name}
          </div>
          {data.startDate && data.endDate && (
            <div className="mt-1.5 text-[13px] text-[#8A8177] tabular">
              {data.startDate} – {data.endDate}
            </div>
          )}
        </div>
        <div className="text-center text-[12px] text-[#8A8177] mt-3.5 mb-10 pt-3.5 border-t border-[#E8E0D4]">
          {t('shareTemplates.journal.readOnlyNotice')}
        </div>

        {showItinerary && (
          <div>
            {data.days!.map((day, i) => (
              <div key={i} className="mb-9 relative pt-2">
                <div
                  className="absolute -top-0.5 left-[50px] w-[60px] h-[17px] bg-[#282E71]/[0.14] border border-[#282E71]/20"
                  style={{ transform: 'rotate(-2.2deg)' }}
                />
                <div className="flex items-baseline gap-3 mb-3.5">
                  <div
                    className="w-10 h-10 rounded-full bg-[#1F1B16] text-[#F7F3EC] flex items-center justify-center flex-shrink-0 font-bold text-[15px]"
                    style={{ fontFamily: '"Noto Serif SC", serif' }}
                  >
                    {i + 1}
                  </div>
                  <div>
                    {day.dayTitle && (
                      <div className="font-bold text-[17px]" style={{ fontFamily: '"Noto Serif SC", serif' }}>
                        {day.dayTitle}
                      </div>
                    )}
                    <div className="text-[12px] text-[#8A8177] tabular mt-0.5">
                      {formatMD(day.dayDate, i18n.language)} · {formatDow(day.dayDate, i18n.language)}
                    </div>
                  </div>
                </div>
                <div className="ml-[52px] flex flex-col gap-0.5">
                  {day.items.map((it, j) => (
                    <div key={j} className="flex gap-3.5 py-2.5 border-b border-dashed border-[#E8E0D4] last:border-b-0">
                      {it.time && <div className="w-11 flex-shrink-0 text-[13px] font-semibold tabular text-[#282E71] pt-px">{it.time}</div>}
                      <div>
                        <div className="text-[14.5px] font-semibold">{it.title}</div>
                        {it.locationName && <div className="text-[12px] text-[#8A8177] mt-0.5">{it.locationName}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {showExpense && (
          <div className="mt-11 p-5.5 bg-[#FFFDF9] border border-[#E8E0D4] rounded-[18px]">
            <div className="font-bold text-[14px] mb-3.5" style={{ fontFamily: '"Noto Serif SC", serif' }}>
              {t('shareTemplates.journal.expenseSummaryTitle')}
            </div>
            <div className="flex justify-between items-baseline pb-3.5 mb-3.5 border-b border-[#E8E0D4]">
              <span className="text-[13px]">{t('shareTemplates.common.totalExpenseLabel')}</span>
              <span className="font-bold text-[26px] tabular text-[#0F766E]" style={{ fontFamily: '"Noto Serif SC", serif' }}>
                {formatMoney(data.expenseTotal!)}
              </span>
            </div>
            {!!data.expenseCategories?.length && (
              <div>
                {data.expenseCategories.map((c) => (
                  <div key={c.id} className="flex justify-between text-[13px] py-1.5 text-[#8A8177]">
                    <span>{categoryLabel(c, t)}</span>
                    <span className="tabular text-[#1F1B16] font-semibold">{formatMoney(c.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="text-center text-[11.5px] text-[#8A8177] mt-12">{t('shareTemplates.common.footerFamily', { brand: t('common.appName') })}</div>
      </div>
    </div>
  )
}
