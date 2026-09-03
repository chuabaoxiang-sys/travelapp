import type { TFunction } from 'i18next'
import { db } from '../db/dexie'
import { computeBalances } from './splits'
import { categoryLabel } from '../lib/categoryLabel'
import type { Trip } from '../types'

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export interface ExportRow {
  date: string
  type: 'itinerary' | 'expense'
  title: string
  location: string | null
  categoryName: string | null
  amount: number | null
  currency: string | null
  homeAmount: number | null
  payerName: string | null
  note: string | null
}

export interface DaySummary {
  date: string
  total: number
}

export interface CategorySummary {
  categoryName: string
  total: number
}

export interface PersonSummary {
  memberName: string
  paid: number
  owed: number
  net: number
}

export interface ExportBundle {
  trip: Trip
  homeCurrency: string
  rows: ExportRow[]
  daySummary: DaySummary[]
  categorySummary: CategorySummary[]
  personSummary: PersonSummary[]
}

// 导出数据组装器：把行程记录和账目记录整理成一份干净的中间结构，
// Excel/JSON/CSV 三种渲染器都从这一份数据出发，不用各自重新查一遍库
export async function assembleExportBundle(tripId: string, t: TFunction): Promise<ExportBundle> {
  const trip = await db.trips.get(tripId)
  if (!trip) throw new Error('行程不存在')

  const [members, categories, itineraryDays, itineraryItems, expenses] = await Promise.all([
    db.members.toArray(),
    db.expenseCategories.toArray(),
    db.itineraryDays.where('tripId').equals(tripId).toArray(),
    db.itineraryItems.where('tripId').equals(tripId).toArray(),
    db.expenses.where('tripId').equals(tripId).toArray(),
  ])

  const dayById = new Map(itineraryDays.map((d) => [d.id, d]))
  const memberName = (id: string) => members.find((m) => m.id === id)?.displayName ?? t('export.unknownMember')
  const categoryName = (id: string) => {
    const cat = categories.find((c) => c.id === id)
    return cat ? categoryLabel(cat, t) : t('export.unknownCategory')
  }

  const itineraryRows: ExportRow[] = itineraryItems.map((it) => ({
    date: dayById.get(it.dayId)?.date ?? '',
    type: 'itinerary',
    title: it.title,
    location: it.locationName,
    categoryName: null,
    amount: null,
    currency: null,
    homeAmount: null,
    payerName: null,
    note: it.notes,
  }))

  const expenseRows: ExportRow[] = expenses.map((e) => ({
    date: e.expenseDate,
    type: 'expense',
    title: e.description || categoryName(e.categoryId),
    location: null,
    categoryName: categoryName(e.categoryId),
    amount: e.expenseAmount,
    currency: e.expenseCurrency,
    homeAmount: e.homeAmount,
    payerName: memberName(e.paidBy),
    note: e.description,
  }))

  const rows = [...itineraryRows, ...expenseRows].sort((a, b) => a.date.localeCompare(b.date))

  const dayMap = new Map<string, number>()
  for (const e of expenses) dayMap.set(e.expenseDate, round2((dayMap.get(e.expenseDate) ?? 0) + e.homeAmount))
  const daySummary: DaySummary[] = [...dayMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, total]) => ({ date, total }))

  const catMap = new Map<string, number>()
  for (const e of expenses) catMap.set(e.categoryId, round2((catMap.get(e.categoryId) ?? 0) + e.homeAmount))
  const categorySummary: CategorySummary[] = [...catMap.entries()]
    .map(([categoryId, total]) => ({ categoryName: categoryName(categoryId), total }))
    .sort((a, b) => b.total - a.total)

  const balances = await computeBalances(tripId)
  const personSummary: PersonSummary[] = balances.map((b) => ({
    memberName: memberName(b.memberId),
    paid: b.paid,
    owed: b.owed,
    net: b.net,
  }))

  return { trip, homeCurrency: trip.homeCurrency, rows, daySummary, categorySummary, personSummary }
}
