import { useTranslation } from 'react-i18next'
import { formatMoney } from '../../../lib/money'
import { categoryLabel } from '../../../lib/categoryLabel'
import { formatDow, formatDotDate } from '../formatShared'
import type { ShareTemplateProps } from './types'

// 模板 2b：时刻表编辑感——不用卡片，纯排版，超大号等宽数字日期做视觉锚点，
// 页脚反白成实色块收尾
export function EditorialTemplate({ data }: ShareTemplateProps) {
  const { t, i18n } = useTranslation()
  const showItinerary = (data.scope === 'itinerary' || data.scope === 'both') && !!data.days?.length
  const showExpense = (data.scope === 'expenses' || data.scope === 'both') && data.expenseTotal != null

  return (
    <div className="min-h-screen bg-[#FAFAF7] text-[#14140F]" style={{ fontFamily: '"Noto Sans SC", -apple-system, system-ui, sans-serif' }}>
      <div className="max-w-[640px] mx-auto">
        <div className="px-6 pt-9 pb-5 border-b-2 border-[#14140F]">
          <div className="text-[10px] tracking-[0.2em] text-[#6B6A5E]" style={{ fontFamily: '"Space Grotesk", ui-sans-serif, sans-serif' }}>
            ITINERARY
          </div>
          <div className="mt-3.5 font-black text-[34px] leading-[1.08] tracking-tight text-wrap-balance">
            {data.name}
          </div>
          {data.startDate && data.endDate && (
            <div className="mt-4 flex items-baseline gap-2 text-[15px] font-bold tabular" style={{ fontFamily: '"Space Grotesk", ui-sans-serif, sans-serif' }}>
              <span>{data.startDate}</span>
              <span className="text-[#2C3AE8]">—</span>
              <span>{data.endDate}</span>
            </div>
          )}
        </div>

        {showItinerary && (
          <div className="px-6">
            {data.days!.map((day, i) => (
              <div key={i} className="py-5 border-b border-[#E0DFD6]">
                <div className="flex items-baseline gap-2.5">
                  <div className="text-[30px] font-bold tabular tracking-tight" style={{ fontFamily: '"Space Grotesk", ui-sans-serif, sans-serif' }}>
                    {formatDotDate(day.dayDate)}
                  </div>
                  <div className="text-[11px] text-[#6B6A5E]">{formatDow(day.dayDate, i18n.language)}</div>
                  <div className="ml-auto text-[11px] tracking-[0.14em] text-[#2C3AE8]" style={{ fontFamily: '"Space Grotesk", ui-sans-serif, sans-serif' }}>
                    DAY {i + 1}
                  </div>
                </div>
                {day.dayTitle && <div className="mt-1.5 text-[15px] font-medium">{day.dayTitle}</div>}
                <div className="mt-2.5">
                  {day.items.map((it, j) => (
                    <div key={j} className="flex gap-3.5 py-1.5">
                      {it.time && (
                        <div className="w-[46px] flex-shrink-0 text-[13px] font-bold tabular text-[#2C3AE8] pt-px" style={{ fontFamily: '"Space Grotesk", ui-sans-serif, sans-serif' }}>
                          {it.time}
                        </div>
                      )}
                      <div className="flex-1 min-w-0 pb-0.5">
                        <div className="text-[13.5px] leading-snug">{it.title}</div>
                        {it.locationName && <div className="mt-0.5 text-[11px] text-[#8B8A7C]">{it.locationName}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {showExpense && (
          <div className="bg-[#14140F] text-[#FAFAF7] px-6 pt-4.5 pb-5">
            <div className="flex items-baseline justify-between">
              <div className="text-[10px] tracking-[0.16em] text-[#FAFAF7]/55" style={{ fontFamily: '"Space Grotesk", ui-sans-serif, sans-serif' }}>TOTAL</div>
              <div className="text-[26px] font-bold tabular" style={{ fontFamily: '"Space Grotesk", ui-sans-serif, sans-serif' }}>
                {formatMoney(data.expenseTotal!)}
              </div>
            </div>
            {!!data.expenseCategories?.length && (
              <div className="mt-3">
                {data.expenseCategories.map((c) => (
                  <div key={c.id} className="flex justify-between py-1 text-[11.5px] border-b border-[#FAFAF7]/14 last:border-b-0">
                    <span className="text-[#FAFAF7]/62">{categoryLabel(c, t)}</span>
                    <span className="tabular font-medium" style={{ fontFamily: '"Space Grotesk", ui-sans-serif, sans-serif' }}>
                      {formatMoney(c.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3.5 text-[10px] tracking-[0.14em] text-[#FAFAF7]/50" style={{ fontFamily: '"Space Grotesk", ui-sans-serif, sans-serif' }}>
              {t('shareTemplates.editorial.footer', { brand: t('common.appName') })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
