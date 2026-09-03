import { useTranslation } from 'react-i18next'
import { formatMoney } from '../../../lib/money'
import { categoryLabel } from '../../../lib/categoryLabel'
import { formatDotDate, formatDow } from '../formatShared'
import type { ShareTemplateProps } from './types'

const MONO = 'ui-monospace, "IBM Plex Mono", "SF Mono", Consolas, monospace'
const SERIF = '"Noto Serif SC", "Songti SC", STSong, SimSun, serif'

// 模板：旅行纪事报——把一趟家庭旅行当成一份可收藏的家庭小报，报纸分栏排版，
// 双线报头 + 逐日专栏 + 双栏正文，最有"留存价值"的一套
export function GazetteTemplate({ data }: ShareTemplateProps) {
  const { t, i18n } = useTranslation()
  const showItinerary = (data.scope === 'itinerary' || data.scope === 'both') && !!data.days?.length
  const showExpense = (data.scope === 'expenses' || data.scope === 'both') && data.expenseTotal != null

  return (
    <div className="min-h-screen bg-[#EFEEE9] text-[#121212]" style={{ fontFamily: '"Noto Sans SC", -apple-system, system-ui, sans-serif' }}>
      <div className="max-w-[640px] mx-auto px-6 pt-7 pb-16">
        <div className="pb-3 border-b-[3px]" style={{ borderBottomStyle: 'double', borderColor: '#121212' }}>
          <div className="flex justify-between text-[10px] tracking-[2px] text-[#5A5A55]">
            <span>{t('shareTemplates.gazette.editionLabel')}</span>
            <span>{t('shareTemplates.gazette.byline')}</span>
          </div>
          <div className="mt-2 text-center font-black text-[34px] tracking-[2px]" style={{ fontFamily: SERIF }}>
            {t('shareTemplates.gazette.masthead')}
          </div>
          {data.startDate && data.endDate && (
            <div className="mt-2.5 flex justify-between items-center py-1.5 border-y border-[#121212] text-[11px] font-medium tabular" style={{ fontFamily: MONO }}>
              <span>
                {data.startDate} – {data.endDate}
              </span>
              <span className="font-sans">{data.name}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2.5 items-start pt-3.5 pb-3 border-b border-[#C9C7BE]">
          <div className="flex-1 font-bold text-[19px] leading-snug text-wrap-balance" style={{ fontFamily: SERIF }}>
            {data.name}
          </div>
        </div>

        {showItinerary && (
          <div>
            {data.days!.map((day, i) => (
              <div key={i} className="py-3 border-b border-[#C9C7BE]">
                <div className="flex items-baseline gap-2">
                  <div className="bg-[#121212] text-[#EFEEE9] text-[10px] font-medium tracking-[1px] px-1.5 py-1" style={{ fontFamily: MONO }}>
                    DAY {i + 1}
                  </div>
                  {day.dayTitle && (
                    <div className="font-bold text-[15px]" style={{ fontFamily: SERIF }}>
                      {day.dayTitle}
                    </div>
                  )}
                  <div className="ml-auto text-[10.5px] text-[#5A5A55] tabular" style={{ fontFamily: MONO }}>
                    {formatDotDate(day.dayDate)} {formatDow(day.dayDate, i18n.language)}
                  </div>
                </div>
                <div className="mt-2" style={{ columnCount: 2, columnGap: '14px', columnRule: '1px solid #D9D7CE' }}>
                  {day.items.map((it, j) => (
                    <div key={j} className="pb-2" style={{ breakInside: 'avoid' }}>
                      {it.time && (
                        <div className="text-[11px] font-medium tabular text-[#B0342E]" style={{ fontFamily: MONO }}>
                          {it.time}
                        </div>
                      )}
                      <div className="mt-0.5 text-[12.5px] leading-snug font-medium">{it.title}</div>
                      {it.locationName && <div className="mt-0.5 text-[10.5px] leading-snug text-[#6B6B64]">{it.locationName}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {showExpense && (
          <div className="pt-3 mt-1" style={{ borderTopStyle: 'double', borderTopWidth: '3px', borderColor: '#121212' }}>
            <div className="flex justify-between items-baseline">
              <div className="font-bold text-[13px]" style={{ fontFamily: SERIF }}>
                {t('shareTemplates.gazette.expenseSectionTitle')}
              </div>
              <div className="font-semibold text-[20px] tabular" style={{ fontFamily: MONO }}>
                {formatMoney(data.expenseTotal!)}
              </div>
            </div>
            {!!data.expenseCategories?.length && (
              <div className="mt-2 flex flex-wrap gap-x-3">
                {data.expenseCategories.map((c) => (
                  <div key={c.id} className="text-[11px] text-[#5A5A55]">
                    {categoryLabel(c, t)}
                    <span className="ml-1 font-medium tabular text-[#121212]" style={{ fontFamily: MONO }}>
                      {formatMoney(c.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 text-center text-[10px] tracking-[3px] text-[#8A8A82]">{t('shareTemplates.common.footerShort', { brand: t('common.appName') })}</div>
          </div>
        )}
      </div>
    </div>
  )
}
