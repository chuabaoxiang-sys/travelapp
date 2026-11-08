import { db, enqueueOutbox } from '../db/dexie'
import { getCurrentHouseholdId } from './household'
import { refundSummary } from './taxRefunds'
import type { ExpenseSplit, SplitType } from '../types'

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

// 落地一笔费用最终算出来的每人份额：先清掉这笔费用旧的 split 行（编辑场景），
// 再写入新的一份。抽成独立函数是因为"怎么算出这份份额"现在有不止一条路径——
// resolveSplitShares（整单按人数/比例/自定义分）和 domain/lineItems.ts 的
// 逐项拆账计算——但"写进数据库、怎么同步"这段逻辑两条路径必须完全一致，
// 不能各写一遍，否则容易出现"逐项拆账忘了走原子推送"这种同步坑
export interface SplitShare {
  memberId: string
  shareAmount: number
  proxyName?: string | null
  proxyAmount?: number | null
  proxyRepaidAt?: number | null
  proxyRepaidAmount?: number | null
  proxyGiftMemberIds?: string[] | null
}

export async function persistExpenseSplitShares(expenseId: string, shares: SplitShare[]) {
  const householdId = await getCurrentHouseholdId()
  if (!householdId) throw new Error('No household found')
  const rows: ExpenseSplit[] = shares.map((s) => ({
    id: crypto.randomUUID(), householdId, expenseId, memberId: s.memberId, shareAmount: s.shareAmount, deletedAt: null,
    proxyName: s.proxyName ?? null, proxyAmount: s.proxyAmount ?? null, proxyRepaidAt: s.proxyRepaidAt ?? null,
    proxyRepaidAmount: s.proxyRepaidAmount ?? null, proxyGiftMemberIds: s.proxyGiftMemberIds?.length ? s.proxyGiftMemberIds : null,
  }))
  // 写分摊和入队放在同一个事务里：后台拉取不会刚好插在"新分摊写好了、还没入队"
  // 的空档里，把这几行当成"云端已删除"清掉
  await db.transaction('rw', db.expenseSplits, db.outbox, async () => {
    await db.expenseSplits.where('expenseId').equals(expenseId).delete()
    await db.expenseSplits.bulkAdd(rows)

    // expenseSplits 不走通用的逐行同步 hook（见 db/dexie.ts 里 SYNCED_TABLES 的注释）——
    // 这里手动打包成"这笔费用的完整分摊名单"一条 entry，pushOutbox 会整批原子推送，
    // 不会再被数据库那道"总额必须等于费用总额"的延迟约束卡在中间状态
    await enqueueOutbox('expenseSplits', expenseId, 'upsert', { expenseId, rows })
  })
}

// 整单按人数/比例/自定义金额分——最常见的路径，直接调用 resolveSplitShares 算好
// 份额再交给 persistExpenseSplitShares 落地
export async function saveExpenseSplits(
  expenseId: string,
  homeAmount: number,
  splitType: SplitType,
  memberIds: string[],
  payerId: string,
  customAmounts?: Record<string, number>,
  proxy?: { listPrice: number; lines: ProxyLine[] },
) {
  await persistExpenseSplitShares(expenseId, buildSplitShares(homeAmount, splitType, memberIds, payerId, customAmounts, proxy))
}

// ---------------------------------------------------------------------
// 代购（2026-11-07）：一笔账里帮没来旅行的人买的那部分。存成 expenseSplits 里的
// 特殊行（见 0046_expense_split_proxy.sql）：memberId = 付款人，proxyName = 帮谁买，
// shareAmount = 这部分的本位币金额。整笔账的分摊合计照旧等于 homeAmount，
// 数据库那道合计约束、原子推送都不用改；代价是读分摊的地方要用 isProxySplit
// 认出这种行——同行者之间谁欠谁、"我的花费"都不算它们
// ---------------------------------------------------------------------

export interface ProxyLine {
  name: string
  amount: number // 按这笔账自己的币种（照收据填的外币）
  repaidAt?: number | null
  // 0052：这两项只是跟着行走，重算分摊（编辑、补刷卡扣款）时不能丢
  repaidAmount?: number | null
  giftMemberIds?: string[] | null
}

export function isProxySplit(s: { proxyName?: string | null }): boolean {
  return !!s.proxyName
}

// 送礼（0052）：代购行标了"送给他/她"——不用还了，这部分成本由一起送的同行者平分，
// 算进同行者之间的结算（"垫付"也不再扣掉它）
// 整笔送：标了送礼、没有"实际收了多少"
export function isGiftProxy(s: { proxyName?: string | null; proxyGiftMemberIds?: string[] | null; proxyRepaidAmount?: number | null }): boolean {
  return !!s.proxyName && !!s.proxyGiftMemberIds?.length && s.proxyRepaidAmount == null
}

