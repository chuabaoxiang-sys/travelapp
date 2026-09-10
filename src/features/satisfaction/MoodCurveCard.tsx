import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { db } from '../../db/dexie'
import type { SatisfactionRetro } from '../../domain/retrospective'
import { satisfactionByMember, ratingBreakdown, totalOf, type DayMoodPoint } from '../../domain/satisfaction'
import type { SatisfactionRating } from '../../types'
import { DaySatisfactionPicker } from './DaySatisfactionPicker'
import { SatisfactionCompareCard } from './SatisfactionCompareCard'
import { SatisfactionByMemberCard } from './SatisfactionByMemberCard'

// 回顾页的心情曲线——暖色调平滑曲线代替"93%你觉得值"这种百分比文字统计，
// 横轴永远是"天"（被行程长度天然限制住，不会因为账目笔数多而变挤）。
// 具体设计定稿见本次会话讨论：mix-blend-mode/直线折线/黑底提示框这几版
// 尝试过的坑不再重复（暖色曲线本身、postcard风格提示框都是踩过坑之后的结果）。
//
// 2026-09-11：这份曲线本来只在"回家后"页面渲染过，行程进行中翻了卡也没地方
// 回看——翻卡入口一旦翻完当前待翻的天就直接消失（SatisfactionEntryCard
// 返回null），行程没结束的话完全找不到任何记录。现在"旅途中"页面也接上
// 同一份组件，两处共用同一份实现，不用维护两份。顺带补上"点已经打过分的
// 那天能改评分"——之前翻卡片一旦翻过就没有回头路，跟账目页盖章徽标
// （随时能点开重新标）比起来是个明显的缺口，这次一起补上，接口不变。

const Y_BY_RATING: Record<SatisfactionRating, number> = { worth: 50, neutral: 100, regret: 160 }
const VIEW_W = 360
const VIEW_H = 210
const MARGIN_L = 34
const MARGIN_R = 15
const BASELINE_Y = 180

function xPositions(count: number) {
  if (count <= 1) return [VIEW_W / 2]
  const usable = VIEW_W - MARGIN_L - MARGIN_R
  return Array.from({ length: count }, (_, i) => MARGIN_L + (usable * i) / (count - 1))
}

