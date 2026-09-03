import { db } from '../db/dexie'
import { getCurrentHouseholdId } from './household'
import { APP_COMMIT } from '../lib/appVersion'
import type { Feedback, FeedbackCategory } from '../types'

export async function getAllFeedback(): Promise<Feedback[]> {
  const all = await db.feedback.toArray()
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export async function createFeedback(params: {
  tripId: string | null
  submittedBy: string
  category: FeedbackCategory
  content: string
}) {
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('No household found')
  const id = crypto.randomUUID()
  const now = Date.now()
  // 提交这一刻的版本自动带上，不用用户自己说清楚是哪个版本
  const entry: Feedback = { id, householdId, ...params, appVersion: APP_COMMIT, createdAt: now, updatedAt: now }
  await db.feedback.add(entry)
  return id
}

export async function updateFeedback(id: string, params: { category: FeedbackCategory; content: string }) {
  await db.feedback.update(id, { ...params, updatedAt: Date.now() })
}

export async function deleteFeedback(id: string) {
  await db.feedback.delete(id)
}
