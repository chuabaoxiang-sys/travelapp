import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Trip } from '../../types'
import { buildRetrospective, type TripRetrospective } from '../../domain/retrospective'
import { formatMoney } from '../../lib/money'

// 旅程回顾的内容本体，不含任何"这是一个可关闭弹层"的外壳——这一段现在是
// 「概览」tab"回家后"形态的正文，跟别的tab内容一样常驻显示，不是弹出来再关掉的东西。
//
// 数字都来自 domain/retrospective.ts，这里只负责画。

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 rounded-full bg-line overflow-hidden">
      {/* 下限 2% 是为了让金额很小的分类也留下一道可见的痕迹，而不是一条看不见的线 */}
      <div className="bar-fill h-full rounded-full" style={{ width: `${Math.min(100, Math.max(2, pct))}%`, background: color }} />
    </div>
  )
}

export function RetrospectiveContent({ trip }: { trip: Trip }) {
  const { t } = useTranslation()
  const [data, setData] = useState<TripRetrospective | null>(null)

  useEffect(() => {
    const todayISO = new Date().toLocaleDateString('sv-SE')
    buildRetrospective(trip.id, todayISO, t).then(setData)
  }, [trip.id, t])

  const currency = trip.homeCurrency === 'MYR' ? 'RM' : trip.homeCurrency
  const money = (n: number) => formatMoney(n, currency)
  const maxCat = data?.categories[0]?.total ?? 0

  if (!data) {
    return <div className="text-[13px] text-muted py-10 text-center">{t('retrospective.loading')}</div>
  }

  if (data.total === 0 && data.itemCount === 0) {
    return (
      <div className="text-[13px] text-muted py-10 text-center leading-relaxed">
        {t('retrospective.empty')}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 主卡：整趟总花费 */}
      <div className="bg-surface-strong rounded-[20px] px-[18px] pt-[18px] pb-4 text-on-dark">
        <div className="text-[11px] tracking-wider text-on-dark/55">{trip.name}</div>
        <div className="font-bold tracking-tight tabular text-[32px] leading-none mt-1.5">{money(data.total)}</div>
        <div className="mt-2.5 text-[11px] text-on-dark/50 leading-relaxed">
          {[
            data.dayCount > 0 ? t('retrospective.summaryDays', { count: data.dayCount }) : null,
            data.memberCount > 0 ? t('retrospective.summaryPeopleAvg', { count: data.memberCount, amount: money(data.perPerson) }) : null,
            data.placeCount > 0 ? t('retrospective.summaryPlaces', { count: data.placeCount }) : null,
          ].filter(Boolean).join(' · ')}
        </div>
      </div>

      {/* 还没结清——放在最前面，因为这是这个APP最不可替代的价值 */}
      {data.unsettledCount > 0 && (
        <div className="rounded-2xl border border-spend/60 bg-spend/[.06] px-3.5 py-3">
          <div className="text-[13px] font-medium text-ink">
            {t('retrospective.unsettledCount', { count: data.unsettledCount })}
          </div>
          <div className="text-[11px] text-muted mt-0.5">
            {t('retrospective.unsettledDetail', { amount: money(data.unsettledTotal) })}
          </div>
        </div>
      )}

      {data.categories.length > 0 && (
        <div>
          <div className="text-[11px] text-muted mb-2">{t('retrospective.whereItWent')}</div>
          <div className="flex flex-col gap-2.5">
            {data.categories.map((c) => (
              <div key={c.name}>
                <div className="flex items-baseline text-[12px] mb-1">
                  <span>{c.name}</span>
                  <span className="ml-auto tabular text-muted">{money(c.total)}</span>
                </div>
                <Bar pct={maxCat > 0 ? (c.total / maxCat) * 100 : 0} color={c.color} />
              </div>
            ))}
          </div>
        </div>
      )}

      {data.topDay && (
        <div className="rounded-2xl border border-line bg-card px-3.5 py-2.5 flex items-center">
          <span className="text-[12.5px]">{t('retrospective.priciestDay')}</span>
          <span className="ml-auto text-[12.5px] tabular">
            {data.topDay.date} · {money(data.topDay.total)}
          </span>
        </div>
      )}

      {data.people.length > 0 && (
        <div>
          <div className="text-[11px] text-muted mb-2">{t('retrospective.byPerson')}</div>
          <div className="flex flex-col gap-1.5">
            {data.people.map((p) => (
              <div key={p.memberName} className="rounded-2xl border border-line bg-card px-3.5 py-2.5 flex items-center">
                <span className="text-[12.5px]">{p.memberName}</span>
                <span className="ml-auto text-[11px] text-muted tabular">
                  {t('retrospective.personLine', { paid: money(p.paid), owed: money(p.owed) })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
