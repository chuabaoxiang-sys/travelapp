import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, Share, Download, X, CircleCheckBig } from 'lucide-react'
import { db } from '../../db/dexie'
import { tripClearState, clearCardData, type ClearCheck, type ClearCheckKey, type ClearCardData } from '../../domain/tripClear'
import { formatMoney } from '../../lib/money'
import { toLocalDateString } from '../../lib/dates'
import { categoryLabel } from '../../lib/categoryLabel'
import type { Trip } from '../../types'

// 旅程通关（2026-11-12）：行程结束后概览页最上面的「收尾」进度卡。四关自动判断
// （见 domain/tripClear.ts），没过的那一关点一下跳到处理的地方。四关全过盖一枚
// 「已结清」大章——这台设备第一次看到通关时播一次落章动效，然后弹出通关卡。
// 不锁账：之后改账不再两清，章自动收回

export type LedgerIntent = { view: 'team' | 'settle'; pendingCards?: boolean }

const SEEN_KEY = (tripId: string) => `tripClear:${tripId}`

function readSeen(tripId: string): string | null {
  try {
    return localStorage.getItem(SEEN_KEY(tripId))
  } catch {
    return null
  }
}
function writeSeen(tripId: string, date: string) {
  try {
    localStorage.setItem(SEEN_KEY(tripId), date)
  } catch {
    // 无痕模式之类存不了：只是下次还会再播一次动画，不影响别的
  }
}

export function ClearStamp({ size, date, tone = 'light', className = '' }: { size: number; date: string; tone?: 'light' | 'dark'; className?: string }) {
  const { t } = useTranslation()
  const color = tone === 'dark' ? 'var(--color-plan-on-dark)' : 'var(--color-positive)'
  return (
    <div
      className={`rounded-full flex flex-col items-center justify-center relative ${className}`}
      style={{ width: size, height: size, border: `${Math.max(2, size * 0.028)}px solid ${color}`, color, transform: 'rotate(-9deg)', background: tone === 'dark' ? 'transparent' : 'color-mix(in srgb, var(--color-positive) 5%, transparent)' }}
    >
      <div className="absolute rounded-full pointer-events-none" style={{ inset: size * 0.05, border: `1px solid ${color}`, opacity: 0.6 }} />
      {size >= 90 && <div className="tracking-[0.2em]" style={{ fontSize: size * 0.085 }}>{t('tripClear.stampTop')}</div>}
      <div className="font-serif-sc font-bold leading-tight" style={{ fontSize: size * 0.23 }}>{t('tripClear.stampWord')}</div>
      <div className="tabular" style={{ fontSize: size * 0.09 }}>{date.replace(/-/g, ' · ')}</div>
    </div>
  )
}

