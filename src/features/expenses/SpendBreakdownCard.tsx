import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PieChart, ChevronDown, Ellipsis } from 'lucide-react'
import type { Expense, ExpenseCategory, ExpenseDayAllocation } from '../../types'
import { categoryBreakdown, groupSmallCategories } from '../../domain/spendBreakdown'
import { categoryColor } from '../../lib/categoryColors'
import { categoryLabel } from '../../lib/categoryLabel'
import { CategoryIcon } from '../../components/CategoryBadge'
import { formatMoneyFixed } from '../../lib/money'

const RING_SIZE = 80
const RING_STROKE = 10

interface RingSlice {
  color: string
  pct: number
  start: number
}

// 环心专门用的格式化——不带小数，"住宿5,347.64"这种精确到分的数字留给
// 旁边的明细列表。环本身小，实测过真实行程（RM11,078.31）会直接戳出环外；
// 长度再动态缩一档字号，兜住金额更大的行程
function formatRingTotal(n: number) {
  return Math.round(n).toLocaleString('en-US')
}
function ringFontSize(digits: string) {
  if (digits.length > 6) return 11
  if (digits.length > 4) return 12.5
  return 14
}

// 环形图的"色环"按颜色合并（比如机票/交通共用同一个分类色时会画成一段弧），
// 明细文字仍然按分类精确列出，不受这个合并影响——图表是辅助，不能替代精确数字
function slicesByColor(rows: { categoryId: string; total: number }[], categories: ExpenseCategory[]): RingSlice[] {
  const byColor = new Map<string, number>()
  const order: string[] = []
  for (const r of rows) {
    const color = categoryColor(categories.find((c) => c.id === r.categoryId))
    if (!byColor.has(color)) {
      byColor.set(color, 0)
      order.push(color)
    }
    byColor.set(color, byColor.get(color)! + r.total)
  }
  const total = order.reduce((a, color) => a + byColor.get(color)!, 0)
  let acc = 0
  return order.map((color) => {
    const val = byColor.get(color)!
    const start = total > 0 ? (acc / total) * 100 : 0
    acc += val
    return { color, pct: total > 0 ? (val / total) * 100 : 0, start }
  })
}

// 用SVG画弧、靠stroke-dashoffset的CSS transition做扫入动效——跟.bar-fill
// 线性进度条同一个思路（见index.css），也是同一个原因用SVG不用conic-gradient
// 背景图：background不是能被transition平滑过渡的属性。
//
// 动效本来想省事，指望useLiveQuery"先给空数组、真数据到位再渲染一次"这个
// 天然的两段式过程顺便触发transition——真机上验证发现不可靠：数据从本地
// IndexedDB读出来的速度经常快到跟首次渲染同一帧，看不出"从无到有"这个过程，
// 动效等于没有。改成老老实实用双重requestAnimationFrame手动触发：先把每段弧
// 摆到"还没画出来"的初始位置，等浏览器真的画完这一帧，下一帧再改成最终位置，
// CSS transition才有起点可以过渡
function CategoryRing({ slices }: { slices: RingSlice[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const r = (RING_SIZE - RING_STROKE) / 2
  const c = RING_SIZE / 2
  const circumference = 2 * Math.PI * r

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const arcs = svg.querySelectorAll<SVGCircleElement>('.spend-ring-arc')
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        arcs.forEach((el) => {
          el.style.strokeDashoffset = el.dataset.finalOffset ?? '0'
        })
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
    // slices数组每次都是新对象，用它的"内容签名"当依赖，而不是引用本身——
    // 不然即使数据没变，父组件重渲染也会重新触发一次没必要的扫入动画
  }, [JSON.stringify(slices)]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <svg
      ref={svgRef}
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      style={{ transform: 'rotate(-90deg)' }}
    >
      {slices.map((s, i) => {
        const sliceLen = (s.pct / 100) * circumference
        const startOffset = (s.start / 100) * circumference
        const finalOffset = -startOffset
        const initialOffset = -(startOffset + sliceLen) // 往前多推一个自身长度，动画开始时几乎看不见
        return (
          <circle
            key={i}
            className="spend-ring-arc"
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={RING_STROKE}
            strokeDasharray={`${sliceLen} ${circumference - sliceLen}`}
            strokeDashoffset={initialOffset}
            data-final-offset={finalOffset}
          />
        )
      })}
    </svg>
  )
}

