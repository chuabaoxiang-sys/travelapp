import { formatMoney } from '../../../lib/money'
import { formatDow, formatDotDate } from '../formatShared'
import type { ShareTemplateProps } from './types'

// 模板 2c：旅途拼贴——逐日翻页，每天一张微投影的"纸片"，左上角一段歪斜的
// 胶带压住页角，深绿点阵封面头，家庭味最重、最适合截图分享
export function CollageTemplate({ data }: ShareTemplateProps) {
  const showItinerary = (data.scope === 'itinerary' || data.scope === 'both') && !!data.days?.length
  const showExpense = (data.scope === 'expenses' || data.scope === 'both') && data.expenseTotal != null

  return (
    <div className="min-h-screen bg-[#E3E9E3] text-[#17251E]" style={{ fontFamily: '"Noto Sans SC", -apple-system, system-ui, sans-serif' }}>
      <div className="max-w-[640px] mx-auto">
        <div
          className="px-6 pt-8 pb-6 bg-[#1E3A2F] text-[#EDF2EA] relative"
          style={{ backgroundImage: 'radial-gradient(rgba(237,242,234,.14) 1px, transparent 1px)', backgroundSize: '14px 14px' }}
        >
          <div className="text-[10.5px] tracking-[0.28em] text-[#EDF2EA]/60">家 族 旅 行 记 录</div>
          <div className="mt-3 font-bold text-[28px] leading-tight" style={{ fontFamily: '"Noto Serif SC", serif' }}>
            {data.name}
          </div>
          {data.startDate && data.endDate && (
            <div className="mt-2.5 flex items-center gap-2.5">
              <div className="bg-[#F2C230] text-[#17251E] rounded px-2.5 py-1 text-[12px] font-semibold tabular">
                {data.startDate} – {data.endDate}
              </div>
            </div>
          )}
        </div>

        {showItinerary && (
          <div className="px-4 pt-4">
            {data.days!.map((day, i) => (
              <div key={i} className="relative bg-[#F7F9F5] rounded px-3.5 pt-3.5 pb-3 mb-3.5 shadow-[0_2px_0_rgba(23,37,30,0.08)]">
                <div
                  className="absolute -top-1.5 left-5 w-[52px] h-[15px] bg-[#F2C230]/75"
                  style={{ transform: 'rotate(-1.6deg)' }}
                />
                <div className="flex items-baseline gap-2">
                  <div className="font-bold text-[17px]" style={{ fontFamily: '"Noto Serif SC", serif' }}>
                    第 {i + 1} 天
                  </div>
                  <div className="text-[12px] text-[#5C7266] tabular">{formatDotDate(day.dayDate)}</div>
                  <div className="text-[11px] text-[#5C7266]">{formatDow(day.dayDate)}</div>
                </div>
                {day.dayTitle && <div className="mt-1 text-[13px] font-medium text-[#2E4A3C]">{day.dayTitle}</div>}
                <div className="mt-2.5 border-t border-dashed border-[#CFDBD1] pt-2">
                  {day.items.map((it, j) => (
                    <div key={j} className="flex gap-2.5 py-1.5">
                      {it.time && (
                        <div className="w-[42px] flex-shrink-0 text-[12.5px] font-medium tabular text-[#1E3A2F]">{it.time}</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] leading-snug">{it.title}</div>
                        {it.locationName && <div className="mt-0.5 text-[10.5px] text-[#7A8C81]">{it.locationName}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {showExpense && (
          <div className="bg-[#1E3A2F] text-[#EDF2EA] px-5 pt-4 pb-4.5">
            <div className="flex justify-between items-baseline">
              <div className="text-[11px] tracking-[0.13em] text-[#EDF2EA]/60">这趟一共花了</div>
              <div className="text-[22px] font-semibold tabular text-[#F2C230]">{formatMoney(data.expenseTotal!)}</div>
            </div>
            {!!data.expenseCategories?.length && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {data.expenseCategories.map((c) => (
                  <div key={c.name} className="bg-[#EDF2EA]/12 rounded px-2.5 py-1 text-[11px]">
                    {c.name} <span className="tabular font-medium text-[#C9E4C0]">{formatMoney(c.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3.5 text-[10.5px] tracking-[0.1em] text-[#EDF2EA]/50">用「旅记」记录 · 分享</div>
          </div>
        )}
      </div>
    </div>
  )
}
