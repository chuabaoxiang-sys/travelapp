import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { Layers, ChevronRight } from 'lucide-react'
import type { Trip } from '../../types'
import { pendingDaysForMember } from '../../domain/satisfaction'

function formatShortDate(iso: string) {
  const parts = iso.split('-')
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : iso
}

// 「翻卡回顾」的入口——不管行程进行中还是回家后都常驻，只要有已经过去
// 但当前身份还没翻的天。没有待翻的天时整个卡片不渲染，不占地方。
export function SatisfactionEntryCard({ trip, currentMemberId, onOpen }: { trip: Trip; currentMemberId: string; onOpen: () => void }) {
  const { t } = useTranslation()
  const todayISO = new Date().toLocaleDateString('sv-SE')
  const pending = useLiveQuery(
    () => pendingDaysForMember(trip.id, currentMemberId, todayISO),
    [trip.id, currentMemberId, todayISO],
  ) ?? []

  if (pending.length === 0) return null

  return (
    <button onClick={onOpen} className="rounded-2xl border border-line bg-card px-3.5 py-3 flex items-center gap-3 text-left w-full">
      <div className="w-[38px] h-[38px] rounded-[11px] flex items-center justify-center flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--color-spend) 12%, var(--color-card))' }}>
        <Layers className="w-5 h-5" strokeWidth={2} style={{ color: 'var(--color-spend)' }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-semibold">{t('satisfaction.entryTitle', { count: pending.length })}</div>
        <div className="text-[11.5px] text-muted mt-0.5 truncate">{pending.map((d) => formatShortDate(d.date)).join(' · ')}</div>
      </div>
      <ChevronRight className="w-[18px] h-[18px] text-faint flex-shrink-0" />
    </button>
  )
}