export function SpendBreakdownCard({
  expenses,
  categories,
  dayAllocations,
  todayISO,
  currency,
  title,
  footer,
}: {
  expenses: Expense[]
  categories: ExpenseCategory[]
  dayAllocations: ExpenseDayAllocation[]
  todayISO: string
  currency: string
  // 「我的」视角（2026-11-08）复用这张卡：换标题、底下多一行对账
  title?: string
  footer?: ReactNode
}) {
  const { t, i18n } = useTranslation()
  const [mode, setMode] = useState<'trip' | 'today'>('trip')
  const [expanded, setExpanded] = useState(false)

  // 卡片整体要不要出现，看"全程"有没有任何记录——这趟压根还没记过账时，
  // 一个空环形图不会比不显示更有用。但一旦已经在显示了，切到"今天"这个
  // 具体视角下暂时没有数据（比如今天还没到、或者今天没花钱），不该让整张卡
  // 连标题带切换按钮一起消失——那看起来像出bug了，应该是卡片继续在、
  // 只是环和明细换成一句"今天还没有记账"
  const tripRows = categoryBreakdown(expenses, dayAllocations, 'trip', todayISO)
  if (!tripRows.length) return null

  const rows = mode === 'trip' ? tripRows : categoryBreakdown(expenses, dayAllocations, mode, todayISO)
  const total = rows.reduce((a, r) => a + r.total, 0)
  const slices = slicesByColor(rows, categories)
  const withMeta = rows.map((r) => ({
    ...r,
    category: categories.find((c) => c.id === r.categoryId),
    pct: total > 0 ? (r.total / total) * 100 : 0,
  }))
  // 收拾干净（2026-11-10）：圆环旁边只写一句重点，列表从第一类开始只列一次（收起时前三行，
  // 展开接着往下）；不到 3% 的几类合成「其他 N 类」；长条按花最多那一类画满；
  // 金额深色加粗、固定两位小数，百分比退成小灰字单独一列
  const top = withMeta[0]
  const topThreePct = withMeta.length >= 3 ? Math.round(withMeta.slice(0, 3).reduce((a, r) => a + r.pct, 0)) : null
  const { kept, other } = groupSmallCategories(rows)
  const maxTotal = rows[0]?.total ?? 0
  const listRows: { key: string; label: string; color: string; icon: ReactNode; total: number; pct: number; detail?: string }[] = [
    ...kept.map((r) => {
      const category = categories.find((c) => c.id === r.categoryId)
      return {
        key: r.categoryId,
        label: categoryLabel(category, t),
        color: categoryColor(category),
        icon: <CategoryIcon category={category} size={13} />,
        total: r.total,
        pct: total > 0 ? (r.total / total) * 100 : 0,
      }
    }),
    ...(other
      ? [{
          key: 'other',
          label: t('ledger.breakdown.other', { count: other.items.length }),
          color: categoryColor(null),
          icon: <Ellipsis className="w-[13px] h-[13px]" strokeWidth={1.8} />,
          total: other.total,
          pct: total > 0 ? (other.total / total) * 100 : 0,
          detail: other.items.map((r) => `${categoryLabel(categories.find((c) => c.id === r.categoryId), t)} ${formatMoneyFixed(r.total, currency)}`).join(' · '),
        }]
      : []),
  ]
  const shownRows = expanded ? listRows : listRows.slice(0, 3)

  return (
    <div className="rounded-2xl border border-line bg-card px-3.5 py-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-[13px] font-medium">
          <PieChart className="w-3.5 h-3.5 text-muted" strokeWidth={2} />
          {title ?? t('ledger.breakdown.title')}
        </div>
        <div className="flex bg-segment rounded-lg p-0.5">
          {(['trip', 'today'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-2.5 py-1 text-[11px] ${mode === m ? 'bg-ink text-paper font-medium' : 'text-muted'}`}
            >
              {t(`ledger.breakdown.${m}`)}
            </button>
          ))}
        </div>
      </div>

      {!rows.length ? (
        <div className="text-[12px] text-muted py-4 text-center">{t('ledger.breakdown.emptyToday')}</div>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <div className="relative flex-shrink-0" style={{ width: RING_SIZE, height: RING_SIZE }}>
              <CategoryRing slices={slices} />
              <div
                className="absolute rounded-full bg-card flex flex-col items-center justify-center"
                style={{ inset: RING_STROKE }}
              >
                <div className="text-[8px] text-faint">{currency}</div>
                <div className="font-bold tabular mt-0.5" style={{ fontSize: ringFontSize(formatRingTotal(total)) }}>
                  {formatRingTotal(total)}
                </div>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-muted">{t('ledger.breakdown.topLabel')}</div>
              <div className="flex items-baseline gap-1.5 mt-0.5 text-[17px] font-semibold">
                <span className="truncate" style={{ color: categoryColor(top.category) }}>{categoryLabel(top.category, t)}</span>
                <span className="tabular">{top.pct.toFixed(1)}%</span>
              </div>
              {topThreePct != null && (
                <div className="text-[11px] text-muted mt-1">
                  {t('ledger.breakdown.topThree', { names: withMeta.slice(0, 3).map((r) => categoryLabel(r.category, t)).join(i18n.language.startsWith('zh') ? '、' : ', '), pct: topThreePct })}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2.5 mt-3.5">
            {shownRows.map((r) => (
              <div key={r.key}>
                <div className="flex items-center gap-1.5 mb-[5px]">
                  <span className="flex-shrink-0 flex" style={{ color: r.color }}>{r.icon}</span>
                  <span className="flex-1 min-w-0 truncate text-[12.5px]">{r.label}</span>
                  <span className="text-[12.5px] font-semibold tabular flex-shrink-0">{formatMoneyFixed(r.total, currency)}</span>
                  <span className="w-[38px] text-right text-[10.5px] text-muted tabular flex-shrink-0">{r.pct.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-line overflow-hidden">
                  <div
                    className="bar-fill h-full rounded-full"
                    style={{ width: `${Math.max(2, maxTotal > 0 ? (r.total / maxTotal) * 100 : 0)}%`, background: r.color }}
                  />
                </div>
                {r.detail && <div className="text-[11px] text-muted tabular mt-[5px]">{r.detail}</div>}
              </div>
            ))}
          </div>
        </>
      )}

      {listRows.length > 3 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center gap-1 text-[11px] text-muted mt-3 pt-2 border-t border-line"
        >
          {expanded ? t('ledger.breakdown.collapse') : t('ledger.breakdown.viewAll', { count: withMeta.length })}
          <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} strokeWidth={2} />
        </button>
      )}
      {footer}
    </div>
  )
}
