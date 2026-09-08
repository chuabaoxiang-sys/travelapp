import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { Smile, Meh, Frown } from 'lucide-react'
import { db } from '../../db/dexie'
import type { SatisfactionRating } from '../../types'
import { expenseSatisfactionsFor, setExpenseSatisfaction } from '../../domain/satisfaction'
import { CenteredModal } from '../../components/CenteredModal'

const RATING_COLOR: Record<SatisfactionRating, string> = {
  worth: 'var(--color-positive)',
  neutral: 'var(--color-muted)',
  regret: 'var(--color-negative)',
}
const RATING_ICON: Record<SatisfactionRating, typeof Smile> = { worth: Smile, neutral: Meh, regret: Frown }
const RATING_ROTATE: Record<SatisfactionRating, string> = { worth: '-8deg', neutral: '6deg', regret: '-4deg' }

// 账目卡片上的"盖章"——不进翻卡片流程，谁都能随时点一下加自己的一份，
// 不同人标的各自独立，互不覆盖。整个印章堆叠区域只有一个点击目标：
// 打开"设置我自己的评分"弹层，不能通过点别人的章去改别人的
export function SatisfactionStampBadge({ expenseId, tripId, currentMemberId }: { expenseId: string; tripId: string; currentMemberId: string }) {
  const { t } = useTranslation()
  const [pickerOpen, setPickerOpen] = useState(false)
  const stamps = useLiveQuery(() => expenseSatisfactionsFor(expenseId), [expenseId]) ?? []
  const members = useLiveQuery(() => db.members.toArray()) ?? []
  const mine = stamps.find((s) => s.memberId === currentMemberId)

  async function pick(rating: SatisfactionRating | null) {
    await setExpenseSatisfaction(tripId, expenseId, currentMemberId, rating)
    setPickerOpen(false)
  }

  return (
    <>
      <div
        onClick={(e) => { e.stopPropagation(); setPickerOpen(true) }}
        className="flex items-center flex-shrink-0"
        title={t('satisfaction.stampZoneTitle')}
      >
        {stamps.map((s, i) => {
          const Icon = RATING_ICON[s.rating]
          return (
            <div
              key={s.id}
              title={members.find((m) => m.id === s.memberId)?.displayName}
              className="w-6 h-6 rounded-full border-2 bg-card flex items-center justify-center flex-shrink-0"
              style={{ borderColor: RATING_COLOR[s.rating], marginLeft: i > 0 ? -8 : 0, transform: `rotate(${RATING_ROTATE[s.rating]})` }}
            >
              <Icon className="w-3 h-3" strokeWidth={2.2} style={{ color: RATING_COLOR[s.rating] }} />
            </div>
          )
        })}
        {!mine && (
          <div
            className="w-6 h-6 rounded-full border-2 border-dashed border-faint flex items-center justify-center flex-shrink-0 text-faint text-[12px] leading-none"
            style={{ marginLeft: stamps.length > 0 ? -8 : 0 }}
          >
            +
          </div>
        )}
      </div>

      {pickerOpen && (
        <CenteredModal onClose={() => setPickerOpen(false)}>
          <div className="text-[14px] font-semibold text-center mb-3">{t('satisfaction.pickerTitle')}</div>
          <div className="flex justify-center gap-3 mb-2">
            {(['worth', 'neutral', 'regret'] as const).map((r) => {
              const Icon = RATING_ICON[r]
              const active = mine?.rating === r
              return (
                <button
                  key={r}
                  onClick={() => pick(r)}
                  className="w-[46px] h-[46px] rounded-full border flex items-center justify-center"
                  style={active ? { borderColor: RATING_COLOR[r], background: `color-mix(in srgb, ${RATING_COLOR[r]} 14%, var(--color-card))` } : { borderColor: 'var(--color-line)' }}
                >
                  <Icon className="w-5 h-5" strokeWidth={2} style={{ color: RATING_COLOR[r] }} />
                </button>
              )
            })}
          </div>
          {mine && (
            <button onClick={() => pick(null)} className="block mx-auto mt-2 text-[12px] text-muted underline">
              {t('satisfaction.clearMine')}
            </button>
          )}
        </CenteredModal>
      )}
    </>
  )
}
