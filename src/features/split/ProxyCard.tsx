import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { Gift, Check, ChevronDown, ChevronUp, Undo2 } from 'lucide-react'
import { db } from '../../db/dexie'
import { formatMoney, round2 } from '../../lib/money'
import { toLocalDateString } from '../../lib/dates'
import { BottomSheet } from '../../components/BottomSheet'
import { Avatar } from '../../components/Avatar'
import { groupOwed, groupProxyItems, setProxyGift, setProxyRepaid, toProxyItems, type ProxyGroup } from '../../domain/proxies'
import { giftShares, isProxySplit } from '../../domain/splits'
import type { ExpenseSplit, Member, Trip } from '../../types'

// 代购清单（2026-11-07）：帮没来旅行的人买的东西，按人汇总，结束后一次标已还。
// 这些人不是团队成员、也不用这个APP，所以跟上面"结算建议"（同行者之间谁欠谁）
// 分开一张卡——钱是付款人跟他们之间的事。
// 2026-11-08（0052）：标已还时可以填实际还了多少（多还少还都算还清，差额只归付款人）；
// 也可以「送给他/她」——不用还，成本由选中的同行者平分
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
  const [repayFor, setRepayFor] = useState<ProxyGroup | null>(null)
  const [repayInput, setRepayInput] = useState('')
  const [giftFor, setGiftFor] = useState<ProxyGroup | null>(null)
  const [giftMembers, setGiftMembers] = useState<string[]>([])

  const items = toProxyItems(expenses, splits)
  if (!items.length) return null
  const { unpaid, repaid, gifted } = groupProxyItems(items)
  const unpaidTotal = unpaid.reduce((s, g) => s + g.total, 0)
  const nameOf = (id: string) => members.find((m) => m.id === id)?.displayName ?? t('split.unknownMember')
  // 这趟真的参与了账目的同行者（付过钱或分摊过）——送礼时可选、默认全勾
  const travelerIds = [...new Set([
    ...expenses.map((e) => e.paidBy),
    ...splits.filter((s) => !s.deletedAt && !isProxySplit(s)).map((s) => s.memberId),
  ])].filter((id) => members.some((m) => m.id === id))

  async function run(fn: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    try {
      await fn()
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

  function openRepay(g: ProxyGroup) {
    setRepayFor(g)
    setRepayInput(groupOwed(g).toFixed(2))
  }
  function openGift(g: ProxyGroup) {
    setGiftFor(g)
    setGiftMembers(travelerIds)
  }

  const repayOwed = repayFor ? groupOwed(repayFor) : 0
  const repayActual = parseFloat(repayInput)
  const repayDiff = Number.isFinite(repayActual) ? round2(repayActual - repayOwed) : 0
  const giftCost = giftFor ? round2(giftFor.items.reduce((s, it) => s + it.costAmount, 0)) : 0
  const giftEach = giftMembers.length ? giftShares({ shareAmount: giftCost, proxyGiftMemberIds: giftMembers }) : []

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
                <div className="flex gap-2 mt-2.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => openRepay(g)}
                    className="flex-1 rounded-full py-1.5 text-[12px] font-medium bg-plan text-card flex items-center justify-center gap-1.5 disabled:opacity-60"
                  >
                    <Check className="w-3.5 h-3.5" strokeWidth={2} />
                    {t('split.proxy.markRepaid', { name: g.name })}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => openGift(g)}
                    className="rounded-full px-3.5 py-1.5 text-[12px] font-medium border border-plan text-plan bg-card flex items-center gap-1.5 disabled:opacity-60"
                  >
                    <Gift className="w-3.5 h-3.5" strokeWidth={1.8} />
                    {t('split.proxy.giftButton')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {repaid.length > 0 && (
        <>
          <div className="text-[10.5px] tracking-widest uppercase text-muted mt-3.5">{t('split.proxy.repaidHeading')}</div>
          <div className="flex flex-col gap-1.5 mt-1.5">
            {repaid.map((g) => {
              const diff = round2(g.total - groupOwed(g))
              return (
                <div key={g.key} className="flex items-center gap-2.5">
                  <Initial name={g.name} size={22} />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-[12.5px] text-soft">
                      {t('split.proxy.repaidLine', { name: g.name, date: md(toLocalDateString(new Date(g.repaidAt ?? 0))) })}
                    </span>
                    {Math.abs(diff) >= 0.005 && (
                      <span className={`block text-[11px] tabular ${diff > 0 ? 'text-positive' : 'text-negative'}`}>
                        {t(diff > 0 ? 'split.proxy.overpaid' : 'split.proxy.underpaid', { owed: formatMoney(groupOwed(g)), amount: formatMoney(Math.abs(diff)) })}
                      </span>
                    )}
                  </span>
                  <span className="text-[12.5px] text-positive tabular">{formatMoney(g.total)}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => setProxyRepaid(g.items.map((it) => it.splitId), null))}
                    className="w-8 h-8 flex items-center justify-center text-muted disabled:opacity-60"
                    title={t('split.proxy.undo')}
                    aria-label={t('split.proxy.undo')}
                  >
                    <Undo2 className="w-4 h-4" strokeWidth={1.8} />
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}

      {gifted.length > 0 && (
        <>
          <div className="text-[10.5px] tracking-widest uppercase text-muted mt-3.5">{t('split.proxy.giftedHeading')}</div>
          <div className="flex flex-col gap-1.5 mt-1.5">
            {gifted.map((g) => (
              <div key={g.key} className="flex items-center gap-2.5">
                <Gift className="w-[18px] h-[18px] text-plan flex-shrink-0" strokeWidth={1.8} />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[12.5px] text-soft">{g.name}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {t('split.proxy.giftedLine', { count: g.items.length, names: (g.items[0].giftMemberIds ?? []).map(nameOf).join('、') })}
                  </span>
                </span>
                <span className="text-[12.5px] tabular">{formatMoney(g.total)}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => setProxyGift(g.items.map((it) => it.splitId), null))}
                  className="w-8 h-8 flex items-center justify-center text-muted disabled:opacity-60"
                  title={t('split.proxy.undoGift')}
                  aria-label={t('split.proxy.undoGift')}
                >
                  <Undo2 className="w-4 h-4" strokeWidth={1.8} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {repayFor && (
        <BottomSheet onClose={() => setRepayFor(null)} cardClassName="px-5 pt-3.5 pb-5 flex flex-col gap-3">
          <div className="w-[38px] h-1 rounded-full bg-handle mx-auto flex-shrink-0" />
          <h2 className="font-serif-sc text-[15px] font-semibold">{t('split.proxy.repayTitle', { name: repayFor.name })}</h2>
          <div className="text-[12px] text-muted">{t('split.proxy.repayOwed', { amount: formatMoney(repayOwed), count: repayFor.items.length })}</div>
          <label className="flex items-center gap-2 rounded-xl border-[1.5px] border-plan bg-card px-3 py-2.5">
            <span className="text-[13px] text-muted">RM</span>
            <input
              autoFocus
              value={repayInput}
              onChange={(e) => setRepayInput(e.target.value)}
              inputMode="decimal"
              className="flex-1 min-w-0 bg-transparent text-[20px] font-bold tabular outline-none"
            />
          </label>
          {Number.isFinite(repayActual) && Math.abs(repayDiff) >= 0.005 && (
            <div className={`rounded-xl px-3 py-2 text-[12px] leading-relaxed ${repayDiff > 0 ? 'bg-positive/[.07] text-soft' : 'bg-spend/10 text-spend-text'}`}>
              {repayDiff > 0
                ? t('split.proxy.repayOverHint', { amount: formatMoney(repayDiff), name: nameOf(repayFor.creditorId) })
                : t('split.proxy.repayUnderHint', { amount: formatMoney(-repayDiff), name: nameOf(repayFor.creditorId) })}
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => setRepayFor(null)} className="flex-1 min-h-[44px] rounded-full border border-line bg-card text-soft text-[13px]">
              {t('split.proxy.cancel')}
            </button>
            <button
              type="button"
              disabled={busy || !Number.isFinite(repayActual) || repayActual < 0}
              onClick={() => {
                const g = repayFor
                const actual = round2(repayActual)
                setRepayFor(null)
                run(() => setProxyRepaid(g.items.map((it) => it.splitId), Date.now(), Math.abs(actual - groupOwed(g)) < 0.005 ? null : actual))
              }}
              className="flex-[2] min-h-[44px] rounded-full bg-plan text-card text-[13px] font-semibold disabled:opacity-60"
            >
              {t('split.proxy.repayConfirm')}
            </button>
          </div>
        </BottomSheet>
      )}

      {giftFor && (
        <BottomSheet onClose={() => setGiftFor(null)} cardClassName="px-5 pt-3.5 pb-5 flex flex-col gap-3">
          <div className="w-[38px] h-1 rounded-full bg-handle mx-auto flex-shrink-0" />
          <h2 className="font-serif-sc text-[15px] font-semibold">{t('split.proxy.giftTitle', { name: giftFor.name })}</h2>
          <div className="text-[12px] text-soft leading-relaxed">
            {t(Math.abs(giftCost - groupOwed(giftFor)) < 0.005 ? 'split.proxy.giftIntroSame' : 'split.proxy.giftIntro', { count: giftFor.items.length, name: giftFor.name, cost: formatMoney(giftCost), owed: formatMoney(groupOwed(giftFor)) })}
          </div>
          <div className="text-[10.5px] tracking-widest uppercase text-muted">{t('split.proxy.giftWho')}</div>
          <div className="flex flex-wrap gap-2">
            {travelerIds.map((id) => {
              const m = members.find((x) => x.id === id)!
              const on = giftMembers.includes(id)
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setGiftMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
                  className={`flex items-center gap-1.5 rounded-full pl-1.5 pr-3.5 py-1.5 text-[13px] border ${on ? 'bg-plan/10 border-plan text-plan font-medium' : 'bg-card border-line text-soft'}`}
                >
                  <Avatar member={m} size={20} />
                  {m.displayName}
                </button>
              )
            })}
          </div>
          {giftEach.length > 0 && (
            <div className="text-[12.5px] text-soft tabular">
              {t('split.proxy.giftEach', { list: giftEach.map((g) => `${nameOf(g.memberId)} ${formatMoney(g.shareAmount)}`).join(' · ') })}
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => setGiftFor(null)} className="flex-1 min-h-[44px] rounded-full border border-line bg-card text-soft text-[13px]">
              {t('split.proxy.cancel')}
            </button>
            <button
              type="button"
              disabled={busy || !giftMembers.length}
              onClick={() => {
                const g = giftFor
                const ids = giftMembers
                setGiftFor(null)
                run(() => setProxyGift(g.items.map((it) => it.splitId), ids))
              }}
              className="flex-[2] min-h-[44px] rounded-full bg-plan text-card text-[13px] font-semibold disabled:opacity-60"
            >
              {t('split.proxy.giftConfirm', { name: giftFor.name })}
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  )
}