// 部分送礼（2026-11-08）：标已还时实际收得比该还的少，差额选了「送的」——这一行同时
// 记着实际收了多少（proxyRepaidAmount）和一起送的人（proxyGiftMemberIds）。
// 差额 = 该还 − 实际收，由一起送的人平分，进同行者之间的结算；不需要新的数据库栏位
export function isPartialGiftProxy(s: { proxyName?: string | null; proxyGiftMemberIds?: string[] | null; proxyRepaidAmount?: number | null }): boolean {
  return !!s.proxyName && !!s.proxyGiftMemberIds?.length && s.proxyRepaidAmount != null
}

export function partialGiftAmount(
  s: { shareAmount: number; proxyAmount?: number | null; proxyName?: string | null; proxyGiftMemberIds?: string[] | null; proxyRepaidAmount?: number | null },
  e: { homeAmount: number; expenseAmount: number; discountAmount?: number | null; proxyDiscountShared?: boolean },
): number {
  if (!isPartialGiftProxy(s)) return 0
  return Math.max(0, round2(proxyReceivable(s, e) - (s.proxyRepaidAmount ?? 0)))
}

// 一行送礼的代购，按一起送的人平分成每人多少（零头给第一个人）
export function giftShares(s: { shareAmount: number; proxyGiftMemberIds?: string[] | null }): { memberId: string; shareAmount: number }[] {
  const ids = s.proxyGiftMemberIds ?? []
  if (!ids.length) return []
  const base = Math.floor((s.shareAmount / ids.length) * 100) / 100
  const remainder = round2(s.shareAmount - base * ids.length)
  return ids.map((id, i) => ({ memberId: id, shareAmount: i === 0 ? round2(base + remainder) : base }))
}

// 这笔账里每个同行者的份额：普通分摊行 + 送礼代购分到他头上的（0052）+ 部分送礼的
// 差额分到他头上的（需要传 expense 才算得出该还多少）。
// 结算、按笔结算、"你的份额"都用这一个，口径不会跑偏
export function memberSharesOfExpense(
  splits: { memberId: string; shareAmount: number; proxyName?: string | null; proxyAmount?: number | null; proxyGiftMemberIds?: string[] | null; proxyRepaidAmount?: number | null }[],
  expense?: { homeAmount: number; expenseAmount: number; discountAmount?: number | null; proxyDiscountShared?: boolean },
): Map<string, number> {
  const m = new Map<string, number>()
  const add = (id: string, n: number) => m.set(id, round2((m.get(id) ?? 0) + n))
  for (const s of splits) {
    if (!isProxySplit(s)) add(s.memberId, s.shareAmount)
    else if (isGiftProxy(s)) for (const g of giftShares(s)) add(g.memberId, g.shareAmount)
    else if (expense && isPartialGiftProxy(s)) {
      for (const g of giftShares({ shareAmount: partialGiftAmount(s, expense), proxyGiftMemberIds: s.proxyGiftMemberIds })) add(g.memberId, g.shareAmount)
    }
  }
  return m
}

// 每行代购折成本位币（= 这部分的成本）：按"这行外币 / 整笔原价"的比例分 homeAmount——
// 刷卡补了实际扣款后同一个公式自动跟着变。listPrice = 整笔原价（实付 + 优惠，0050 起
// 代购按原价填；没有优惠时就是实付），所以有优惠时代购这部分也按比例摊到了优惠。
// 代购加起来等于整笔原价（整张收据都是帮人买的）时，四舍五入的零头补给第一行，
// 剩下的刚好是 0，不会出现 -0.01 这种负数
export function resolveProxyShares(homeAmount: number, listPrice: number, lines: ProxyLine[]) {
  const valid = lines.filter((l) => l.name.trim() && l.amount > 0)
  if (!valid.length || !(listPrice > 0)) return []
  const shares = valid.map((l) => ({
    name: l.name.trim(),
    amount: l.amount,
    repaidAt: l.repaidAt ?? null,
    repaidAmount: l.repaidAmount ?? null,
    giftMemberIds: l.giftMemberIds ?? null,
    shareAmount: round2((homeAmount * l.amount) / listPrice),
  }))
  const foreignTotal = valid.reduce((s, l) => s + l.amount, 0)
  if (Math.abs(foreignTotal - listPrice) < 0.005) {
    const diff = round2(homeAmount - shares.reduce((s, p) => s + p.shareAmount, 0))
    shares[0].shareAmount = round2(shares[0].shareAmount + diff)
  }
  return shares
}

