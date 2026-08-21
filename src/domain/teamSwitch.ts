import { db, clearLocalTeamData } from '../db/dexie'
import { runSync } from '../db/sync'
import { clearHouseholdCache, setActiveHousehold } from './household'

// 还有没推上去的本地写操作时，不允许切换团队。
// 界面靠这个错误类型区分"切换失败了"和"不能切"，分别给不同提示
export class PendingSyncError extends Error {
  // 不用构造函数参数属性（`constructor(public x)`）——那是会产生运行时代码的
  // TS 专有语法，这个项目开了 erasableSyntaxOnly，只允许能被直接擦除的类型语法
  pendingCount: number

  constructor(pendingCount: number) {
    super(`还有 ${pendingCount} 条记录没同步`)
    this.pendingCount = pendingCount
  }
}

export async function countPendingSync(): Promise<number> {
  return db.outbox.where('status').equals('pending').count()
}

// 切换到另一个团队。顺序是有讲究的，每一步都不能挪：
//
// 1. 先确认 outbox 是空的。带着旧团队 household_id 的待推送记录，切过去之后会被
//    RLS 的 `with check (household_id = current_household_id())` 永久拒绝，
//    卡在队列里反复重试反复失败——就是 2026-08-16 那次"分摊明细永远同步不上去"
//    的同一类死局。所以这里宁可拒绝切换，也不能让用户丢数据。
//
// 2. 再写服务端指针。放在清本地之前：如果这一步失败（网络/权限），本地还没被动过，
//    直接抛错回去就行，不会留下"本地清了但服务端还指着旧团队"的错位状态。
//
// 3. 清掉内存里缓存的 householdId。必须在清本地数据之前——不然后面重新拉取时
//    还会用旧的团队ID去打标记。
//
// 4. 清本地已同步的表。clearLocalTeamData 内部走了 withoutOutboxTracking，
//    否则这一步会把云端数据一起删掉（详见那个函数上面的注释）。
//
// 5. 最后重新拉取。新团队的数据这时才落到本地。
export async function switchTeam(householdId: string): Promise<void> {
  const pending = await countPendingSync()
  if (pending > 0) throw new PendingSyncError(pending)

  await setActiveHousehold(householdId)
  clearHouseholdCache()
  await clearLocalTeamData()
  await runSync()
}
