import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie'

// 目前还没接真实的云端同步（本地跑，等 Supabase 项目建好再接），
// 这个数字只反映"有多少条写操作还没同步出去"，不会自动清零——
// 这是阶段4当前范围内的预期行为，不是bug
export function SyncStatusBadge() {
  const pendingCount = useLiveQuery(() => db.outbox.where('status').equals('pending').count()) ?? 0

  if (pendingCount === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-positive/10 text-positive px-2.5 py-0.5 text-[10px]">
        <span className="w-1.5 h-1.5 rounded-full bg-current" /> 已同步
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-spend/10 text-spend px-2.5 py-0.5 text-[10px]">
      <span className="w-1.5 h-1.5 rounded-full bg-current" /> {pendingCount}条待同步
    </span>
  )
}