// 整笔账的全部分摊行：先扣掉代购，剩下的按"怎么分"给同行者
export function buildSplitShares(
  homeAmount: number,
  splitType: SplitType,
  memberIds: string[],
  payerId: string,
  customAmounts?: Record<string, number>,
  proxy?: { listPrice: number; lines: ProxyLine[] },
): SplitShare[] {
  const proxyShares = proxy ? resolveProxyShares(homeAmount, proxy.listPrice, proxy.lines) : []
  const remainder = Math.max(0, round2(homeAmount - proxyShares.reduce((s, p) => s + p.shareAmount, 0)))
  return [
    ...resolveSplitShares(remainder, splitType, memberIds, payerId, customAmounts),
    ...proxyShares.map((p) => ({
      memberId: payerId,
      shareAmount: p.shareAmount,
      proxyName: p.name,
      proxyAmount: p.amount,
      proxyRepaidAt: p.repaidAt,
      proxyRepaidAmount: p.repaidAmount,
      proxyGiftMemberIds: p.giftMemberIds,
    })),
  ]
}

// 整笔原价（照收据填的那个大数字）：实付 + 优惠；没有优惠就是实付
export function expenseListPrice(e: { expenseAmount: number; discountAmount?: number | null }): number {
  return round2(e.expenseAmount + (e.discountAmount ?? 0))
}

// 代购的人要还多少（本位币）：优惠不分给他（默认）时按原价还 = 代购原价 × 这笔的汇率
// （homeAmount / 实付）；分给他、或者这笔没有优惠时，就是成本 shareAmount
export function proxyReceivable(
  s: { shareAmount: number; proxyAmount?: number | null },
  e: { homeAmount: number; expenseAmount: number; discountAmount?: number | null; proxyDiscountShared?: boolean },
): number {
  if (!((e.discountAmount ?? 0) > 0) || e.proxyDiscountShared || !(e.expenseAmount > 0)) return s.shareAmount
  return round2(((s.proxyAmount ?? 0) * e.homeAmount) / e.expenseAmount)
}

// 一笔账里代购那部分的本位币合计（不在乎还没还）
export function proxyTotal(splits: { proxyName?: string | null; shareAmount: number }[]): number {
  return round2(splits.filter(isProxySplit).reduce((s, x) => s + x.shareAmount, 0))
}

export interface PersonBalance {
  memberId: string
  paid: number
  owed: number
  settledOut: number // 这个人已经付出去结的账（减少他欠别人的）
  settledIn: number // 这个人已经收到的结账（减少别人欠他的）
  net: number // 正数=该收钱，负数=该付钱；已经把结算记录、退税抵扣进去了
  expenseCount: number
  // 退税（0053）：分到这个人头上的退税（他少花了这么多），和他手上替大家收着的退税
  // （他要把别人那份还回去）。paid/owed 保持账面口径不变，退税单独两项进 net
  refundShare?: number
  refundHeld?: number
  // 这个人付款的账里，另外替没来的人垫的代购（不含送礼的）——不进 paid，结算文字/Excel
  // 里写成「另垫了代购」，让看的人知道这部分钱去哪了（2026-11-08）
  proxyFronted?: number
}

