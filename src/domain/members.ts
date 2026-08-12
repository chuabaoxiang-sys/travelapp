import { db } from '../db/dexie'
import { getCurrentHouseholdId } from './household'

const SWATCHES = ['#4C1D95', '#0F766E', '#B45309', '#BE123C', '#57534E']

// MemberGate（首次进APP选身份）和行程内"添加家庭成员"共用这一份逻辑，
// 不要各自维护一份新建成员的代码
export async function createMember(displayName: string): Promise<string> {
  const name = displayName.trim()
  if (!name) throw new Error('姓名不能为空')
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('未找到所属团队')
  const activeCount = (await db.members.toArray()).filter((m) => m.isActive).length
  const id = crypto.randomUUID()
  await db.members.add({
    id,
    householdId,
    displayName: name,
    colorTag: SWATCHES[activeCount % SWATCHES.length],
    isActive: true,
    createdAt: Date.now(),
  })
  return id
}

export async function renameMember(id: string, displayName: string) {
  const name = displayName.trim()
  if (!name) throw new Error('姓名不能为空')
  await db.members.update(id, { displayName: name })
}

// 数据库层面 expense.paidBy/recordedBy、expenseSplit.memberId、
// settlement.fromMemberId/toMemberId 这些外键都是 on delete restrict——
// 一个成员只要记过账/被分摊过/有过结算，就不可能真的删掉这条记录（删了历史账目
// 就变成一笔糊涂账）。删除前先查一遍这几张表，判断能不能真删
//
// 注意：expenses.paidBy/recordedBy 和 rateBookEntries.createdBy 这两张表的
// Dexie schema 没有给这些字段建索引，不能用 .where()（会直接报错），
// 只能整表扫一遍用 .filter()——家庭旅游场景数据量很小，性能完全没问题
export async function memberHasHistory(id: string): Promise<boolean> {
  const [paidCount, recordedCount, splitCount, settleFromCount, settleToCount, feedbackCount, rateCount] =
    await Promise.all([
      db.expenses.filter((e) => e.paidBy === id).count(),
      db.expenses.filter((e) => e.recordedBy === id).count(),
      db.expenseSplits.where('memberId').equals(id).count(),
      db.settlements.where('fromMemberId').equals(id).count(),
      db.settlements.where('toMemberId').equals(id).count(),
      db.feedback.where('submittedBy').equals(id).count(),
      db.rateBookEntries.filter((r) => r.createdBy === id).count(),
    ])
  return (
    paidCount + recordedCount + splitCount + settleFromCount + settleToCount + feedbackCount + rateCount > 0
  )
}

// 真删——只有在 memberHasHistory 确认过"从来没被用过"之后才能调用
export async function deleteMemberHard(id: string) {
  await db.members.delete(id)
}

// 停用——不删数据，只是不再出现在"选身份/记账/分摊"的名单里，
// 跟汇率簿"归档不删除"是同一个道理，历史记录完全不受影响
export async function deactivateMember(id: string) {
  await db.members.update(id, { isActive: false })
}

export async function reactivateMember(id: string) {
  await db.members.update(id, { isActive: true })
}
