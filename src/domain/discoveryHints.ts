import { db } from '../db/dexie'

function hintId(memberId: string, hintKey: string) {
  return `${memberId}:${hintKey}`
}

export async function hasSeenHint(memberId: string, hintKey: string): Promise<boolean> {
  const row = await db.discoveryHints.get(hintId(memberId, hintKey))
  return !!row
}

export async function markHintSeen(memberId: string, hintKey: string) {
  await db.discoveryHints.put({ id: hintId(memberId, hintKey), memberId, hintKey, seenAt: Date.now() })
}
