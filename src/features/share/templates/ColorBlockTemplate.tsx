import { formatMoney } from '../../../lib/money'
import { formatDotDate } from '../formatShared'
import { DAY_COLORS } from './colorBlockPalette'
import type { ShareTemplateProps } from './types'

const MONO = 'ui-monospace, "IBM Plex Mono", "SF Mono", Consolas, monospace'
const ROUND = '"Zen Maru Gothic", "Noto Sans SC", -apple-system, system-ui, sans-serif'

// 模板：亲子色块——一天一个颜色循环，圆润、明亮、好认，孩子也能一眼看懂
// 今天去哪，最适合发在家族群里
export function ColorBlockTemplate({ data }: ShareTemplateProps) {
  const showItinerary = (data.scope === 'itinerary' || data.scope === 'both') && !!data.days?.length
  const showExpense = (data.scope === 'expenses' || data.scope === 'both') && data.expenseTotal != null
  const heroColor = DAY_COLORS[0]

  return (
    <div className="min-h-screen bg-white text-[#1A1A1A]" style={{ fontFamily: '"Noto Sans SC", -apple-system, system-ui, sans-serif' }}>
      <div className="max-w-[640px] mx-auto">
        <div className="px-6.5 pt-9 pb-6 text-white" style={{ background: heroColor }}>
          <div className="text-[12px] tracking-[2px] opacity-90">我们一家的旅行</div>
          <div className="mt-2.5 font-black text-[30px] leading-tight text-wrap-balance" style={{ fontFamily: ROUND }}>
            {data.name}
          </div>
          {data.startDate && data.endDate && (
            <div className="mt-3.5 flex gap-2 items-center">
              <div className="bg-white rounded-full px-3.5 py-1.5 font-bold text-[13px] tabular" style={{ color: heroColor, fontFamily: MONO }}>
                {data.startDate} → {data.endDate}
              </div>
            </div>
          )}
        </div>

        {showItinerary && (
          <div className="px-4 pt-4">
            {data.days!.map((day, i) => {
              const color = DAY_COLORS[i % DAY_COLORS.length]
              return (
                <div key={i} className="rounded-[18px] overflow-hidden mb-3 border-2" style={{ borderColor: color }}>
                  <div className="flex items-center gap-2.5 px-3.5 py-2.5 text-white" style={{ background: color }}>
                    <div
                      className="w-[26px] h-[26px] rounded-full flex items-center justify-center font-bold text-[13px]"
                      style={{ background: 'rgba(255,255,255,.28)', fontFamily: ROUND }}
                    >
                      {i + 1}
                    </div>
                    {day.dayTitle && (
                      <div className="font-bold text-[14.5px]" style={{ fontFamily: ROUND }}>
                        {day.dayTitle}
                      </div>
                    )}
                    <div className="ml-auto font-medium text-[11.5px] tabular" style={{ fontFamily: MONO }}>
                      {formatDotDate(day.dayDate)}
                    </div>
                  </div>
                  <div className="px-3.5 pt-2 pb-2.5 bg-white">
                    {day.items.map((it, j) => (
                      <div key={j} className="flex gap-2.5 items-start py-1.5">
                        {it.time && (
                          <div
                            className="flex-shrink-0 bg-[#F3F3F1] rounded-lg px-1.5 py-0.5 font-bold text-[11.5px] tabular text-[#4A4A46]"
                            style={{ fontFamily: MONO }}
                          >
                            {it.time}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] leading-snug font-medium">{it.title}</div>
                          {it.locationName && <div className="text-[10.5px] text-[#8C8C86] mt-0.5">{it.locationName}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {showExpense && (
          <div className="bg-[#F7F7F4] border-t-2 border-[#ECECE7] px-4.5 pt-4 pb-4.5">
            <div className="flex justify-between items-baseline">
              <div className="font-bold text-[13.5px]" style={{ fontFamily: ROUND }}>
                这趟一共花了
              </div>
              <div className="font-bold text-[22px] tabular text-[#2BB3A3]" style={{ fontFamily: MONO }}>
                {formatMoney(data.expenseTotal!)}
              </div>
            </div>
            {!!data.expenseCategories?.length && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {data.expenseCategories.map((c, i) => (
                  <div
                    key={c.name}
                    className="rounded-full px-2.5 py-1 text-[11px] text-white"
                    style={{ background: DAY_COLORS[i % DAY_COLORS.length] }}
                  >
                    {c.name} <span className="font-bold tabular" style={{ fontFamily: MONO }}>{formatMoney(c.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3.5 text-center text-[11px] text-[#A3A39C]">用「旅记」记录 · 分享</div>
          </div>
        )}
      </div>
    </div>
  )
}
