import { db } from '../db/dexie'
import { getCurrentHouseholdId } from './household'
import type { SplitType } from '../types'

function round2(n: number) {
  return Math.round(n * 100) / 100
}

// 把一笔已经折算成本位币的金额，按分摊方式拆成每个人的份额。
// 'none'（不分摊）就是整笔算付款人自己的——这样每笔费用的分摊份额永远加总等于
// homeAmount，"谁付了多少"和"该分摊多少"才能对得上，按人结算的算法不用特判。
// 均摊时用"取整+余数给第一个人"处理分不尽的情况，避免几分钱的误差凭空消失。
export function resolveSplitShares(
  homeAmount: number,
  splitType: SplitType,
  memberIds: string[],
  payerId: string,
): { memberId: string; shareAmount: number }[] {
  if (splitType === 'none' || memberIds.length === 0) {
    return [{ memberId: payerId, shareAmount: round2(homeAmount) }]
  }
  const n = memberIds.length
  const base = Math.floor((homeAmount / n) * 100) / 100
  const remainder = round2(homeAmount - base * n)
  return memberIds.map((id, i) => ({
    memberId: id,
    shareAmount: i === 0 ? round2(base + remainder) : base,
  }))
}

// 保存一笔费用的分摊明细：先清掉这笔费用旧的 split 行（编辑场景），再按新的分摊方式重新写入
export async function saveExpenseSplits(
  expenseId: string,
  homeAmount: number,
  splitType: SplitType,
  memberIds: string[],
  payerId: string,
) {
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('未找到所属团队')
  await db.expenseSplits.where('expenseId').equals(expenseId).delete()
  const shares = resolveSplitShares(homeAmount, splitType, memberIds, payerId)
  await db.expenseSplits.bulkAdd(
    shares.map((s) => ({ id: crypto.randomUUID(), householdId, expenseId, memberId: s.memberId, shareAmount: s.shareAmount })),
  )
}

export interface PersonBalance {
  memberId: string
  paid: number
  owed: number
  settledOut: number // 这个人已经付出去结的账（减少他欠别人的）
  settledIn: number // 这个人已经收到的结账（减少别人欠他的）
  net: number // 正数=该收钱，负数=该付钱；已经把结算记录抵扣进去了
  expenseCount: number
}

export async function computeBalances(tripId: string): Promise<PersonBalance[]> {
  const expenses = await db.expenses.where('tripId').equals(tripId).toArray()
  const expenseIds = expenses.map((e) => e.id)
  const splits = expenseIds.length ? await db.expenseSplits.where('expenseId').anyOf(expenseIds).toArray() : []
  const settlements = await db.settlements.where('tripId').equals(tripId).toArray()

  const paidMap = new Map<string, { amount: number; count: number }>()
  for (const e of expenses) {
    const cur = paidMap.get(e.paidBy) ?? { amount: 0, count: 0 }
    paidMap.set(e.paidBy, { amount: round2(cur.amount + e.homeAmount), count: cur.count + 1 })
  }

  const owedMap = new Map<string, number>()
  for (const s of splits) {
    owedMap.set(s.memberId, round2((owedMap.get(s.memberId) ?? 0) + s.shareAmount))
  }

  const settledOutMap = new Map<string, number>()
  const settledInMap = new Map<string, number>()
  for (const s of settlements) {
    settledOutMap.set(s.fromMemberId, round2((settledOutMap.get(s.fromMemberId) ?? 0) + s.amount))
    settledInMap.set(s.toMemberId, round2((settledInMap.get(s.toMemberId) ?? 0) + s.amount))
  }

  const memberIds = new Set([...paidMap.keys(), ...owedMap.keys(), ...settledOutMap.keys(), ...settledInMap.keys()])
  return [...memberIds].map((memberId) => {
    const paid = paidMap.get(memberId)?.amount ?? 0
    const owed = owedMap.get(memberId) ?? 0
    const settledOut = settledOutMap.get(memberId) ?? 0
    const settledIn = settledInMap.get(memberId) ?? 0
    const net = round2(paid - owed + settledOut - settledIn)
    return { memberId, paid, owed, settledOut, settledIn, net, expenseCount: paidMap.get(memberId)?.count ?? 0 }
  })
}

export interface Transfer {
  from: string
  to: string
  amount: number
}

// 最简结算：贪心地把"该付钱的人"一个个转给"该收钱的人"，凑到净额最少的转账笔数
export function simplifyDebts(balances: PersonBalance[]): Transfer[] {
  const creditors = balances.filter((b) => b.net > 0.5).map((b) => ({ id: b.memberId, amount: b.net })).sort((a, b) => b.amount - a.amount)
  const debtors = balances.filter((b) => b.net < -0.5).map((b) => ({ id: b.memberId, amount: -b.net })).sort((a, b) => b.amount - a.amount)

  const transfers: Transfer[] = []
  let ci = 0, di = 0
  while (ci < creditors.length && di < debtors.length) {
    const amount = Math.min(creditors[ci].amount, debtors[di].amount)
    transfers.push({ from: debtors[di].id, to: creditors[ci].id, amount: round2(amount) })
    creditors[ci].amount = round2(creditors[ci].amount - amount)
    debtors[di].amount = round2(debtors[di].amount - amount)
    if (creditors[ci].amount < 0.5) ci++
    if (debtors[di].amount < 0.5) di++
  }
  return transfers
}
