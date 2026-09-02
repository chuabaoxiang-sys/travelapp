import type { TFunction } from 'i18next'
import { db } from '../db/dexie'
import { assembleExportBundle, type PersonSummary } from './export'
import { computeBalances, simplifyDebts } from './splits'
import { CATEGORY_COLORS } from '../lib/categoryColors'
import { categoryLabel } from '../lib/categoryLabel'
import { daysInclusive } from '../lib/dates'

// 旅程回顾——把这趟行程收尾时值得看一眼的东西凑成一页。
//
// 为什么需要它：这个APP此前完全没有"行后"价值。行程一结束，数据就躺在那里，
// 没有总结、没有回顾，也就没有任何理由再打开——直到下次出门。而 export.ts 里
// 其实早就把按天/按分类/按人三份汇总都算好了，只是只能通过下载 Excel 才看得到。
// 这一页基本就是把那份已有的数据摆到屏幕上，不是新算什么。
//
// 刻意不限定"只有已结束的行程才能看"：旅行中途也常常想知道"到目前为止花了多少"，
// 而且给一个中途快照几乎零成本。文案会根据行程有没有结束换个说法。

// export.ts 的 CategorySummary 只带名字（Excel/CSV 渲染器要的就是名字），
// 但这一页要给每条画一根对应分类色的条，所以在这里补上颜色再往下传，
// 而不是让UI拿名字去反查——那属于把数据问题推给渲染层
export interface RetroCategory {
  name: string
  total: number
  color: string
}

export interface TripRetrospective {
  finished: boolean
  total: number
  dayCount: number
  memberCount: number
  perPerson: number
  itemCount: number
  placeCount: number
  topDay: { date: string; total: number } | null
  categories: RetroCategory[]
  people: PersonSummary[]
  unsettledCount: number
  unsettledTotal: number
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export async function buildRetrospective(tripId: string, todayISO: string, t: TFunction): Promise<TripRetrospective> {
  const bundle = await assembleExportBundle(tripId)
  const { trip, daySummary, categorySummary, personSummary } = bundle

  const [items, allCategories] = await Promise.all([
    db.itineraryItems.where('tripId').equals(tripId).toArray(),
    db.expenseCategories.toArray(),
  ])

  // 按名字对回分类对象，用来查颜色、也用来查翻译后的显示名（export.ts的
  // CategorySummary只带原始中文名，因为Excel/CSV导出要的就是这个原始值）。
  // 分类名在预置分类里是唯一的，够用；对不上就是用户自建分类，颜色退回杂项灰、
  // 显示名保持原样——用户自己打的字不经过翻译层
  const catByName = new Map(allCategories.map((c) => [c.name, c]))
  const categories: RetroCategory[] = categorySummary.map((c) => {
    const cat = catByName.get(c.categoryName)
    return {
      name: cat ? categoryLabel(cat, t) : c.categoryName,
      total: c.total,
      color: cat ? (CATEGORY_COLORS[cat.colorVar] ?? CATEGORY_COLORS['cat-misc']) : CATEGORY_COLORS['cat-misc'],
    }
  })

  const total = round2(categorySummary.reduce((s, c) => s + c.total, 0))

  // "几天"优先用行程本身的起止（用户心里的"5日游"就是这个数），只有没设日期时
  // 才退回"有花费记录的天数"——后者会漏掉没花钱的那天，不该作为首选
  const dayCount = trip.startDate && trip.endDate
    ? daysInclusive(trip.startDate, trip.endDate)
    : daySummary.length

  // 只算真正参与了这趟行程账目的人，不是团队里所有成员——家里可能有人这次没去
  const memberCount = personSummary.filter((p) => p.paid > 0 || p.owed > 0).length

  const topDay = daySummary.length
    ? daySummary.reduce((best, d) => (d.total > best.total ? d : best))
    : null

  // 还有几笔没结：跟分账页用的是同一套算法，不另起一套，免得两处数字对不上
  const transfers = simplifyDebts(await computeBalances(tripId))

  return {
    finished: !!trip.endDate && todayISO > trip.endDate,
    total,
    dayCount,
    memberCount,
    perPerson: memberCount > 0 ? round2(total / memberCount) : 0,
    itemCount: items.length,
    placeCount: items.filter((i) => !!i.locationName).length,
    topDay,
    categories,
    people: [...personSummary].sort((a, b) => b.paid - a.paid),
    unsettledCount: transfers.length,
    unsettledTotal: round2(transfers.reduce((s, t) => s + t.amount, 0)),
  }
}