export function TripClearCard({ trip, onOpenLedger }: { trip: Trip; onOpenLedger: (intent: LedgerIntent) => void }) {
  const { t } = useTranslation()
  const state = useLiveQuery(() => tripClearState(trip.id), [trip.id])
  const currency = trip.homeCurrency === 'MYR' ? 'RM' : trip.homeCurrency
  const [stampDate, setStampDate] = useState<string | null>(() => readSeen(trip.id))
  const [slam, setSlam] = useState(false)
  const [cardOpen, setCardOpen] = useState(false)

  const cleared = !!state?.cleared
  useEffect(() => {
    if (!cleared || stampDate) return
    // 这台设备第一次看到通关：记下日期，播一次落章，落完弹出通关卡
    const today = toLocalDateString(new Date())
    writeSeen(trip.id, today)
    setStampDate(today)
    setSlam(true)
  }, [cleared, stampDate, trip.id])
  // 落章播完再弹通关卡——单独一个 effect：放在上面那个里的话，setStampDate 触发
  // 重跑时会把这个计时器一起清掉，卡就弹不出来
  useEffect(() => {
    if (!slam) return
    const timer = setTimeout(() => setCardOpen(true), 1100)
    return () => clearTimeout(timer)
  }, [slam])

  if (!state) return null

  const go = (key: ClearCheckKey) => {
    if (key === 'cards') onOpenLedger({ view: 'team', pendingCards: true })
    else onOpenLedger({ view: 'settle' })
  }
  const pendingText = (c: ClearCheck) =>
    t(`tripClear.pending.${c.key}`, { count: c.count, amount: formatMoney(c.amount, currency) })

  return (
    <>
      <div className="relative rounded-2xl border border-line bg-card px-3.5 py-3 overflow-hidden">
        <div className="flex items-baseline justify-between">
          <span className="font-serif-sc text-[14px] font-semibold">{t('tripClear.title')}</span>
          <span className={`text-[11.5px] ${cleared ? 'text-positive font-semibold' : 'text-muted'}`}>
            {cleared
              ? t('tripClear.allDone', { total: state.checks.length })
              : t('tripClear.progress', { total: state.checks.length, done: state.doneCount })}
          </span>
        </div>
        <div className="flex gap-1 mt-2.5">
          {state.checks.map((c) => (
            <span key={c.key} className={`flex-1 h-1.5 rounded-full ${c.done ? 'bg-positive' : 'bg-line'}`} />
          ))}
        </div>

        {cleared ? (
          <>
            <div className="text-[12px] text-muted leading-[2] mt-2.5">
              {state.checks.map((c) => (
                <div key={c.key}>{t(`tripClear.check.${c.key}`)}</div>
              ))}
            </div>
            {stampDate && (
              <div className={`absolute right-4 top-11 ${slam ? 'trip-clear-slam' : ''}`}>
                <ClearStamp size={104} date={stampDate} />
              </div>
            )}
            <button
              type="button"
              onClick={() => setCardOpen(true)}
              className="w-full mt-3 pt-2.5 border-t border-line flex items-center justify-center gap-1.5 text-[12px] text-plan font-semibold"
            >
              <Share className="w-3.5 h-3.5" strokeWidth={1.8} />
              {t('tripClear.viewCard')}
            </button>
          </>
        ) : (
          <div className="flex flex-col mt-2.5">
            {state.checks.map((c) =>
              c.done ? (
                <div key={c.key} className="flex items-center gap-2.5 py-2 border-t border-line">
                  <span className="w-5 h-5 rounded-full bg-positive flex items-center justify-center flex-shrink-0">
                    <Check className="w-3 h-3 text-card" strokeWidth={2.6} />
                  </span>
                  <span className="flex-1 text-[12.5px] text-muted">{t(`tripClear.check.${c.key}`)}</span>
                  <span className="text-[11px] text-muted">{t(`tripClear.done.${c.key}`)}</span>
                </div>
              ) : (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => go(c.key)}
                  className="flex items-center gap-2.5 py-2 px-2 -mx-2 border-t border-line bg-spend/[.06] rounded-[10px] text-left"
                >
                  <span className="w-5 h-5 rounded-full border-[1.5px] border-spend flex-shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12.5px] font-semibold">{t(`tripClear.check.${c.key}`)}</span>
                    <span className="block text-[11px] text-spend-text mt-px">{pendingText(c)}</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-spend-text flex-shrink-0" strokeWidth={2} />
                </button>
              ),
            )}
          </div>
        )}
      </div>

      {cardOpen && stampDate && <ClearCardModal trip={trip} date={stampDate} onClose={() => setCardOpen(false)} />}
    </>
  )
}

