import { db, enqueueOutbox } from '../db/dexie'
import { getCurrentHouseholdId } from './household'
import type { SplitType } from '../types'

export function round2(n: number) {
  return Math.round(n * 100) / 100
}

// 把一笔已经折算成本位币的金额，按分摊方式拆成每个人的份额。
// 'none'（不分摊）就是整笔算付款人自己的——这样每笔费用的分摊份额永远加总等于
// homeAmount，"谁付了多少"和"该分摊多少"才能对得上，按人结算的算法不用特判。
// 均摊时用"取整+余数给第一个人"处理分不尽的情况，避免几分钱的误差凭空消失。
// 'exact'：每个人分摊多少钱由 customAmounts 直接指定（调用方必须保证这些数字
// 加总等于homeAmount——数据库自己也有一道 deferred constraint trigger 兜底校验，
// 见 0001_init.sql 的 fn_check_expense_split_sum，这里的校验是给用户及时反馈，
// 不是唯一防线）
export function resolveSplitShares(
  homeAmount: number,
  splitType: SplitType,
  memberIds: string[],
  payerId: string,
  customAmounts?: Record<string, number>,
): { memberId: string; shareAmount: number }[] {
  // 防线二——正常调用方（比如AddExpensePage）传进来的名单不该有重复，但这里
  // 还是去重一遍：这是"一笔费用该拆成几份"这道计算本身的入口，任何调用方哪怕
  // 不小心传了重复id，也不该在这里被放大成重复的分摊行（真实事故：本地数据
  // 曾经因为同步时序问题出现过同一个人的重复split行，编辑页不去重就直接把
  // 这份重复名单传了进来，越保存越错）
  memberIds = [...new Set(memberIds)]
  // 分摊名单里恰好剩1人时，这笔钱要记成"那个人"欠的——哪怕那个人不是付款人本人
  // （比如"BX垫付，只勾KN" = BX帮KN全额垫付，欠款人是KN）。不能跟"没人勾选"
  // （真正的个人开销，memberIds为空）混为一谈一律记回付款人名下，那样会把
  // 该收的钱凭空记没，此前这里就是这个bug。同时这个特例也意味着"只勾1人"时
  // 不需要、也不应该走自定义金额那条路径——全额就是这一个人的
  if (memberIds.length === 1) {
    return [{ memberId: memberIds[0], shareAmount: round2(homeAmount) }]
  }
  if (splitType === 'none' || memberIds.length === 0) {
    return [{ memberId: payerId, shareAmount: round2(homeAmount) }]
  }
  if (splitType === 'exact' && customAmounts) {
    return memberIds.map((id) => ({ memberId: id, shareAmount: round2(customAmounts[id] ?? 0) }))
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
  customAmounts?: Record<string, number>,
) {
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('No household found')
  await db.expenseSplits.where('expenseId').equals(expenseId).delete()
  const shares = resolveSplitShares(homeAmount, splitType, memberIds, payerId, customAmounts)
  const rows = shares.map((s) => ({ id: crypto.randomUUID(), householdId, expenseId, memberId: s.memberId, shareAmount: s.shareAmount }))
  await db.expenseSplits.bulkAdd(rows)

  // expenseSplits 不走通用的逐行同步 hook（见 db/dexie.ts 里 SYNCED_TABLES 的注释）——
  // 这里手动打包成"这笔费用的完整分摊名单"一条 entry，pushOutbox 会整批原子推送，
  // 不会再被数据库那道"总额必须等于费用总额"的延迟约束卡在中间状态
  await enqueueOutbox('expenseSplits', expenseId, 'upsert', { expenseId, rows })
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

export interface OpenExpenseDebt {
  expenseId: string
  description: string | null
  categoryId: string
  expenseDate: string
  creditorId: string // 这笔账的付款人，也是这笔债该收钱的人
  debtorId: string // 分摊到这个人身上、还没还清的那部分
  totalShare: number // 这个人在这笔账里本来该分摊多少
  settledAmount: number // 已经用"按笔结算"还了多少
  prepaidAmount: number // 已经被预付款自动抵扣了多少
  remaining: number // 还欠多少——totalShare减掉settledAmount、prepaidAmount
}

export interface PrepaymentBalance {
  fromMemberId: string
  toMemberId: string
  remaining: number // 预付款还没被"按笔结算"抵扣完的部分
}

// 摊平出"哪笔账、谁欠谁、还没被按笔结算还清多少"，按账目日期从早到晚排序，
// 再用预付款余额池依次抵扣（预付款只挂在"谁欠谁"这一对方向上，不会抵扣到
// 别的方向、也不会碰"结算建议"生成的聚合结算）。openExpenseDebts 和
// prepaymentBalances 需要的是同一份计算结果的两个切面（前者要抵扣后的账目
// 清单，后者要抵扣剩下的池子），放一起算避免两份逻辑各写一遍、口径跑偏
async function computeOpenDebtsAndPools(tripId: string) {
  const expenses = await db.expenses.where('tripId').equals(tripId).toArray()
  const expenseById = new Map(expenses.map((e) => [e.id, e]))
  const expenseIds = expenses.map((e) => e.id)
  const splits = expenseIds.length ? await db.expenseSplits.where('expenseId').anyOf(expenseIds).toArray() : []
  const settlements = await db.settlements.where('tripId').equals(tripId).toArray()

  const settledMap = new Map<string, number>()
  for (const s of settlements) {
    if (!s.expenseId) continue
    const key = `${s.expenseId}:${s.fromMemberId}`
    settledMap.set(key, round2((settledMap.get(key) ?? 0) + s.amount))
  }

  const pools = new Map<string, number>()
  for (const s of settlements) {
    if (s.expenseId || !s.isPrepayment) continue
    const key = `${s.fromMemberId}:${s.toMemberId}`
    pools.set(key, round2((pools.get(key) ?? 0) + s.amount))
  }

  const afterTagged: Omit<OpenExpenseDebt, 'prepaidAmount' | 'remaining'>[] = []
  for (const split of splits) {
    const expense = expenseById.get(split.expenseId)
    // 自己分摊给自己（付款人本人的那一份，或者splitType='none'时的整笔自留）不算欠款
    if (!expense || split.memberId === expense.paidBy) continue
    const settledAmount = settledMap.get(`${split.expenseId}:${split.memberId}`) ?? 0
    afterTagged.push({
      expenseId: expense.id,
      description: expense.description,
      categoryId: expense.categoryId,
      expenseDate: expense.expenseDate,
      creditorId: expense.paidBy,
      debtorId: split.memberId,
      totalShare: split.shareAmount,
      settledAmount,
    })
  }
  afterTagged.sort((a, b) => a.expenseDate.localeCompare(b.expenseDate))

  // 包含已经结清的（remaining<=0.01），openExpenseDebts/closedExpenseDebts
  // 各自按remaining过滤——"查看已结清"要用到已结清那部分，不能在这里就扔掉
  const allDebts: OpenExpenseDebt[] = []
  for (const debt of afterTagged) {
    const remainingAfterTagged = Math.max(0, round2(debt.totalShare - debt.settledAmount))
    const poolKey = `${debt.debtorId}:${debt.creditorId}`
    const pool = pools.get(poolKey) ?? 0
    const prepaidAmount = round2(Math.min(pool, remainingAfterTagged))
    if (prepaidAmount > 0) pools.set(poolKey, round2(pool - prepaidAmount))
    const remaining = round2(remainingAfterTagged - prepaidAmount)
    allDebts.push({ ...debt, prepaidAmount, remaining })
  }

  return { allDebts, pools }
}

// "按笔结算"用的清单：只列还没还清的（remaining > 1分钱，留一点浮点误差容差，
// 已经用预付款抵扣完的自然从列表里消失），不管这个人跟对方之间的净额是多少
// （净额是simplifyDebts算总账用的，两者互不干扰）
export async function openExpenseDebts(tripId: string): Promise<OpenExpenseDebt[]> {
  const { allDebts } = await computeOpenDebtsAndPools(tripId)
  return allDebts.filter((d) => d.remaining > 0.01)
}

// "查看已结清"用的清单：已经被"按笔结算"、预付款、或两者一起还清的账目。
// 不记录具体是哪一笔结算/哪一次预付款还清的（预付款池子可能被好几笔账目
// 分批消耗，硬凑成一句准确的话反而复杂）——UI 用 settledAmount/prepaidAmount
// 是否>0 来决定标"按笔结算"还是"预付款抵扣"的标签，想看具体金额/日期去
// "结算记录"里找
export async function closedExpenseDebts(tripId: string): Promise<OpenExpenseDebt[]> {
  const { allDebts } = await computeOpenDebtsAndPools(tripId)
  return allDebts.filter((d) => d.remaining <= 0.01)
}

// 预付款还剩多少没花完——按"谁欠谁"这一对方向汇总，用来在"按笔结算"里提示
// "这笔钱还没抵扣完"，不然预付款全部被抵掉之前，钱去哪了不透明
export async function prepaymentBalances(tripId: string): Promise<PrepaymentBalance[]> {
  const { pools } = await computeOpenDebtsAndPools(tripId)
  return [...pools.entries()]
    .filter(([, remaining]) => remaining > 0.01)
    .map(([key, remaining]) => {
      const [fromMemberId, toMemberId] = key.split(':')
      return { fromMemberId, toMemberId, remaining }
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
