import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { db } from '../../db/dexie'
import type { Trip, Member } from '../../types'
import { formatMoney } from '../../lib/money'
import { categoryLabel } from '../../lib/categoryLabel'

// "谁做了什么"的数据源——抽成一个hook是因为现在有两处要用同一份数据：
// 「行程动态」整页列表，和「概览」旅途中形态里"家里刚才"那一小截。两处只是
// 展示的条数和容器不同，取数逻辑完全一样，不该各查一遍库。
export type ActivityKind = 'expense' | 'item' | 'settlement'

export interface ActivityEntry {
  id: string
  kind: ActivityKind
  at: number
  authorId: string | null
  text: string
}

export function activityKindLabel(kind: ActivityKind, t: TFunction): string {
  if (kind === 'expense') return t('activity.kindExpense')
  if (kind === 'item') return t('activity.kindItinerary')
  return t('activity.kindSettlement')
}

export const ACTIVITY_KIND_CLASS: Record<ActivityKind, string> = {
  expense: 'bg-cat-food/12 text-cat-food',
  item: 'bg-plan/12 text-plan',
  settlement: 'bg-positive/12 text-positive',
}

export function useActivityEntries(trip: Trip): { entries: ActivityEntry[]; members: Member[] } {
  const { t } = useTranslation()
  const expenses = useLiveQuery(() => db.expenses.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const items = useLiveQuery(() => db.itineraryItems.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const settlements = useLiveQuery(() => db.settlements.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const members = useLiveQuery(() => db.members.toArray()) ?? []
  const categories = useLiveQuery(() => db.expenseCategories.toArray()) ?? []

  const currency = trip.homeCurrency === 'MYR' ? 'RM' : trip.homeCurrency
  function memberName(id: string | null | undefined) {
    if (!id) return null
    return members.find((m) => m.id === id)?.displayName ?? null
  }

  const entries: ActivityEntry[] = [
    ...expenses.map((e) => ({
      id: `e-${e.id}`,
      kind: 'expense' as const,
      at: e.createdAt,
      authorId: e.recordedBy,
      text: `${e.description || categoryLabel(categories.find((c) => c.id === e.categoryId), t) || t('activity.unnamedExpense')} · ${formatMoney(e.homeAmount, currency)}`,
    })),
    ...items.map((it) => ({
      id: `i-${it.id}`,
      kind: 'item' as const,
      at: it.createdAt,
      authorId: it.createdBy,
      text: it.title,
    })),
    ...settlements.map((s) => ({
      id: `s-${s.id}`,
      kind: 'settlement' as const,
      at: s.createdAt,
      authorId: s.createdBy,
      text: t('activity.settlementText', {
        from: memberName(s.fromMemberId) ?? t('activity.someone'),
        to: memberName(s.toMemberId) ?? t('activity.someone'),
        amount: formatMoney(s.amount, currency),
      }),
    })),
  ].sort((a, b) => b.at - a.at)

  return { entries, members }
}
