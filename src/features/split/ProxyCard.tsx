import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { Gift, Check, ChevronDown, ChevronUp, Undo2 } from 'lucide-react'
import { db } from '../../db/dexie'
import { formatMoney } from '../../lib/money'
import { toLocalDateString } from '../../lib/dates'
import { groupProxyItems, setProxyRepaid, toProxyItems, type ProxyGroup } from '../../domain/proxies'
import type { ExpenseSplit, Member, Trip } from '../../types'

// 代购清单（2026-11-07）：帮没来旅行的人买的东西，按人汇总，结束后一次标已还。
// 这些人不是团队成员、也不用这个APP，所以跟上面"结算建议"（同行者之间谁欠谁）
// 分开一张卡——钱是付款人跟他们之间的事
function md(date: string) {
  return date.slice(5).replace('-', '/')
}

function Initial({ name, size = 26 }: { name: string; size?: number }) {
  return (
    <span
      className="rounded-full flex items-center justify-center bg-segment text-soft font-serif-sc flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.46 }}
    >
      {name.slice(0, 1)}
    </span>
  )
}

export function ProxyCard({ trip, members }: { trip: Trip; members: Member[] }) {
  const { t } = useTranslation()
  const expenses = (useLiveQuery(() => db.expenses.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []).filter((e) => !e.deletedAt)
  const expenseIds = expenses.map((e) => e.id)
  const splits = useLiveQuery(
    () => (expenseIds.length ? db.expenseSplits.where('expenseId').anyOf(expenseIds).toArray() : Promise.resolve<ExpenseSplit[]>([])),
    [expenseIds.join(',')],
  ) ?? []
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const items = toProxyItems(expenses, splits)
  if (!items.length) return null
  const { unpaid, repaid } = groupProxyItems(items)
  const unpaidTotal = unpaid.reduce((s, g) => s + g.total, 0)
  const nameOf = (id: string) => members.find((m) => m.id === id)?.displayName ?? t('split.unknownMember')

  async function mark(group: ProxyGroup, repaidAt: number | null) {
    if (busy) return
    setBusy(true)
    try {
      await setProxyRepaid(group.items.map((it) => it.splitId), repaidAt)
    } finally {
      setBusy(false)
    }
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="bg-card border border-line rounded-2xl p-4 mb-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] tracking-widest uppercase text-muted flex items-center gap-1.5">
          <Gift className="w-[13px] h-[13px] text-plan" strokeWidth={1.8} />
          {t('split.proxy.heading')}
        </div>
        {unpaidTotal > 0 && <div className="text-[10.5px] text-muted">{t('split.proxy.unpaidTotal', { amount: formatMoney(unpaidTotal) })}</div>}
      </div>

      {unpaid.length > 0 && (
        <div className="flex flex-col gap-2.5 mt-3">
          {unpaid.map((g) => {
            const open = expanded.has(g.key)
            const first = g.items[0].expenseDate
            const last = g.items[g.items.length - 1].expenseDate
            const range = first === last ? md(first) : `${md(first)} – ${md(last)}`
            return (
              <div key={g.key} className="border border-line rounded-xl p-2.5">
                <div className="flex items-center gap-2.5">
                  <Initial name={g.name} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate">{g.name}</div>
                    <div className="text-[11px] text-muted truncate">
                      {t('split.proxy.meta', { count: g.items.length, range, name: nameOf(g.creditorId) })}
                    </div>
                  </div>
                  <span className="font-serif-sc text-[16px] tabular">{formatMoney(g.total)}</span>
                  <button
                    type="button"
                    onClick={() => toggle(g.key)}
                    className="w-8 h-8 flex items-center justify-center text-muted"
                    title={open ? t('split.proxy.collapse') : t('split.proxy.expand')}
                    aria-label={open ? t('split.proxy.collapse') : t('split.proxy.expand')}
                  >
                    {open ? <ChevronUp className="w-4 h-4" strokeWidth={2} /> : <ChevronDown className="w-4 h-4" strokeWidth={2} />}
                  </button>
                </div>
                {open && (
                  <div className="mt-2 ml-9 flex flex-col gap-1.5 text-[11.5px] tabular">
                    {g.items.map((it) => (
                      <div key={it.splitId} className="flex justify-between gap-2">
                        <span className="text-soft truncate">
                          {md(it.expenseDate)} {it.description || t('split.untitledExpense')} · {it.currency} {it.amount.toLocaleString()}
                        </span>
                        <span className="flex-shrink-0">{formatMoney(it.shareAmount)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => mark(g, Date.now())}
                  className="w-full mt-2.5 rounded-full py-1.5 text-[12px] font-medium bg-plan text-card flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  <Check className="w-3.5 h-3.5" strokeWidth={2} />
                  {t('split.proxy.markRepaid', { name: g.name })}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {repaid.length > 0 && (
        <>
          <div className="text-[10.5px] tracking-widest uppercase text-muted mt-3.5">{t('split.proxy.repaidHeading')}</div>
          <div className="flex flex-col gap-1 mt-1.5">
            {repaid.map((g) => (
              <div key={g.key} className="flex items-center gap-2.5">
                <Initial name={g.name} size={22} />
                <span className="flex-1 min-w-0 truncate text-[12.5px] text-soft">
                  {t('split.proxy.repaidLine', { name: g.name, date: md(toLocalDateString(new Date(g.repaidAt ?? 0))) })}
                </span>
                <span className="text-[12.5px] text-positive tabular">{formatMoney(g.total)}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => mark(g, null)}
                  className="w-8 h-8 flex items-center justify-center text-muted disabled:opacity-60"
                  title={t('split.proxy.undo')}
                  aria-label={t('split.proxy.undo')}
                >
                  <Undo2 className="w-4 h-4" strokeWidth={1.8} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
