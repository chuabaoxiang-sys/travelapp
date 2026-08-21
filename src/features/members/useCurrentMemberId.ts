import { useEffect, useState } from 'react'
import { readPerTeam, writePerTeam } from '../../lib/perTeamStorage'

const CURRENT_MEMBER_KEY = 'trip-journal:current-member-id'

// 记住"我在这个团队里是谁"。按团队分开存——同一个人在两个团队里是两条不同的
// member 记录，共用一个键会让切过去之后指向一个不存在的成员。
// householdId 由 App.tsx 在确认登录状态时一并解析好传进来（同步可读，不用在这里
// 等异步查询，否则首次渲染必然取不到值）。
export function useCurrentMemberId(householdId: string | null) {
  const [id, setId] = useState<string | null>(() =>
    householdId ? readPerTeam(CURRENT_MEMBER_KEY, householdId) : null,
  )

  // 切换团队后 householdId 会变，这时要改读新团队记住的那个身份
  // （可能是 null，那就会正常走到"你是谁？"那一屏让他选）
  useEffect(() => {
    setId(householdId ? readPerTeam(CURRENT_MEMBER_KEY, householdId) : null)
  }, [householdId])

  const set = (memberId: string) => {
    if (householdId) writePerTeam(CURRENT_MEMBER_KEY, householdId, memberId)
    setId(memberId)
  }

  return [id, set] as const
}
