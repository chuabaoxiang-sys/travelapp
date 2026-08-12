import { db } from '../db/dexie'

const SWATCHES = ['#4C1D95', '#0F766E', '#B45309', '#BE123C', '#57534E']

// MemberGate（首次进APP选身份）和行程内"添加家庭成员"共用这一份逻辑，
// 不要各自维护一份新建成员的代码
export async function createMember(displayName: string): Promise<string> {
  const name = displayName.trim()
  if (!name) throw new Error('姓名不能为空')
  const activeCount = (await db.members.toArray()).filter((m) => m.isActive).length
  const id = crypto.randomUUID()
  await db.members.add({
    id,
    displayName: name,
    colorTag: SWATCHES[activeCount % SWATCHES.length],
    isActive: true,
    createdAt: Date.now(),
  })
  return id
}
