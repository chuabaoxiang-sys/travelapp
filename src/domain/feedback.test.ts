import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getAllFeedback, createFeedback, updateFeedback, deleteFeedback } from './feedback'
import { db } from '../db/dexie'
import { APP_COMMIT } from '../lib/appVersion'

vi.mock('./household', () => ({ getCurrentHouseholdId: async () => 'h1' }))

describe('反馈的增删查（真实走Dexie）', () => {
  beforeEach(async () => {
    await db.feedback.clear()
  })

  it('创建后能查到，按时间倒序排列', async () => {
    const id1 = await createFeedback({ tripId: 't1', submittedBy: 'papa', category: 'bug', content: '第一条' })
    const id2 = await createFeedback({ tripId: 't1', submittedBy: 'mama', category: 'suggestion', content: '第二条' })

    const all = await getAllFeedback()
    expect(all).toHaveLength(2)
    expect(all[0].id).toBe(id2) // 最新的排最前面
    expect(all[1].id).toBe(id1)
  })

  it('更新只改category和content，不影响submittedBy等其他字段', async () => {
    const id = await createFeedback({ tripId: null, submittedBy: 'papa', category: 'bug', content: '原内容' })
    await updateFeedback(id, { category: 'suggestion', content: '改过的内容' })

    const [feedback] = await getAllFeedback()
    expect(feedback.category).toBe('suggestion')
    expect(feedback.content).toBe('改过的内容')
    expect(feedback.submittedBy).toBe('papa')
  })

  it('删除后查不到', async () => {
    const id = await createFeedback({ tripId: null, submittedBy: 'papa', category: 'other', content: '待删除' })
    await deleteFeedback(id)
    expect(await getAllFeedback()).toHaveLength(0)
  })

  it('提交反馈自动带上当前版本号，方便排查是哪个版本报的问题', async () => {
    await createFeedback({ tripId: 't1', submittedBy: 'papa', category: 'bug', content: '测试版本号' })
    const [feedback] = await getAllFeedback()
    expect(feedback.appVersion).toBe(APP_COMMIT)
  })
})
