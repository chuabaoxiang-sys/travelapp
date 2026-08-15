import { formatMoney } from '../../../lib/money'
import { formatDotDate, formatDow } from '../formatShared'
import type { ShareTemplateProps } from './types'

const MONO = 'ui-monospace, "IBM Plex Mono", "SF Mono", Consolas, monospace'
const LABEL_FONT = '"Barlow Semi Condensed", ui-sans-serif, sans-serif'

// 模板：出发信息板——机场出发大厅翻牌显示屏质感，高密度、机械、准点感，
// 固定表头 TIME/DESTINATION/DAY + 逐日深色分组行
export function DepartureBoardTemplate({ data }: ShareTemplateProps) {
  const showItinerary = (data.scope === 'itinerary' || data.scope === 'both') && !!data.days?.length
  const showExpense = (data.scope === 'expenses' || data.scope === 'both') && data.expenseTotal != null

  return (
    <div className="min-h-screen bg-[#14161A] text-[#E9ECEF]" style={{ fontFamily: '"Noto Sans SC", -apple-system, system-ui, sans-serif' }}>
      <div className="max-w-[640px] mx-auto">
        <div className="px-6 pt-8 pb-4 border-b border-[#262B33]">
          <div className="flex justify-between items-center">
            <div className="text-[11px] font-semibold tracking-[4px] text-[#FFB000]" style={{ fontFamily: LABEL_FONT }}>
              DEPARTURES
            </div>
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-[#7D8590]" style={{ fontFamily: MONO }}>
              <span className="w-[5px] h-[5px] rounded-full bg-[#46D07E] inline-block" />
              ON TIME
            </div>
          </div>
          <div className="mt-3.5 font-bold text-[26px] leading-tight">{data.name}</div>
          {data.startDate && data.endDate && (
            <div className="mt-2.5 flex gap-1.5">
              <div className="bg-[#1B1F26] border border-[#2B313B] rounded px-2.5 py-1.5 text-[15px] font-semibold tabular text-[#FFB000]" style={{ fontFamily: MONO }}>
                {data.startDate}
              </div>
              <div className="flex items-center text-[#4C545F] text-[13px]">→</div>
              <div className="bg-[#1B1F26] border border-[#2B313B] rounded px-2.5 py-1.5 text-[15px] font-semibold tabular text-[#FFB000]" style={{ fontFamily: MONO }}>
                {data.endDate}
              </div>
            </div>
          )}
        </div>

        {showItinerary && (
          <div>
            <div className="flex gap-2.5 px-6 py-2.5 bg-[#1B1F26] text-[9.5px] font-semibold tracking-[2.4px] text-[#7D8590]" style={{ fontFamily: LABEL_FONT }}>
              <div className="w-11">TIME</div>
              <div className="flex-1">DESTINATION</div>
              <div className="w-10 text-right">DAY</div>
            </div>
            {data.days!.map((day, i) => (
              <div key={i}>
                <div className="flex items-baseline gap-2.5 px-6 pt-3.5 pb-1.5 bg-[#171A20]">
                  <div className="text-[13px] font-semibold tabular text-[#FFB000]" style={{ fontFamily: MONO }}>
                    {formatDotDate(day.dayDate)}
                  </div>
                  {day.dayTitle && <div className="text-[12.5px] font-medium">{day.dayTitle}</div>}
                  <div className="ml-auto text-[10px] font-semibold tracking-[2px] text-[#7D8590]" style={{ fontFamily: LABEL_FONT }}>
                    {formatDow(day.dayDate).replace('周', '').toUpperCase()}
                  </div>
                </div>
                {day.items.map((it, j) => (
                  <div key={j} className="flex gap-2.5 items-baseline px-6 py-2.5 border-b border-[#21262E]">
                    {it.time && (
                      <div className="w-11 flex-shrink-0 text-[14px] font-semibold tabular" style={{ fontFamily: MONO }}>
                        {it.time}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] leading-snug">{it.title}</div>
                      {it.locationName && <div className="text-[10.5px] text-[#7D8590] mt-0.5">{it.locationName}</div>}
                    </div>
                    <div className="w-10 text-right text-[11px] font-semibold tracking-[1.4px] text-[#46D07E]" style={{ fontFamily: LABEL_FONT }}>
                      D{i + 1}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {showExpense && (
          <div className="bg-[#1B1F26] border-t border-[#2B313B] px-6 pt-4 pb-4.5">
            <div className="flex justify-between items-baseline">
              <div className="text-[9.5px] font-semibold tracking-[2.6px] text-[#7D8590]" style={{ fontFamily: LABEL_FONT }}>
                TOTAL SPEND
              </div>
              <div className="text-[21px] font-semibold tabular text-[#FFB000]" style={{ fontFamily: MONO }}>
                {formatMoney(data.expenseTotal!)}
              </div>
            </div>
            {!!data.expenseCategories?.length && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {data.expenseCategories.map((c) => (
                  <div key={c.name} className="border border-[#2B313B] rounded px-2 py-1 text-[10.5px] text-[#A9B1BA]">
                    {c.name} <span className="font-medium tabular text-[#E9ECEF]" style={{ fontFamily: MONO }}>{formatMoney(c.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 text-[9.5px] font-semibold tracking-[3px] text-[#4C545F]" style={{ fontFamily: LABEL_FONT }}>
              POWERED BY 旅记
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
