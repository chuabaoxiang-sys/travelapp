import { useState } from 'react'

const CURRENT_MEMBER_KEY = 'trip-journal:current-member-id'

export function useCurrentMemberId() {
  const [id, setId] = useState<string | null>(() => localStorage.getItem(CURRENT_MEMBER_KEY))
  const set = (memberId: string) => {
    localStorage.setItem(CURRENT_MEMBER_KEY, memberId)
    setId(memberId)
  }
  const clear = () => {
    localStorage.removeItem(CURRENT_MEMBER_KEY)
    setId(null)
  }
  return [id, set, clear] as const
}
