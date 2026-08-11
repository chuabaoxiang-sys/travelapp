import { db } from '../db/dexie'
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
  const id = crypto.randomUUID()
  const now = Date.now()
  const entry: Feedback = { id, ...params, createdAt: now, updatedAt: now }
  await db.feedback.add(entry)
  return id
}

export async function updateFeedback(id: string, params: { category: FeedbackCategory; content: string }) {
  await db.feedback.update(id, { ...params, updatedAt: Date.now() })
}

export async function deleteFeedback(id: string) {
  await db.feedback.delete(id)
}
