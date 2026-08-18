import { useLiveQuery } from 'dexie-react-hooks'
import { X } from 'lucide-react'
import { db } from '../../db/dexie'
import type { Trip } from '../../types'
import { Avatar } from '../../components/Avatar'
import { formatMoney } from '../../lib/money'
import { useEscapeKey } from '../../hooks/useEscapeKey'

// "行程动态"——把这趟行程里家里每个人做过的事按时间倒序摊开。
//
// 这个APP的数据一直是一家人共享的，但同步是静默的后台轮询：别人记的账、加的行程项
// 会悄无声息地出现在各自的列表里，跟自己三天前加的那条毫无区别。结果是两个人可以
// 正确地对同一份数据做事，却谁都不会被告知对方做了什么。这一页就是补上"谁做了什么"
// 这个视角，让多人协作这件事有存在感。
//
// 数据全部来自已有的表，没有单独的事件/日志表：createdAt 就是时间轴，作者字段各表
// 不同（账目是 recordedBy，行程项/结算是 createdBy）。历史数据没有作者时退化成"有人"，
// 不隐藏这条记录——"发生过什么"比"是谁"更重要。

type ActivityKind = 'expense' | 'item' | 'settlement'

interface ActivityEntry {
  id: string
  kind: ActivityKind
  at: number
  authorId: string | null
  text: string
}

const KIND_LABEL: Record<ActivityKind, string> = {
  expense: '记账',
  item: '行程',
  settlement: '结算',
}

const KIND_CLASS: Record<ActivityKind, string> = {
  expense: 'bg-cat-food/12 text-cat-food',
  item: 'bg-plan/12 text-plan',
  settlement: 'bg-positive/12 text-positive',
}

function relativeTime(at: number, now: number): string {
  const diffMin = Math.round((now - at) / 60_000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin}分钟前`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}小时前`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 30) return `${diffDay}天前`
  return new Date(at).toISOString().slice(0, 10)
}

export function ActivityFeed({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  useEscapeKey(true, onClose)

  const expenses = useLiveQuery(() => db.expenses.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const items = useLiveQuery(() => db.itineraryItems.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const settlements = useLiveQuery(() => db.settlements.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const members = useLiveQuery(() => db.members.toArray()) ?? []
  const categories = useLiveQuery(() => db.expenseCategories.toArray()) ?? []

  const currency = trip.homeCurrency === 'MYR' ? 'RM' : trip.homeCurrency
  function memberName(id: string | null | undefined) {
    if (!id) return null
    return members.find((m) => m.id === id)?.displayName ?? null
  }

  const entries: ActivityEntry[] = [
    ...expenses.map((e) => ({
      id: `e-${e.id}`,
      kind: 'expense' as const,
      at: e.createdAt,
      authorId: e.recordedBy,
      text: `${e.description || categories.find((c) => c.id === e.categoryId)?.name || '一笔开销'} · ${formatMoney(e.homeAmount, currency)}`,
    })),
    ...items.map((it) => ({
      id: `i-${it.id}`,
      kind: 'item' as const,
      at: it.createdAt,
      authorId: it.createdBy,
      text: it.title,
    })),
    ...settlements.map((s) => ({
      id: `s-${s.id}`,
      kind: 'settlement' as const,
      at: s.createdAt,
      authorId: s.createdBy,
      text: `${memberName(s.fromMemberId) ?? '某人'} 还给 ${memberName(s.toMemberId) ?? '某人'} ${formatMoney(s.amount, currency)}`,
    })),
  ].sort((a, b) => b.at - a.at)

  // 只在这里取一次"现在"，让整页的相对时间基于同一个时刻，不会出现同一批记录
  // 因为逐条计算而显示成"3分钟前/4分钟前"这种不一致
  const now = Date.now()

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <div className="flex-1 bg-ink/35" onClick={onClose} />
      <div className="bg-paper rounded-t-[26px] px-5 pt-3.5 pb-7 shadow-[0_-10px_40px_rgba(31,27,22,0.2)] max-h-[88%] overflow-y-auto no-scrollbar">
        <div className="w-[38px] h-1 rounded-full bg-[#D8CFC0] mx-auto mb-3.5" />
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-serif-sc text-[15px] font-semibold">行程动态</h2>
          <button onClick={onClose} className="text-muted" title="关闭">
            <X className="w-[18px] h-[18px]" strokeWidth={1.8} />
          </button>
        </div>

        {!entries.length ? (
          <div className="text-[13px] text-muted py-8 text-center">
            这趟行程还没有任何记录。记一笔账、或者加一项行程安排，这里就会出现谁做了什么。
          </div>
        ) : (
          <div className="flex flex-col gap-2 pb-2">
            {entries.map((en) => {
              const author = en.authorId ? members.find((m) => m.id === en.authorId) : undefined
              return (
                <div key={en.id} className="flex items-start gap-2.5 bg-card border border-line rounded-2xl px-3.5 py-2.5">
                  <Avatar member={author} size={26} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[12.5px] font-medium">{author?.displayName ?? '有人'}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${KIND_CLASS[en.kind]}`}>
                        {KIND_LABEL[en.kind]}
                      </span>
                    </div>
                    <div className="text-[12.5px] text-ink/85 mt-0.5 break-words">{en.text}</div>
                  </div>
                  <div className="text-[10.5px] text-muted flex-shrink-0 pt-0.5">{relativeTime(en.at, now)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
