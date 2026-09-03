import { useTranslation } from 'react-i18next'
import { formatMoney } from '../../../lib/money'
import { categoryLabel } from '../../../lib/categoryLabel'
import { formatDotDate, formatDow, formatMD } from '../formatShared'
import type { ShareTemplateProps } from './types'

// 模板 2a：车票凭证感——一天一张可撕的票根，登机牌式头部 + 打孔虚线分隔
export function TicketTemplate({ data }: ShareTemplateProps) {
  const { t, i18n } = useTranslation()
  const showItinerary = (data.scope === 'itinerary' || data.scope === 'both') && !!data.days?.length
  const showExpense = (data.scope === 'expenses' || data.scope === 'both') && data.expenseTotal != null

  return (
    <div className="min-h-screen bg-[#EFEDE6] text-[#141821]" style={{ fontFamily: '"Noto Sans SC", -apple-system, system-ui, sans-serif' }}>
      <div className="max-w-[640px] mx-auto">
        <div className="bg-[#1B3A6B] text-[#EFEDE6] px-6 pt-8 pb-6">
          <div className="flex justify-between items-start">
            <div className="text-[10px] tracking-[0.2em] opacity-70" style={{ fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace' }}>
              {t('shareTemplates.ticket.badge')}
            </div>
          </div>
          <div className="mt-4 font-bold text-[26px] leading-tight">{data.name}</div>
          {data.startDate && data.endDate && (
            <div className="mt-3 flex items-end gap-3.5">
              <div>
                <div className="text-[9.5px] tracking-[0.14em] opacity-60" style={{ fontFamily: 'ui-monospace, monospace' }}>DEPART</div>
                <div className="mt-0.5 text-[17px] font-semibold tabular" style={{ fontFamily: 'ui-monospace, monospace' }}>{data.startDate}</div>
              </div>
              <div className="flex-1 h-px bg-[#EFEDE6]/35 mb-1.5" />
              <div className="text-right">
                <div className="text-[9.5px] tracking-[0.14em] opacity-60" style={{ fontFamily: 'ui-monospace, monospace' }}>RETURN</div>
                <div className="mt-0.5 text-[17px] font-semibold tabular" style={{ fontFamily: 'ui-monospace, monospace' }}>{data.endDate}</div>
              </div>
            </div>
          )}
        </div>
        <div className="h-3.5 bg-[#1B3A6B] relative">
          <div className="absolute -left-2 -bottom-2 w-4 h-4 rounded-full bg-[#EFEDE6]" />
          <div className="absolute -right-2 -bottom-2 w-4 h-4 rounded-full bg-[#EFEDE6]" />
          <div className="absolute left-3.5 right-3.5 bottom-0 border-t border-dashed border-[#EFEDE6]/45" />
        </div>

        <div className="px-4 pt-4">
          {showItinerary && data.days!.map((day, i) => (
            <div key={i} className="bg-[#FBFAF6] border border-[#D9D5C8] rounded-[10px] mb-3 overflow-hidden">
              <div className="flex items-center gap-3 px-3.5 py-3 border-b border-dashed border-[#D9D5C8]">
                <div className="text-[22px] font-semibold tabular text-[#1B3A6B]" style={{ fontFamily: 'ui-monospace, monospace' }}>
                  {formatDotDate(day.dayDate)}
                </div>
                <div className="flex-1 min-w-0">
                  {day.dayTitle && <div className="text-[13px] font-medium truncate">{day.dayTitle}</div>}
                  <div className="mt-0.5 text-[10px] tracking-[0.1em] text-[#8A8578]" style={{ fontFamily: 'ui-monospace, monospace' }}>
                    DAY {i + 1} · {formatMD(day.dayDate, i18n.language)} {formatDow(day.dayDate, i18n.language)}
                  </div>
                </div>
              </div>
              <div className="px-3.5 pt-1 pb-2.5">
                {day.items.map((it, j) => (
                  <div key={j} className="flex gap-3 py-2 border-b border-[#EFECE2] last:border-b-0">
                    {it.time && (
                      <div className="w-11 flex-shrink-0 text-[13px] font-medium tabular text-[#1B3A6B] pt-px" style={{ fontFamily: 'ui-monospace, monospace' }}>
                        {it.time}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] leading-snug">{it.title}</div>
                      {it.locationName && <div className="mt-0.5 text-[11px] text-[#8A8578]">{it.locationName}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {showExpense && (
          <div className="bg-[#FBFAF6] border-t border-[#D9D5C8] px-4.5 pt-3.5 pb-4">
            <div className="flex justify-between items-baseline">
              <div className="text-[9.5px] tracking-[0.14em] text-[#8A8578]" style={{ fontFamily: 'ui-monospace, monospace' }}>TOTAL FARE</div>
              <div className="text-[20px] font-semibold tabular text-[#0F766E]" style={{ fontFamily: 'ui-monospace, monospace' }}>
                {formatMoney(data.expenseTotal!)}
              </div>
            </div>
            {!!data.expenseCategories?.length && (
              <div className="mt-2.5 flex gap-3.5 flex-wrap">
                {data.expenseCategories.map((c) => (
                  <div key={c.id}>
                    <div className="text-[10px] text-[#8A8578]">{categoryLabel(c, t)}</div>
                    <div className="mt-0.5 text-[12px] font-medium tabular" style={{ fontFamily: 'ui-monospace, monospace' }}>
                      {formatMoney(c.amount)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="text-center text-[9.5px] tracking-[0.12em] text-[#A8A296] py-4" style={{ fontFamily: 'ui-monospace, monospace' }}>
          {t('shareTemplates.ticket.footer', { brand: t('common.appName') })}
        </div>
      </div>
    </div>
  )
}
