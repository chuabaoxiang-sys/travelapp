import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie'
import { onPulledChanges } from '../db/sync'

// 顶部常驻的同步状态。三种状态：
//   已同步 / N条待同步 / 刚更新（短暂）
// "刚更新"是唯一一个会主动冒出来的状态：这个APP的数据是一家人共享的，但同步一直是
// 静默的后台轮询——别人记的账会悄无声息地出现在列表里，跟自己三天前记的那条毫无区别。
// 拉到真的有变化时闪一下这个提示，是让"家里还有别人在用"这件事有存在感的最低成本做法。
const JUST_UPDATED_MS = 3500

export function SyncStatusBadge({ onOpenDetail }: { onOpenDetail: () => void }) {
  const pendingCount = useLiveQuery(() => db.outbox.where('status').equals('pending').count()) ?? 0
  const [justUpdated, setJustUpdated] = useState(false)

  useEffect(() => {
    const off = onPulledChanges(() => {
      setJustUpdated(true)
      setTimeout(() => setJustUpdated(false), JUST_UPDATED_MS)
    })
    return off
  }, [])

  // 点这个角标直接打开"同步详情"，跟"···更多"里那个入口效果一样——待同步的时候
  // 尤其有用，不用绕去更多面板才能看具体卡在哪一条
  // 有待同步的东西时优先显示待同步——那是"还没送出去"，比"刚收到"更需要用户知道
  if (pendingCount > 0) {
    return (
      <button
        type="button"
        onClick={onOpenDetail}
        className="inline-flex items-center gap-1.5 rounded-full bg-spend/10 text-spend px-2.5 py-0.5 text-[10px]"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-current" /> {pendingCount}条待同步
      </button>
    )
  }

  if (justUpdated) {
    return (
      <button
        type="button"
        onClick={onOpenDetail}
        className="inline-flex items-center gap-1.5 rounded-full bg-plan/10 text-plan px-2.5 py-0.5 text-[10px]"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-current" /> 刚更新
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onOpenDetail}
      className="inline-flex items-center gap-1.5 rounded-full bg-positive/10 text-positive px-2.5 py-0.5 text-[10px]"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" /> 已同步
    </button>
  )
}