export async function computeBalances(tripId: string): Promise<PersonBalance[]> {
  // splits/settlements 不额外按各自的 deletedAt 过滤——splits 只看它归属的
  // expense 还在不在（expenseIds 已经先排掉了软删的账目，anyOf 天然跟着排掉），
  // settlements 单独按 tripId 查，要自己过滤
  const expenses = (await db.expenses.where('tripId').equals(tripId).toArray()).filter((e) => !e.deletedAt)
  const expenseIds = expenses.map((e) => e.id)
  const splits = expenseIds.length ? await db.expenseSplits.where('expenseId').anyOf(expenseIds).toArray() : []
  const settlements = (await db.settlements.where('tripId').equals(tripId).toArray()).filter((s) => !s.deletedAt)

  const refunds = refundSummary((await db.taxRefunds.where('tripId').equals(tripId).toArray()).filter((r) => !r.deletedAt))

  // 代购那部分是付款人跟没来旅行的人之间的事，不进同行者之间的账：付款人的"垫付"
  // 扣掉代购，代购行也不算任何同行者"该分摊"的
  // 送了礼的代购（0052）不扣：那部分变成同行者自己的花费
  const proxyByExpense = new Map<string, number>()
  for (const s of splits) {
    if (isProxySplit(s) && !isGiftProxy(s)) proxyByExpense.set(s.expenseId, round2((proxyByExpense.get(s.expenseId) ?? 0) + s.shareAmount))
  }

  const paidMap = new Map<string, { amount: number; count: number }>()
  const proxyFrontedMap = new Map<string, number>()
  for (const e of expenses) {
    const cur = paidMap.get(e.paidBy) ?? { amount: 0, count: 0 }
    const proxy = proxyByExpense.get(e.id) ?? 0
    const paid = round2(e.homeAmount - proxy)
    paidMap.set(e.paidBy, { amount: round2(cur.amount + paid), count: cur.count + 1 })
    if (proxy > 0) proxyFrontedMap.set(e.paidBy, round2((proxyFrontedMap.get(e.paidBy) ?? 0) + proxy))
  }

  const owedMap = new Map<string, number>()
  const expenseById = new Map(expenses.map((e) => [e.id, e]))
  for (const s of splits) {
    if (!isProxySplit(s)) owedMap.set(s.memberId, round2((owedMap.get(s.memberId) ?? 0) + s.shareAmount))
    else if (isGiftProxy(s)) for (const g of giftShares(s)) owedMap.set(g.memberId, round2((owedMap.get(g.memberId) ?? 0) + g.shareAmount))
    else if (isPartialGiftProxy(s)) {
      // 部分送礼：差额算付款人替一起送的人垫的（垫付 +G），一起送的人平分（应分摊 +各自那份）
      const e = expenseById.get(s.expenseId)
      const gift = e ? partialGiftAmount(s, e) : 0
      if (gift > 0 && e) {
        const cur = paidMap.get(e.paidBy) ?? { amount: 0, count: 0 }
        paidMap.set(e.paidBy, { ...cur, amount: round2(cur.amount + gift) })
        for (const g of giftShares({ shareAmount: gift, proxyGiftMemberIds: s.proxyGiftMemberIds })) {
          owedMap.set(g.memberId, round2((owedMap.get(g.memberId) ?? 0) + g.shareAmount))
        }
      }
    }
  }

  const settledOutMap = new Map<string, number>()
  const settledInMap = new Map<string, number>()
  for (const s of settlements) {
    settledOutMap.set(s.fromMemberId, round2((settledOutMap.get(s.fromMemberId) ?? 0) + s.amount))
    settledInMap.set(s.toMemberId, round2((settledInMap.get(s.toMemberId) ?? 0) + s.amount))
  }

  const memberIds = new Set([
    ...paidMap.keys(), ...owedMap.keys(), ...settledOutMap.keys(), ...settledInMap.keys(),
    ...refunds.shareByMember.keys(), ...refunds.heldByMember.keys(),
  ])
  return [...memberIds].map((memberId) => {
    const paid = paidMap.get(memberId)?.amount ?? 0
    const owed = owedMap.get(memberId) ?? 0
    const settledOut = settledOutMap.get(memberId) ?? 0
    const settledIn = settledInMap.get(memberId) ?? 0
    const refundShare = refunds.shareByMember.get(memberId) ?? 0
    const refundHeld = refunds.heldByMember.get(memberId) ?? 0
    // 退税：手上收着的要还出去（−held），分到自己的那份算回给自己（+share）
    const net = round2(paid - owed + settledOut - settledIn - refundHeld + refundShare)
    return {
      memberId, paid, owed, settledOut, settledIn, net, expenseCount: paidMap.get(memberId)?.count ?? 0,
      refundShare, refundHeld, proxyFronted: proxyFrontedMap.get(memberId) ?? 0,
    }
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
  const expenses = (await db.expenses.where('tripId').equals(tripId).toArray()).filter((e) => !e.deletedAt)
  const expenseById = new Map(expenses.map((e) => [e.id, e]))
  const expenseIds = expenses.map((e) => e.id)
  const splits = expenseIds.length ? await db.expenseSplits.where('expenseId').anyOf(expenseIds).toArray() : []
  const settlements = (await db.settlements.where('tripId').equals(tripId).toArray()).filter((s) => !s.deletedAt)

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

  // 每笔账每个同行者的份额：普通分摊 + 送礼代购分到他头上的（0052），合成一条
  const splitsByExpense = new Map<string, typeof splits>()
  for (const s of splits) {
    const arr = splitsByExpense.get(s.expenseId) ?? []
    arr.push(s)
    splitsByExpense.set(s.expenseId, arr)
  }
  const afterTagged: Omit<OpenExpenseDebt, 'prepaidAmount' | 'remaining'>[] = []
  for (const [expenseId, rows] of splitsByExpense) {
    const expense = expenseById.get(expenseId)
    if (!expense) continue
    for (const [memberId, share] of memberSharesOfExpense(rows, expense)) {
      // 自己分摊给自己（付款人本人的那一份，或者splitType='none'时的整笔自留）不算欠款
      if (memberId === expense.paidBy) continue
      const settledAmount = settledMap.get(`${expenseId}:${memberId}`) ?? 0
      afterTagged.push({
        expenseId: expense.id,
        description: expense.description,
        categoryId: expense.categoryId,
        expenseDate: expense.expenseDate,
        creditorId: expense.paidBy,
        debtorId: memberId,
        totalShare: share,
        settledAmount,
      })
    }
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
