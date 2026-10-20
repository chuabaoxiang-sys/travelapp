import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation, Trans } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Check, X, Pencil, Archive, ArchiveRestore, Trash2, Plus } from 'lucide-react'
import {
  getAllRateBookEntries,
  updateRateBookEntry,
  archiveRateBookEntry,
  unarchiveRateBookEntry,
  deleteRateBookEntry,
  createRateBookEntry,
  usageByEntry,
  deriveRateFromExchangeAmounts,
  tripBlendedRates,
  type RateEntryUsage,
} from '../../domain/rates'
import { fetchReferenceRate } from '../../api/fx'
import { ExchangeAmountFields } from './ExchangeAmountFields'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { CenteredModal } from '../../components/CenteredModal'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import type { Trip, RateBookEntry } from '../../types'

// 综合汇率的展示精度——跟单条汇率簿条目的rate字段不一样（那个直接原样显示）。
// 这个是加权算出来的浮点数，实测发现4位小数不够看：0.0296/0.0301/算出来的0.0300
// 这种量级的汇率，4位小数会把三个不同的数字全部显示成"0.03"，用户完全看不出
// 综合汇率跟单条汇率的差别在哪。改成7位（跟ExchangeAmountFields推导汇率时的
// 精度一致），再去掉计算噪音带出的多余尾零
function formatRateAmount(rate: number): string {
  return String(Math.round(rate * 1e7) / 1e7)
}

// 对比条封顶的范围——超出±15%就贴在最边上，不会把条拉爆
const GAUGE_RANGE = 15