function ClearCardModal({ trip, date, onClose }: { trip: Trip; date: string; onClose: () => void }) {
  const { t } = useTranslation()
  const data = useLiveQuery(() => clearCardData(trip.id), [trip.id])
  const categories = useLiveQuery(() => db.expenseCategories.toArray()) ?? []
  const [busy, setBusy] = useState(false)
  if (!data) return null
  const topLabel = data.topCategoryId ? categoryLabel(categories.find((c) => c.id === data.topCategoryId), t) : ''
  const lines = clearCardLines(trip, data, topLabel, date, t)

  async function save() {
    setBusy(true)
    try {
      const blob = await drawClearCard(lines)
      const file = new File([blob], `${trip.name}.png`, { type: 'image/png' })
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
      if (nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = file.name
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 2000)
      }
    } catch {
      // 用户在分享面板点了取消，不用提示
    } finally {
      setBusy(false)
    }
  }

  // 挂到 body 上（2026-11-12 真机发现）：收尾卡外面套着进场动画（带 transform），
  // fixed 定位会变成相对那一层，弹窗被困在页面中间、遮罩盖不全、按钮被挤出去
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5 overflow-y-auto" onClick={onClose}>
      <div className="absolute inset-0 bg-scrim/55" />
      <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-[340px] flex flex-col gap-3">
        <div className="bg-surface-strong text-on-dark rounded-[20px] px-5 pt-5 pb-4 relative overflow-hidden">
          <div className="text-[10px] tracking-[0.22em] text-on-dark/55">{lines.brand}</div>
          <div className="font-serif-sc text-[22px] font-semibold mt-2.5 pr-20 leading-tight">{lines.name}</div>
          <div className="text-[11.5px] text-on-dark/70 mt-1">{lines.meta}</div>
          <div className="absolute right-4 top-4">
            <ClearStamp size={76} date={date.slice(5)} tone="dark" />
          </div>
          <div className="grid grid-cols-2 gap-2.5 mt-5">
            {lines.cells.map((c) => (
              <div key={c.label} className="border border-on-dark/14 rounded-xl px-3 py-2.5 min-w-0">
                <div className="text-[10.5px] text-on-dark/55">{c.label}</div>
                <div className="text-[15px] font-bold mt-1 truncate">{c.value}</div>
              </div>
            ))}
          </div>
          {lines.bonus && (
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-plan-on-dark">
              <CircleCheckBig className="w-3.5 h-3.5" strokeWidth={1.8} />
              {lines.bonus}
            </div>
          )}
          <div className="mt-3.5 pt-3 border-t border-on-dark/14 text-[10.5px] text-on-dark/55 flex justify-between gap-2">
            <span>{lines.tagline}</span>
            <span className="truncate">{lines.host}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="w-11 h-11 rounded-full bg-card border border-line flex items-center justify-center text-muted" aria-label={t('activity.close')}>
            <X className="w-4 h-4" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="flex-1 rounded-full bg-plan text-card text-[13px] font-medium flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            <Download className="w-4 h-4" strokeWidth={1.8} />
            {t('tripClear.saveImage')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

interface ClearCardLines {
  brand: string
  name: string
  meta: string
  cells: { label: string; value: string }[]
  bonus: string | null
  tagline: string
  host: string
  stampWord: string
  stampDate: string
}

function clearCardLines(trip: Trip, d: ClearCardData, topLabel: string, date: string, t: (k: string, o?: Record<string, unknown>) => string): ClearCardLines {
  const meta = [
    trip.startDate && trip.endDate ? `${trip.startDate} – ${trip.endDate}` : null,
    t('tripClear.card.days', { count: d.dayCount }),
    d.memberCount > 1 ? t('tripClear.card.people', { count: d.memberCount }) : null,
  ].filter(Boolean).join(' · ')
  const cells = [
    { label: t('tripClear.card.recorded'), value: t('tripClear.card.recordedValue', { count: d.expenseCount }) },
    d.placeCount > 0 ? { label: t('tripClear.card.went'), value: t('tripClear.card.wentValue', { count: d.placeCount }) } : null,
    topLabel ? { label: t('tripClear.card.top'), value: `${topLabel} ${d.topCategoryPct.toFixed(1)}%` } : null,
    d.mostWorth ? { label: t('tripClear.card.worth'), value: d.mostWorth } : null,
  ].filter((c): c is { label: string; value: string } => !!c)
  return {
    brand: t('tripClear.card.brand'),
    name: trip.name,
    meta,
    cells,
    bonus: d.allDaysStamped ? t('tripClear.card.bonus') : null,
    tagline: t('tripClear.card.tagline'),
    host: window.location.host,
    stampWord: t('tripClear.stampWord'),
    stampDate: date.slice(5).replace('-', ' · '),
  }
}

// 通关卡存成图片：直接用 canvas 画（不引入截图库）。4:5 竖图，适合发小红书
async function drawClearCard(l: ClearCardLines): Promise<Blob> {
  const W = 1080
  const H = 1350
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  try {
    await document.fonts?.ready
  } catch {
    // 字体还没好就用系统字体
  }
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  const dark = v('--color-surface-strong', '#1f1b16')
  const ink = v('--color-on-dark', '#f7f3ec')
  const accent = v('--color-plan-on-dark', '#b3c0ef')
  const serif = '"Noto Serif SC", "Songti SC", STSong, serif'
  const sans = '-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif'
  // canvas 不一定认 color-mix，半透明的字和线自己换成 rgba
  const faded = (a: number) => {
    const m = ink.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
    return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})` : `rgba(247, 243, 236, ${a})`
  }

  ctx.fillStyle = dark
  ctx.fillRect(0, 0, W, H)
  const P = 96
  ctx.textBaseline = 'top'

  ctx.fillStyle = faded(0.55)
  ctx.font = `30px ${sans}`
  ctx.fillText(l.brand, P, P)

  ctx.fillStyle = ink
  ctx.font = `600 76px ${serif}`
  wrapText(ctx, l.name, P, P + 80, W - P * 2 - 260, 92, 2)

  ctx.fillStyle = faded(0.7)
  ctx.font = `34px ${sans}`
  ctx.fillText(l.meta, P, P + 290)

  // 右上角的章
  ctx.save()
  ctx.translate(W - P - 120, P + 130)
  ctx.rotate((-9 * Math.PI) / 180)
  ctx.strokeStyle = accent
  ctx.fillStyle = accent
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.arc(0, 0, 120, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.arc(0, 0, 106, 0, Math.PI * 2)
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 56px ${serif}`
  ctx.fillText(l.stampWord, 0, -8)
  ctx.font = `26px ${sans}`
  ctx.fillText(l.stampDate, 0, 46)
  ctx.restore()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  // 四格
  const gridTop = P + 420
  const gap = 32
  const cellW = (W - P * 2 - gap) / 2
  const cellH = 190
  l.cells.forEach((c, i) => {
    const x = P + (i % 2) * (cellW + gap)
    const y = gridTop + Math.floor(i / 2) * (cellH + gap)
    ctx.strokeStyle = faded(0.16)
    ctx.lineWidth = 3
    roundRect(ctx, x, y, cellW, cellH, 34)
    ctx.stroke()
    ctx.fillStyle = faded(0.55)
    ctx.font = `30px ${sans}`
    ctx.fillText(c.label, x + 36, y + 36)
    ctx.fillStyle = ink
    ctx.font = `700 50px ${sans}`
    wrapText(ctx, c.value, x + 36, y + 92, cellW - 72, 60, 1)
  })

  const rows = Math.ceil(l.cells.length / 2)
  let y = gridTop + rows * (cellH + gap) + 16
  if (l.bonus) {
    // 打勾自己画，不用 ✓ 字符（各家字体渲染不一样）
    ctx.strokeStyle = accent
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(P, y + 18)
    ctx.lineTo(P + 11, y + 29)
    ctx.lineTo(P + 32, y + 6)
    ctx.stroke()
    ctx.fillStyle = accent
    ctx.font = `32px ${sans}`
    ctx.fillText(l.bonus, P + 48, y)
    y += 70
  }

  ctx.strokeStyle = faded(0.16)
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(P, H - P - 70)
  ctx.lineTo(W - P, H - P - 70)
  ctx.stroke()
  ctx.fillStyle = faded(0.6)
  ctx.font = `30px ${sans}`
  ctx.fillText(l.tagline, P, H - P - 30)
  ctx.textAlign = 'right'
  ctx.fillText(l.host, W - P, H - P - 30)

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'))
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// 按字切行（中文没有空格），超出 maxLines 用省略号收尾
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines: number) {
  const lines: string[] = []
  let cur = ''
  for (const ch of [...text]) {
    if (ctx.measureText(cur + ch).width > maxW && cur) {
      lines.push(cur)
      cur = ch
    } else cur += ch
  }
  if (cur) lines.push(cur)
  const shown = lines.slice(0, maxLines)
  if (lines.length > maxLines) {
    let last = shown[maxLines - 1]
    while (last && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1)
    shown[maxLines - 1] = last + '…'
  }
  shown.forEach((ln, i) => ctx.fillText(ln, x, y + i * lineH))
}
