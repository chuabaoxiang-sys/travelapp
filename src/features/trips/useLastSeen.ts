import { useCallback, useState } from 'react'

// "自从你上次打开，家里其他人做了什么"——这个APP虽然数据是多人共享的，但同步是
// 静默的（后台轮询，拉到新数据就直接出现在列表里，跟你自己昨天记的那条长得一模一样），
// 所以别人做了什么你根本不会被告知。这个 hook 提供最轻量的一层"未读"概念：
// 按行程记住你上次看这个tab的时间点，比这个时间点更新、且不是你自己写的记录就算"新的"。
//
// 刻意只用 localStorage、不进数据库：这是"这台设备上的我看到哪了"，本质是本机状态，
// 同步到云端反而会让"在手机上看过、平板上就不提示了"这种行为变得难以理解，
// 也省掉一张表和一轮迁移。
const KEY_PREFIX = 'trip-journal:last-seen:'

function keyFor(tripId: string, tab: string) {
  return `${KEY_PREFIX}${tripId}:${tab}`
}

function read(tripId: string, tab: string): number {
  const raw = localStorage.getItem(keyFor(tripId, tab))
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) ? n : 0
}

export function useLastSeen(tripId: string, tab: string) {
  const [seenAt, setSeenAt] = useState(() => read(tripId, tab))

  // 标记为"已看过"，并把**更新之前**的那个时间点返回出去。
  // 返回旧值这一手是关键：调用方进tab时要同时做两件相反的事——把这一刻记成"已看过"，
  // 又要知道"在此之前是看到哪了"好给新内容做高亮。如果让调用方自己去读 seenAt，
  // 就得在 effect 里引用一个会被自己改掉的值，只能靠省略依赖来回避，既脆弱又要压警告。
  // 直接返回旧值之后，这个 hook 的依赖是干净的（tripId 和 tab 都不会逐帧变）
  const markSeen = useCallback(() => {
    const previous = read(tripId, tab)
    const now = Date.now()
    localStorage.setItem(keyFor(tripId, tab), String(now))
    setSeenAt(now)
    return previous
  }, [tripId, tab])

  return { seenAt, markSeen }
}

// 数一下有多少条是"别人新写的"。authorOf 由调用方给，因为不同表记录作者的字段名不同
// （账目是 recordedBy，行程项/结算是 createdBy）
export function countUnseen<T extends { createdAt: number }>(
  rows: T[],
  seenAt: number,
  currentMemberId: string,
  authorOf: (row: T) => string | null | undefined,
): number {
  // seenAt 为 0 表示这台设备还从没看过这个tab——此时把所有历史记录都算成"新的"
  // 会让第一次进来就顶着一个很大的红点，反而没有信息量，所以直接当成"都看过了"
  if (!seenAt) return 0
  return rows.filter((r) => r.createdAt > seenAt && authorOf(r) !== currentMemberId).length
}