// 综合汇率这一行的进场动效：数字从0滚动到目标值，跟市场价的对比条从中点
// （"今天市场价"）滑到实际位置。两个动效都不靠React state每帧重渲染驱动，
// 直接改DOM——同一个技巧SpendBreakdownCard的环形图扫入动效已经在用
// （见那边"双重requestAnimationFrame"的注释），这里照抄：数字滚动本身没有
// "起点"可言，用RAF手动打点；对比条则是先摆到中点这个"看不出移动过"的
// 初始位置，下一帧再改成最终位置，CSS transition才有起点可以过渡
function RateSummaryRow({
  index,
  foreignCurrency,
  blendedRate,
  homeCurrencyPrefix,
  marketRate,
  pct,
  lower,
  known,
  t,
}: {
  index: number
  foreignCurrency: string
  blendedRate: number
  homeCurrencyPrefix: string
  marketRate: number | null
  pct: number | null
  lower: boolean
  known: boolean
  t: TFunction
}) {
  const numRef = useRef<HTMLSpanElement>(null)
  const pctRef = useRef<HTMLSpanElement>(null)
  const dotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = numRef.current
    if (!el) return
    const start = performance.now()
    const duration = 900
    let raf = 0
    function tick(now: number) {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - progress) ** 3
      el!.textContent = formatRateAmount(blendedRate * eased)
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blendedRate])

  // 百分比跟综合汇率数字同一套滚动动效——之前只有汇率本身会动，百分比是
  // 直接蹦出来的，跟旁边正在滚动的数字放在一起看很突兀
  useEffect(() => {
    if (pct == null) return
    const target = pct
    const el = pctRef.current
    if (!el) return
    const start = performance.now()
    const duration = 900
    let raf = 0
    function tick(now: number) {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - progress) ** 3
      el!.textContent = (target * eased).toFixed(1)
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pct])

  useEffect(() => {
    if (pct == null) return
    const dot = dotRef.current
    if (!dot) return
    const signed = lower ? -pct : pct
    const clamped = Math.max(-GAUGE_RANGE, Math.min(GAUGE_RANGE, signed))
    const pos = `${50 + (clamped / GAUGE_RANGE) * 44}%`
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        dot.style.left = pos
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [pct, lower])

  return (
    <div className={`${index > 0 ? 'pt-3 mt-3 border-t border-dashed border-line' : ''}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-serif-sc text-[13.5px] tabular">
          {t('rateBook.summary.ratePrefix', { currency: foreignCurrency, prefix: homeCurrencyPrefix })}
          <span ref={numRef} />
        </span>
        {pct != null && (
          <span className={`text-[11px] font-semibold flex-shrink-0 tabular ${lower ? 'text-positive' : 'text-negative'}`}>
            {t(lower ? 'rateBook.summary.lowerThanMarketPrefix' : 'rateBook.summary.higherThanMarketPrefix')}
            <span ref={pctRef} />
            {t(lower ? 'rateBook.summary.lowerThanMarketSuffix' : 'rateBook.summary.higherThanMarketSuffix')}
          </span>
        )}
        {pct == null && !known && (
          <span className="text-[11px] text-muted flex-shrink-0">{t('rateBook.summary.checkingMarket')}</span>
        )}
      </div>
      {pct != null && marketRate != null && (
        <div className="text-[10.5px] text-muted mt-1 tabular">
          {t('rateBook.summary.marketRate', { prefix: homeCurrencyPrefix, rate: formatRateAmount(marketRate) })}
        </div>
      )}
      {pct != null && (
        <div className="mt-2.5">
          <div
            className="relative h-[5px] rounded-full mx-[3px]"
            style={{
              background:
                'linear-gradient(90deg, color-mix(in srgb, var(--color-positive) 55%, transparent), var(--color-line) 47%, var(--color-line) 53%, color-mix(in srgb, var(--color-negative) 55%, transparent))',
            }}
          >
            <div className="absolute -top-1 left-1/2 w-0.5 h-3.5 bg-muted rounded-full -translate-x-1/2" />
            <div
              ref={dotRef}
              className="absolute top-1/2 w-[13px] h-[13px] rounded-full border-2 border-card shadow -translate-x-1/2 -translate-y-1/2 transition-[left] duration-[1100ms] ease-out"
              style={{ left: '50%', background: lower ? 'var(--color-positive)' : 'var(--color-negative)' }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-[9.5px] text-muted">
            <span>{t('rateBook.summary.gaugeBetter')}</span>
            <span>{t('rateBook.summary.gaugeMarket')}</span>
            <span>{t('rateBook.summary.gaugeWorse')}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export function RateBookScreen({
  trip,
  currentMemberId,
  onClose,
}: {
  trip: Trip
  currentMemberId: string
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const entries = useLiveQuery(() => getAllRateBookEntries(trip.id), [trip.id]) ?? []
  const active = entries.filter((e) => !e.archived)
  const archived = entries.filter((e) => e.archived)
  const usageMap = useLiveQuery(() => usageByEntry(trip.id), [trip.id]) ?? new Map<string, RateEntryUsage>()
  const blended = useLiveQuery(() => tripBlendedRates(trip.id), [trip.id]) ?? []

  // 市场参考价是网络请求，跟useLiveQuery那套Dexie响应式机制不是一回事——按币种缓存，
  // 币种集合没变就不重新查，避免每次Dexie数据变动（哪怕跟汇率无关）都重新打一次API
  const [referenceRates, setReferenceRates] = useState<Record<string, number | null>>({})
  const blendedCurrencyKey = blended.map((b) => b.foreignCurrency).join(',')
  useEffect(() => {
    let cancelled = false
    for (const b of blended) {
      if (b.foreignCurrency in referenceRates) continue
      fetchReferenceRate(b.foreignCurrency, trip.homeCurrency).then((rate) => {
        if (!cancelled) setReferenceRates((prev) => ({ ...prev, [b.foreignCurrency]: rate }))
      })
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blendedCurrencyKey, trip.homeCurrency])

  const byCurrency = new Map<string, RateBookEntry[]>()
  for (const e of active) {
    if (!byCurrency.has(e.foreignCurrency)) byCurrency.set(e.foreignCurrency, [])
    byCurrency.get(e.foreignCurrency)!.push(e)
  }

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editLabel, setEditLabel] = useState('')
  const [editExchangeHome, setEditExchangeHome] = useState('')
  const [editExchangeForeign, setEditExchangeForeign] = useState('')
  const [saveAsNewFor, setSaveAsNewFor] = useState<RateBookEntry | null>(null)
  const [newLabelValue, setNewLabelValue] = useState('')
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [addCurrency, setAddCurrency] = useState('')
  const [addLabel, setAddLabel] = useState('')
  const [addRate, setAddRate] = useState('')
  const [addExchangeHome, setAddExchangeHome] = useState('')
  const [addExchangeForeign, setAddExchangeForeign] = useState('')

  // 三个嵌套弹层（confirmArchiveId 的 ConfirmDialog、saveAsNewFor/addOpen 的
  // CenteredModal）打开时暂停这里自己的Escape监听，避免一键关掉两层
  useEscapeKey(!confirmArchiveId && !confirmDeleteId && !saveAsNewFor && !addOpen, onClose)

  function openAddModal() {
    setAddCurrency('')
    setAddLabel('')
    setAddRate('')
    setAddExchangeHome('')
    setAddExchangeForeign('')
    setAddOpen(true)
  }

  function onAddExchangeChange(home: string, foreign: string) {
    setAddExchangeHome(home)
    setAddExchangeForeign(foreign)
    const derived = deriveRateFromExchangeAmounts(home, foreign)
    // 7位小数——像日元这种面额大的币种，汇率小数点后差一点点，摊到大金额上
    // 就是实打实的钱，4位不够精确
    if (derived != null) setAddRate(derived.toFixed(7))
  }

  async function confirmAdd() {
    const r = parseFloat(addRate)
    if (!addCurrency.trim() || !addLabel.trim() || !(r > 0)) return
    const home = parseFloat(addExchangeHome)
    const foreign = parseFloat(addExchangeForeign)
    await createRateBookEntry({
      tripId: trip.id,
      foreignCurrency: addCurrency.trim().toUpperCase(),
      label: addLabel.trim(),
      rate: r,
      source: 'manual',
      createdBy: currentMemberId,
      exchangedHomeAmount: home > 0 ? home : null,
      exchangedForeignAmount: foreign > 0 ? foreign : null,
    })
    setAddOpen(false)
  }

  function startEdit(e: RateBookEntry) {
    setEditingId(e.id)
    setEditValue(String(e.rate))
    setEditLabel(e.label)
    setEditExchangeHome(e.exchangedHomeAmount != null ? String(e.exchangedHomeAmount) : '')
    setEditExchangeForeign(e.exchangedForeignAmount != null ? String(e.exchangedForeignAmount) : '')
  }

  function onEditExchangeChange(home: string, foreign: string) {
    setEditExchangeHome(home)
    setEditExchangeForeign(foreign)
    const derived = deriveRateFromExchangeAmounts(home, foreign)
    if (derived != null) setEditValue(derived.toFixed(7))
  }

  async function saveEdit(e: RateBookEntry) {
    const r = parseFloat(editValue)
    if (!(r > 0) || !editLabel.trim()) return
    const home = parseFloat(editExchangeHome)
    const foreign = parseFloat(editExchangeForeign)
    await updateRateBookEntry(e.id, {
      rate: r,
      label: editLabel.trim(),
      exchangedHomeAmount: home > 0 ? home : null,
      exchangedForeignAmount: foreign > 0 ? foreign : null,
    })
    setEditingId(null)
  }

  function startSaveAsNew(e: RateBookEntry) {
    setSaveAsNewFor(e)
    setNewLabelValue(t('rateBook.newLabelSuffix', { label: e.label }))
  }

  async function confirmSaveAsNew() {
    if (!saveAsNewFor) return
    const r = parseFloat(editValue)
    if (!r || !newLabelValue.trim()) return
    const home = parseFloat(editExchangeHome)
    const foreign = parseFloat(editExchangeForeign)
    await createRateBookEntry({
      tripId: trip.id,
      foreignCurrency: saveAsNewFor.foreignCurrency,
      label: newLabelValue.trim(),
      rate: r,
      source: 'manual',
      createdBy: currentMemberId,
      exchangedHomeAmount: home > 0 ? home : null,
      exchangedForeignAmount: foreign > 0 ? foreign : null,
    })
    setSaveAsNewFor(null)
    setEditingId(null)
  }

  return (
    <div className="absolute inset-0 z-30 bg-paper flex flex-col">
      <div className="flex items-center justify-between px-5 pt-4 pb-2 flex-shrink-0 border-b border-line">
        <span className="font-serif-sc text-[15px] font-semibold">{t('rateBook.title')}</span>
        <button onClick={onClose} className="text-muted" title={t('rateBook.close')}>
          <X className="w-[15px] h-[15px]" strokeWidth={1.8} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-3">
        {byCurrency.size === 0 && (
          <div className="text-[13px] text-muted py-8 text-center">
            {t('rateBook.empty')}
          </div>
        )}

        {blended.length > 0 && (
          <div className="bg-card border border-line rounded-2xl p-4 mb-4.5">
            <div className="text-[13.5px] font-semibold">{t('rateBook.summary.title')}</div>
            <div className="text-[10.5px] text-muted mt-0.5 leading-relaxed">{t('rateBook.summary.subtitle')}</div>
            <div className="mt-3 flex flex-col">
              {blended.map((b, i) => {
                const ref = referenceRates[b.foreignCurrency]
                const known = b.foreignCurrency in referenceRates
                const pct = ref != null && ref > 0 ? (Math.abs(b.blendedRate - ref) / ref) * 100 : null
                const lower = ref != null && b.blendedRate < ref
                return (
                  <RateSummaryRow
                    key={b.foreignCurrency}
                    index={i}
                    foreignCurrency={b.foreignCurrency}
                    blendedRate={b.blendedRate}
                    homeCurrencyPrefix={trip.homeCurrency === 'MYR' ? 'RM' : trip.homeCurrency}
                    marketRate={ref ?? null}
                    pct={pct}
                    lower={lower}
                    known={known}
                    t={t}
                  />
                )
              })}
            </div>
          </div>
        )}

        {[...byCurrency.entries()].map(([currency, list]) => (
          <div key={currency} className="mb-5">
            <div className="text-[10.5px] tracking-widest uppercase text-muted mb-2">
              {currency} → {trip.homeCurrency}
            </div>
            <div className="flex flex-col gap-2">
              {list
                .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
                .map((e) => {
                  const usageCount = usageMap.get(e.id)?.count ?? 0
                  return (
                  <div key={e.id} className="bg-card border border-line rounded-2xl p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {editingId === e.id ? (
                          <input
                            value={editLabel}
                            onChange={(ev) => setEditLabel(ev.target.value)}
                            className="w-full rounded-lg border border-plan bg-paper px-2 py-1 text-[14px] font-serif-sc font-semibold outline-none"
                          />
                        ) : (
                          <div className="font-serif-sc text-[14px] font-semibold truncate">{e.label}</div>
                        )}
                        {/* 日期格式跟着当前语言走——之前写死了'zh-CN'，英文界面下
                            也会显示成中式的 2026/9/1 */}
                        <div className="text-[11px] text-muted mt-0.5">
                          {t(`rateBook.source.${e.source}`)} ·{' '}
                          {t('rateBook.lastUsed', {
                            date: new Date(e.lastUsedAt).toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'zh-CN'),
                          })}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {editingId === e.id ? (
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(ev) => setEditValue(ev.target.value)}
                            inputMode="decimal"
                            className="w-24 rounded-lg border border-plan bg-paper px-2 py-1 text-right text-[15px] font-serif-sc tabular outline-none"
                          />
                        ) : (
                          <div className="font-serif-sc text-[16px] tabular">{e.rate}</div>
                        )}
                        <div className="text-[10px] text-muted">{t('rateBook.usedTimes', { count: usageCount })}</div>
                      </div>
                    </div>
                    {editingId === e.id && (
                      <div className="mt-2 pt-2 border-t border-dashed border-line">
                        <ExchangeAmountFields
                          homeCurrency={trip.homeCurrency}
                          foreignCurrency={e.foreignCurrency}
                          homeAmount={editExchangeHome}
                          foreignAmount={editExchangeForeign}
                          onChangeHomeAmount={(v) => onEditExchangeChange(v, editExchangeForeign)}
                          onChangeForeignAmount={(v) => onEditExchangeChange(editExchangeHome, v)}
                        />
                      </div>
                    )}
                    {editingId !== e.id && e.exchangedForeignAmount != null && (() => {
                      const used = usageMap.get(e.id)?.foreignAmount ?? 0
                      const total = e.exchangedForeignAmount as number
                      const over = used > total
                      const pct = total > 0 ? (used / total) * 100 : 0
                      return (
                        <>
                          <div className="text-[11px] text-positive mt-2 pt-2 border-t border-dashed border-line flex items-center gap-1.5">
                            <Check className="w-3 h-3 flex-shrink-0" strokeWidth={2.5} />
                            {t('rateBook.exchanged', {
                              homeAmount: e.exchangedHomeAmount,
                              homeCurrency: trip.homeCurrency,
                              foreignAmount: e.exchangedForeignAmount.toLocaleString(),
                              foreignCurrency: e.foreignCurrency,
                            })}
                          </div>
                          <div className={`flex items-baseline justify-between text-[10.5px] mt-1.5 ${over ? 'text-negative' : 'text-muted'}`}>
                            {/* 用Trans而不是t()：这句里"已用多少"那个数字本来是加粗的
                                （整行的重点就是它），纯t()返回字符串没法保留行内标签，
                                会把设计上的强调弄丢 */}
                            <span>
                              <Trans
                                i18nKey="rateBook.usedOfExchanged"
                                values={{
                                  used: used.toLocaleString(),
                                  total: total.toLocaleString(),
                                  currency: e.foreignCurrency,
                                }}
                                components={{
                                  b: <b className={over ? 'text-negative font-semibold' : 'text-ink font-semibold'} />,
                                }}
                              />
                            </span>
                            <span>
                              {over
                                ? t('rateBook.overBy', { amount: (used - total).toLocaleString() })
                                : t('rateBook.remaining', { amount: (total - used).toLocaleString() })}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-line overflow-hidden mt-1">
                            <div
                              className="bar-fill h-full rounded-full"
                              style={{ width: `${Math.min(100, pct)}%`, background: over ? 'var(--color-negative)' : 'var(--color-positive)' }}
                            />
                          </div>
                        </>
                      )
                    })()}
                    <div className="flex gap-2 mt-2.5">
                      {editingId === e.id ? (
                        <>
                          <button onClick={() => setEditingId(null)} className="text-muted px-2 py-1" title={t('rateBook.cancel')}>
                            <X className="w-3.5 h-3.5" strokeWidth={1.8} />
                          </button>
                          <button onClick={() => startSaveAsNew(e)} className="text-[11px] text-plan px-2 py-1">{t('rateBook.saveAsNew')}</button>
                          <button onClick={() => saveEdit(e)} className="bg-plan text-card rounded-md px-2.5 py-1 ml-auto" title={t('rateBook.save')}>
                            <Check className="w-3.5 h-3.5" strokeWidth={2} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(e)} className="text-plan px-2 py-1 border border-dashed border-plan/50 rounded-md" title={t('rateBook.edit')}>
                            <Pencil className="w-3.5 h-3.5" strokeWidth={1.8} />
                          </button>
                          {usageCount === 0 ? (
                            <button onClick={() => setConfirmDeleteId(e.id)} className="text-negative px-2 py-1 border border-dashed border-negative/40 rounded-md" title={t('rateBook.delete')}>
                              <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
                            </button>
                          ) : (
                            <button onClick={() => setConfirmArchiveId(e.id)} className="text-muted px-2 py-1 border border-dashed border-line rounded-md" title={t('rateBook.archive')}>
                              <Archive className="w-3.5 h-3.5" strokeWidth={1.8} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  )
                })}
            </div>
          </div>
        ))}

        {archived.length > 0 && (
          <div className="mt-2">
            <button onClick={() => setShowArchived((v) => !v)} className="text-[11.5px] text-muted">
              {showArchived
                ? t('rateBook.collapseArchived')
                : t('rateBook.viewArchived', { count: archived.length })}
            </button>
            {showArchived && (
              <div className="flex flex-col gap-2 mt-2">
                {archived.map((e) => (
                  <div key={e.id} className="bg-card border border-line rounded-2xl p-3 opacity-60 flex items-center justify-between">
                    <div>
                      <div className="text-[13px] font-medium">{e.label} · {e.foreignCurrency}</div>
                      <div className="text-[11px] text-muted">{e.rate}</div>
                    </div>
                    <button onClick={() => unarchiveRateBookEntry(e.id)} className="text-plan" title={t('rateBook.restore')}>
                      <ArchiveRestore className="w-[15px] h-[15px]" strokeWidth={1.8} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="text-[11px] text-muted mt-4 pb-6">
          {t('rateBook.footnote')}
        </div>
      </div>

      <button
        onClick={openAddModal}
        title={t('rateBook.add')}
        className="absolute bottom-5 right-5 w-[46px] h-[46px] rounded-full bg-plan text-card flex items-center justify-center transition-transform active:scale-95"
        style={{ boxShadow: '0 8px 18px color-mix(in srgb, var(--color-plan) 40%, transparent)' }}
      >
        <Plus className="w-6 h-6" strokeWidth={2.4} />
      </button>

      {confirmArchiveId && (
        <ConfirmDialog
          title={t('rateBook.archiveConfirmTitle')}
          message={t('rateBook.archiveConfirmMessage')}
          confirmLabel={t('rateBook.archive')}
          danger={false}
          onConfirm={() => { archiveRateBookEntry(confirmArchiveId); setConfirmArchiveId(null) }}
          onCancel={() => setConfirmArchiveId(null)}
        />
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          title={t('rateBook.deleteConfirmTitle')}
          message={t('rateBook.deleteConfirmMessage')}
          confirmLabel={t('rateBook.delete')}
          onConfirm={() => { deleteRateBookEntry(confirmDeleteId); setConfirmDeleteId(null) }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}

      {saveAsNewFor && (
        <CenteredModal onClose={() => setSaveAsNewFor(null)}>
          <div className="font-serif-sc text-[15px] text-ink mb-3">{t('rateBook.saveAsNew')}</div>
          <input
            autoFocus
            value={newLabelValue}
            onChange={(e) => setNewLabelValue(e.target.value)}
            placeholder={t('rateBook.newLabelPlaceholder')}
            className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-plan"
          />
          <div className="flex gap-2 mt-4">
            <button onClick={() => setSaveAsNewFor(null)} className="flex-1 rounded-xl border border-line py-2 text-muted flex items-center justify-center" title={t('rateBook.cancel')}>
              <X className="w-4 h-4" strokeWidth={1.8} />
            </button>
            <button onClick={confirmSaveAsNew} className="flex-1 rounded-xl bg-plan text-card py-2 flex items-center justify-center" title={t('rateBook.save')}>
              <Check className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>
        </CenteredModal>
      )}

      {addOpen && (
        <CenteredModal onClose={() => setAddOpen(false)}>
          <div className="font-serif-sc text-[15px] text-ink mb-3">{t('rateBook.addTitle')}</div>
          <div className="flex gap-2 mb-2.5">
            <div className="flex-1">
              <div className="text-[10px] tracking-widest uppercase text-muted mb-1">{t('rateBook.currencyLabel')}</div>
              <input
                autoFocus
                value={addCurrency}
                onChange={(e) => setAddCurrency(e.target.value.toUpperCase())}
                placeholder={t('rateBook.currencyPlaceholder')}
                className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm tabular outline-none focus:border-plan"
              />
            </div>
            <div className="flex-1">
              <div className="text-[10px] tracking-widest uppercase text-muted mb-1">{t('rateBook.rateLabel')}</div>
              <input
                value={addRate}
                onChange={(e) => setAddRate(e.target.value)}
                inputMode="decimal"
                placeholder={t('rateBook.ratePlaceholder')}
                className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm tabular outline-none focus:border-plan"
              />
            </div>
          </div>
          <div className="mb-2.5">
            <div className="text-[10px] tracking-widest uppercase text-muted mb-1">{t('rateBook.labelLabel')}</div>
            <input
              value={addLabel}
              onChange={(e) => setAddLabel(e.target.value)}
              placeholder={t('rateBook.labelPlaceholder')}
              className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-plan"
            />
          </div>
          <ExchangeAmountFields
            homeCurrency={trip.homeCurrency}
            foreignCurrency={addCurrency || t('rateBook.foreignCurrencyFallback')}
            homeAmount={addExchangeHome}
            foreignAmount={addExchangeForeign}
            onChangeHomeAmount={(v) => onAddExchangeChange(v, addExchangeForeign)}
            onChangeForeignAmount={(v) => onAddExchangeChange(addExchangeHome, v)}
          />
          <div className="flex gap-2 mt-2">
            <button onClick={() => setAddOpen(false)} className="flex-1 rounded-xl border border-line py-2 text-muted flex items-center justify-center" title={t('rateBook.cancel')}>
              <X className="w-4 h-4" strokeWidth={1.8} />
            </button>
            <button onClick={confirmAdd} className="flex-1 rounded-xl bg-plan text-card py-2 flex items-center justify-center" title={t('rateBook.save')}>
              <Check className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>
        </CenteredModal>
      )}
    </div>
  )
}
