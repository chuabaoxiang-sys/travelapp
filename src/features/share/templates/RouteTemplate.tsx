import { Trans, useTranslation } from 'react-i18next'
import { formatMoney } from '../../../lib/money'
import { categoryLabel } from '../../../lib/categoryLabel'
import { formatDow, formatMD } from '../formatShared'
import type { ShareTemplateProps } from './types'

// 模板：路线地图感——一条纵向路线串起每一天，不依赖任何照片/地图数据，
// 纯用一条竖线 + 圆点模拟"走过的路线"
export function RouteTemplate({ data }: ShareTemplateProps) {
  const { t, i18n } = useTranslation()
  const showItinerary = (data.scope === 'itinerary' || data.scope === 'both') && !!data.days?.length
  const showExpense = (data.scope === 'expenses' || data.scope === 'both') && data.expenseTotal != null
  const stopCount = data.days?.reduce((sum, d) => sum + d.items.length, 0) ?? 0

  return (
    <div className="min-h-screen bg-[#EBEEE9] text-[#1F2B24]" style={{ fontFamily: '"Noto Sans SC", -apple-system, system-ui, sans-serif' }}>
      <div className="max-w-[640px] mx-auto px-6.5 pt-11 pb-20">
        <div className="text-[11px] tracking-[0.16em] text-[#6F7D73] uppercase">{t('shareTemplates.route.eyebrow', { brand: t('common.appName') })}</div>
        <div className="mt-2 font-bold text-[26px] leading-tight tracking-tight text-wrap-balance">{data.name}</div>
        {data.startDate && data.endDate && (
          <div className="mt-1.5 text-[12.5px] text-[#6F7D73] tabular flex items-center gap-2">
            {data.startDate} – {data.endDate}
            {!!data.days?.length && (
              <Trans
                i18nKey="shareTemplates.route.statsLine"
                values={{ days: data.days.length, stops: stopCount }}
                components={[<b className="text-[#D9704F] font-bold" key="0" />, <b className="text-[#D9704F] font-bold" key="1" />]}
              />
            )}
          </div>
        )}

        {showItinerary && (
          <div className="relative mt-8 pl-6.5">
            <div className="absolute left-[7px] top-1.5 bottom-1.5 w-0.5 bg-[#D9704F]" />
            {data.days!.map((day, i) => (
              <div key={i} className="relative mb-7.5 last:mb-0">
                <div
                  className="absolute -left-6.5 top-px w-4 h-4 rounded-full bg-[#D9704F] border-[3px] border-[#EBEEE9]"
                  style={{ boxShadow: '0 0 0 2px #D9704F' }}
                />
                <div className="flex items-baseline gap-2 mb-3">
                  {day.dayTitle && <div className="text-[15.5px] font-bold">{day.dayTitle}</div>}
                  <div className="text-[11.5px] text-[#6F7D73] tabular ml-auto">
                    {formatMD(day.dayDate, i18n.language)} {formatDow(day.dayDate, i18n.language)}
                  </div>
                </div>
                <div className="flex flex-col">
                  {day.items.map((it, j) => (
                    <div key={j} className="relative pl-5 py-2 border-l border-dashed border-[#E3DED6] ml-1 last:border-l-transparent">
                      <div className="absolute -left-[3.5px] top-3.5 w-1.5 h-1.5 rounded-full bg-[#6F7D73]" />
                      {it.time && <div className="text-[12px] font-bold tabular text-[#D9704F]">{it.time}</div>}
                      <div className="text-[13.5px] font-semibold mt-0.5">{it.title}</div>
                      {it.locationName && <div className="text-[11.5px] text-[#6F7D73] mt-0.5">{it.locationName}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {showExpense && (
          <div className="mt-7 p-5.5 bg-white rounded-2xl" style={{ boxShadow: '0 1px 2px rgba(31,43,36,0.06)' }}>
            <div className="flex items-center gap-1.5 text-[11px] tracking-[0.1em] text-[#6F7D73] uppercase mb-3">
              <span className="w-2 h-2 rounded-full bg-[#D9704F] inline-block" />
              {t('shareTemplates.route.expenseSectionTitle')}
            </div>
            <div className="flex justify-between items-baseline pb-3.5 mb-3.5 border-b border-[#E3DED6]">
              <span className="text-[13px]">{t('shareTemplates.common.totalExpenseLabel')}</span>
              <span className="text-[25px] font-bold tabular text-[#D9704F]">{formatMoney(data.expenseTotal!)}</span>
            </div>
            {!!data.expenseCategories?.length && (
              <div>
                {data.expenseCategories.map((c) => (
                  <div key={c.id} className="flex justify-between text-[13px] py-1.5 text-[#6F7D73]">
                    <span>{categoryLabel(c, t)}</span>
                    <span className="tabular text-[#1F2B24] font-semibold">{formatMoney(c.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="text-center text-[11.5px] text-[#6F7D73] mt-9">{t('shareTemplates.common.footerFamilyShort', { brand: t('common.appName') })}</div>
      </div>
    </div>
  )
}
