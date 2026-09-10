import { useTranslation } from 'react-i18next'
import type { Member } from '../../types'
import type { MemberSatisfactionSummary, RatingBreakdown } from '../../domain/satisfaction'
import { totalOf } from '../../domain/satisfaction'
import { Avatar } from '../../components/Avatar'
import { useStaggerEntrance } from '../../hooks/useStaggerEntrance'

// "全家整体"里的按人对比——2026-09-11讨论定的方案：不做因果分析、也不
// 强调"谁最值"（讨论时明确排除了王冠/高亮那类做法，怕在家庭语境里显得
// 太像比赛），只按"值"的占比从高到低排一下，每个人一行、两条迷你条
function MiniBar({ breakdown, entered }: { breakdown: RatingBreakdown; entered: boolean }) {
  const total = totalOf(breakdown)
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0)
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden bg-line flex-1">
      <div className="bar-fill h-full bg-positive" style={{ width: entered ? `${pct(breakdown.worth)}%` : '0%' }} />
      <div className="bar-fill h-full bg-faint" style={{ width: entered ? `${pct(breakdown.neutral)}%` : '0%' }} />
      <div className="bar-fill h-full bg-negative" style={{ width: entered ? `${pct(breakdown.regret)}%` : '0%' }} />
    </div>
  )
}

function worthRatio(s: MemberSatisfactionSummary): number {
  const worth = s.days.worth + s.expenses.worth
  const total = totalOf(s.days) + totalOf(s.expenses)
  return total > 0 ? worth / total : 0
}

export function SatisfactionByMemberCard({ summaries, members }: { summaries: MemberSatisfactionSummary[]; members: Member[] }) {
  const { t } = useTranslation()
  const { entered, enterClass, nextDelayMs, delayStyle } = useStaggerEntrance()
  const sorted = [...summaries].sort((a, b) => worthRatio(b) - worthRatio(a))

  return (
    <div className="flex flex-col">
      {sorted.map((s) => {
        const member = members.find((m) => m.id === s.memberId)
        return (
          <div
            key={s.memberId}
            className={`flex items-center gap-2.5 py-2 border-b border-line last:border-0 ${enterClass()}`}
            style={delayStyle(nextDelayMs())}
          >
            <Avatar member={member} size={26} />
            <span className="text-[12px] font-semibold w-11 flex-shrink-0 truncate">{member?.displayName ?? '?'}</span>
            <div className="flex-1 flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-muted w-9 flex-shrink-0">{t('satisfaction.tripShort')}</span>
                <MiniBar breakdown={s.days} entered={entered} />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-muted w-9 flex-shrink-0">{t('satisfaction.expenseShort')}</span>
                <MiniBar breakdown={s.expenses} entered={entered} />
              </div>
            </div>
          </div>
        )
      })}
      <div className="flex gap-3 text-[10px] text-muted mt-2">
        <span className="flex items-center gap-1"><i className="w-1.5 h-1.5 rounded-full bg-positive inline-block" />{t('satisfaction.ratingWorth')}</span>
        <span className="flex items-center gap-1"><i className="w-1.5 h-1.5 rounded-full bg-faint inline-block" />{t('satisfaction.ratingNeutral')}</span>
        <span className="flex items-center gap-1"><i className="w-1.5 h-1.5 rounded-full bg-negative inline-block" />{t('satisfaction.ratingRegret')}</span>
      </div>
    </div>
  )
}
