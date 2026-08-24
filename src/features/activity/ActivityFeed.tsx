import { X } from 'lucide-react'
import type { Trip } from '../../types'
import { Avatar } from '../../components/Avatar'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useActivityEntries, ACTIVITY_KIND_LABEL, ACTIVITY_KIND_CLASS, relativeTime } from './useActivityEntries'

// "行程动态"——把这趟行程里家里每个人做过的事按时间倒序摊开。
//
// 这个APP的数据一直是一家人共享的，但同步是静默的后台轮询：别人记的账、加的行程项
// 会悄无声息地出现在各自的列表里，跟自己三天前加的那条毫无区别。结果是两个人可以
// 正确地对同一份数据做事，却谁都不会被告知对方做了什么。这一页就是补上"谁做了什么"
// 这个视角，让多人协作这件事有存在感。
//
// 取数逻辑在 useActivityEntries——"概览"旅途中形态里"家里刚才"那一小截用的是同一个
// hook，只是截取前几条，不重新查一遍库。

export function ActivityFeed({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  useEscapeKey(true, onClose)
  const { entries, members } = useActivityEntries(trip)

  // 只在这里取一次"现在"，让整页的相对时间基于同一个时刻，不会出现同一批记录
  // 因为逐条计算而显示成"3分钟前/4分钟前"这种不一致
  const now = Date.now()

  return (
    <div className="absolute inset-0 z-30 bg-ink/35" onClick={onClose}>
      <div className="absolute inset-0 flex flex-col justify-end px-2.5 pb-2.5 pointer-events-none">
        <div
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto bg-paper rounded-[26px] px-5 pt-3.5 pb-7 shadow-[0_-6px_28px_rgba(31,27,22,0.22)] max-h-[88%] overflow-y-auto no-scrollbar"
        >
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
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ACTIVITY_KIND_CLASS[en.kind]}`}>
                        {ACTIVITY_KIND_LABEL[en.kind]}
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
    </div>
  )
}