// Catmull-Rom转三次贝塞尔，画出平滑曲线而不是股票走势图那种直线折线——
// 这是这次讨论里"心情曲线太冰冷"反馈之后的修法，颜色也从冷色调的靛蓝
// 换成暖橙色（--color-spend），两处一起改才是"暖起来"
function smoothPath(pts: { x: number; y: number }[]) {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x},${p2.y}`
  }
  return d
}

function formatShortDate(iso: string) {
  const parts = iso.split('-')
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : iso
}

// interactive=true（"我的"视图）时，已经打过分的点才能点开改评分——曲线本来
// 就只给有评分的天画点（没打过分/跳过的天压根没有circle），所以这里不用
// 另外过滤"是不是已经过去"：未来的天不可能有daySatisfactions记录，天然不会
// 出现在这里
function Curve({ points, interactive, onPointClick }: { points: DayMoodPoint[]; interactive: boolean; onPointClick: (p: DayMoodPoint) => void }) {
  const { t } = useTranslation()
  const xs = xPositions(points.length)
  const ratedIdx = points.map((p, i) => (p.rating ? i : -1)).filter((i) => i >= 0)
  const linePts = ratedIdx.map((i) => ({ x: xs[i], y: Y_BY_RATING[points[i].rating as SatisfactionRating] }))
  const lineD = smoothPath(linePts)
  const areaD = linePts.length >= 2 ? `${lineD} L${linePts[linePts.length - 1].x},${BASELINE_Y} L${linePts[0].x},${BASELINE_Y} Z` : ''

  const minY = linePts.length ? Math.min(...linePts.map((p) => p.y)) : null
  const maxY = linePts.length ? Math.max(...linePts.map((p) => p.y)) : null

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="moodCurveFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-spend)" stopOpacity=".22" />
          <stop offset="100%" stopColor="var(--color-spend)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[50, 105, 160].map((y) => (
        <line key={y} x1={MARGIN_L} y1={y} x2={VIEW_W - MARGIN_R} y2={y} stroke="var(--color-line)" strokeWidth={1} strokeDasharray="1.5 4" strokeLinecap="round" />
      ))}
      <text x={0} y={53} fontSize={9.5} fill="var(--color-faint)">{t('satisfaction.ratingWorth')}</text>
      <text x={0} y={108} fontSize={9.5} fill="var(--color-faint)">{t('satisfaction.ratingNeutral')}</text>
      <text x={0} y={163} fontSize={9.5} fill="var(--color-faint)">{t('satisfaction.ratingRegret')}</text>

      {areaD && <path d={areaD} fill="url(#moodCurveFill)" />}
      {lineD && <path d={lineD} fill="none" stroke="var(--color-spend)" strokeWidth={3} strokeLinecap="round" />}

      {linePts.map((p, i) => {
        const point = points[ratedIdx[i]]
        const isPeak = p.y === minY
        const isValley = p.y === maxY
        const color = isValley ? 'var(--color-negative)' : isPeak ? 'var(--color-positive)' : null
        return (
          <g
            key={i}
            onClick={interactive ? () => onPointClick(point) : undefined}
            style={interactive ? { cursor: 'pointer' } : undefined}
          >
            {/* 透明大圆只是为了扩大点击/触摸命中范围，视觉上看不到，跟真正画出来的点分开 */}
            {interactive && <circle cx={p.x} cy={p.y} r={14} fill="transparent" />}
            {color ? (
              <>
                <circle cx={p.x} cy={p.y} r={9} fill={color} opacity={0.15} />
                <circle cx={p.x} cy={p.y} r={5.5} fill={color} />
              </>
            ) : (
              <circle cx={p.x} cy={p.y} r={4.5} fill="var(--color-card)" stroke="var(--color-spend)" strokeWidth={2.5} />
            )}
          </g>
        )
      })}

      {points.map((p, i) => (
        <text key={p.date} x={xs[i]} y={196} textAnchor="middle" fontSize={9.5} fill="var(--color-faint)">
          {formatShortDate(p.date)}
        </text>
      ))}
    </svg>
  )
}

export function MoodCurveCard({
  satisfaction,
  tripId,
  currentMemberId,
}: {
  satisfaction: SatisfactionRetro
  tripId: string
  currentMemberId: string
}) {
  const { t } = useTranslation()
  const [view, setView] = useState<'me' | 'all'>('me')
  const [editingPoint, setEditingPoint] = useState<DayMoodPoint | null>(null)
  const points = view === 'me' ? satisfaction.moodCurveMe : satisfaction.moodCurveAll
  const hasAnyMood = satisfaction.moodCurveMe.some((p) => p.rating) || satisfaction.moodCurveAll.some((p) => p.rating)
  const noExpenseData = totalOf(satisfaction.expenseStatMe) === 0 && totalOf(satisfaction.expenseStatAll) === 0

  // 2026-09-11新增：并列对比（"我的"）+ 按人对比（"全家整体"），取代原来那句
  // 单纯的账目文字统计——两块都是从已有数据直接算出来的，不需要新的写库逻辑
  const byMember = useLiveQuery(() => satisfactionByMember(tripId), [tripId]) ?? []
  const members = useLiveQuery(() => db.members.toArray()) ?? []
  const dayBreakdownMe = ratingBreakdown(satisfaction.moodCurveMe.map((p) => p.rating))

  if (!hasAnyMood && noExpenseData) return null

  return (
    <div className="rounded-2xl border border-line bg-card p-3.5">
      <div className="flex gap-1.5 mb-3">
        {(['me', 'all'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex-1 text-center text-[12.5px] py-1.5 px-1 rounded-[10px] border ${
              view === v ? 'border-spend bg-spend/10 text-ink font-semibold' : 'border-line bg-card text-soft'
            }`}
          >
            {v === 'me' ? t('satisfaction.viewMe') : t('satisfaction.viewAll')}
          </button>
        ))}
      </div>
      <Curve points={points} interactive={view === 'me'} onPointClick={setEditingPoint} />
      <div className="mt-3 pt-3 border-t border-line">
        {view === 'me' ? (
          <SatisfactionCompareCard days={dayBreakdownMe} expenses={satisfaction.expenseStatMe} />
        ) : (
          <SatisfactionByMemberCard summaries={byMember} members={members} />
        )}
      </div>
      {editingPoint && (
        <DaySatisfactionPicker
          tripId={tripId}
          dayId={editingPoint.dayId}
          date={formatShortDate(editingPoint.date)}
          title={editingPoint.title}
          currentMemberId={currentMemberId}
          currentRating={editingPoint.rating}
          onClose={() => setEditingPoint(null)}
        />
      )}
    </div>
  )
}
