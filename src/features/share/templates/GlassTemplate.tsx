import { formatMoney } from '../../../lib/money'
import { formatDotDate, formatDow } from '../formatShared'
import type { ShareTemplateProps } from './types'

const MONO = 'ui-monospace, "IBM Plex Mono", "SF Mono", Consolas, monospace'

// 模板：夜航玻璃——七套里最克制内敛的一套，毛玻璃卡片悬浮在深蓝背景上，
// 靠留白撑层级，适合成年朋友之间转发
export function GlassTemplate({ data }: ShareTemplateProps) {
  const showItinerary = (data.scope === 'itinerary' || data.scope === 'both') && !!data.days?.length
  const showExpense = (data.scope === 'expenses' || data.scope === 'both') && data.expenseTotal != null

  return (
    <div
      className="min-h-screen bg-[#0B1730] text-[#E8EFF7]"
      style={{
        fontFamily: '"Noto Sans SC", -apple-system, system-ui, sans-serif',
        backgroundImage: 'radial-gradient(120% 60% at 50% 0%, rgba(127,212,255,0.16), rgba(11,23,48,0) 62%)',
      }}
    >
      <div className="max-w-[640px] mx-auto px-5.5 pt-11 pb-16">
        <div className="text-[10.5px] tracking-[3.4px] text-[#E8EFF7]/50">SHARED ITINERARY</div>
        <div className="mt-3 font-medium text-[27px] leading-tight tracking-wide text-wrap-balance">{data.name}</div>
        {data.startDate && data.endDate && (
          <div className="mt-3 flex items-center gap-2.5 text-[13px] font-medium tabular text-[#7FD4FF]" style={{ fontFamily: MONO }}>
            <span>{data.startDate}</span>
            <span className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(127,212,255,.5), rgba(127,212,255,.08))' }} />
            <span>{data.endDate}</span>
          </div>
        )}

        {showItinerary && (
          <div className="mt-5">
            {data.days!.map((day, i) => (
              <div
                key={i}
                className="rounded-[20px] px-4 pt-3.5 pb-3 mb-2.5 bg-[#E8EFF7]/[0.055] border border-[#E8EFF7]/10"
              >
                <div className="flex items-baseline gap-2.5">
                  {day.dayTitle && <div className="font-medium text-[15px]">{day.dayTitle}</div>}
                  <div className="ml-auto text-[11.5px] font-medium tabular text-[#E8EFF7]/45" style={{ fontFamily: MONO }}>
                    {formatDotDate(day.dayDate)} {formatDow(day.dayDate)}
                  </div>
                </div>
                <div className="mt-2.5">
                  {day.items.map((it, j) => (
                    <div key={j} className="flex gap-3 py-1.5">
                      {it.time && (
                        <div className="w-11 flex-shrink-0 text-[12.5px] font-medium tabular text-[#7FD4FF] pt-px" style={{ fontFamily: MONO }}>
                          {it.time}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] leading-snug">{it.title}</div>
                        {it.locationName && <div className="text-[10.5px] text-[#E8EFF7]/45 mt-0.5">{it.locationName}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {showExpense && (
          <div className="mt-2.5 rounded-[20px] px-4 pt-3.5 pb-4 bg-[#E8EFF7]/[0.08] border border-[#E8EFF7]/[0.13]">
            <div className="flex justify-between items-baseline">
              <div className="text-[11px] tracking-[2.4px] text-[#E8EFF7]/50">TOTAL</div>
              <div className="text-[22px] font-medium tabular text-[#8CF0D2]" style={{ fontFamily: MONO }}>
                {formatMoney(data.expenseTotal!)}
              </div>
            </div>
            {!!data.expenseCategories?.length && (
              <div className="mt-2.5">
                {data.expenseCategories.map((c) => (
                  <div key={c.name} className="flex justify-between py-1 text-[11.5px] border-b border-[#E8EFF7]/[0.08] last:border-b-0">
                    <span className="text-[#E8EFF7]/60">{c.name}</span>
                    <span className="font-medium tabular" style={{ fontFamily: MONO }}>{formatMoney(c.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 text-center text-[10.5px] tracking-[2.4px] text-[#E8EFF7]/40">用「旅记」记录 · 分享</div>
          </div>
        )}
      </div>
    </div>
  )
}
