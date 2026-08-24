import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/dexie'
import type { Trip, ExpenseSplit } from '../../types'
import { formatMoney } from '../../lib/money'
import { AddExpensePage } from './AddExpensePage'
import { RateBookScreen } from '../rates/RateBookScreen'
import { getOverallBudget } from '../../domain/budgets'
import { computeBalances } from '../../domain/splits'
import { myRelatedExpenseIds, myShareOf } from '../../domain/expenses'
import { CategoryBadge } from '../../components/CategoryBadge'
import { Avatar } from '../../components/Avatar'
import { spentOnDate } from '../../domain/dayAllocations'
import { resolveAllowance } from '../../domain/dailyAllowance'
import { SpendHero } from './SpendHero'
import { useBackDismiss } from '../../hooks/useBackDismiss'
import { DiscoveryDot } from '../../components/DiscoveryDot'
import { markHintSeen } from '../../domain/discoveryHints'

export function LedgerTab({
  trip,
  currentMemberId,
  highlightSince = 0,
}: {
  trip: Trip
  currentMemberId: string
  // 比这个时间点更新、且不是自己记的账目会带一圈高亮边——让"上次打开之后家里
  // 多出来的东西"一眼能认出来，而不是混在列表里跟三天前那条长得一样
  highlightSince?: number
}) {
  const expenses = useLiveQuery(
    () => db.expenses.where('tripId').equals(trip.id).reverse().sortBy('createdAt'),
    [trip.id],
  ) ?? []
  const expenseIds = expenses.map((e) => e.id)
  const splits = useLiveQuery(
    () => (expenseIds.length ? db.expenseSplits.where('expenseId').anyOf(expenseIds).toArray() : Promise.resolve<ExpenseSplit[]>([])),
    [expenseIds.join(',')],
  ) ?? []
  const categories = useLiveQuery(() => db.expenseCategories.toArray()) ?? []
  const members = useLiveQuery(() => db.members.toArray()) ?? []
  const overallBudget = useLiveQuery(() => getOverallBudget(trip.id), [trip.id])
  // computeBalances 里的"应分摊(owed)"本来就是"这个人对这趟行程要负责多少钱"——
  // 不管是分摊来的还是自己的个人开销，一笔账只要有他的 expense_split 行就会算进去，
  // 正好就是"我的花费"这个数字，不用另外算一遍
  const balances = useLiveQuery(() => computeBalances(trip.id), [trip.id]) ?? []
  const myOwed = balances.find((b) => b.memberId === currentMemberId)?.owed ?? 0
  const [editingId, setEditingId] = useState<string | null>(null)
  const [rateBookOpen, setRateBookOpen] = useState(false)
  // "团队/我的"切换同时控制顶部数字和下面的账目列表——两个各自独立控制会出现
  // "团队总额+只看我的列表"这种自相矛盾的组合，不如合成一个视角切换更直观
  const [view, setView] = useState<'team' | 'mine'>('team')

  // 编辑账目现在是全屏页而不是带X的弹层，安卓硬件返回键是唯一预期的退出方式——
  // 之前这个入口完全没接返回键（只有TripShell里"＋"新增那条接了），弹层时代还有
  // 个明显的关闭按钮兜底，全屏页上不接会比之前更糟
  useBackDismiss(!!editingId, () => setEditingId(null))
  // 汇率簿同理——之前完全没接返回键，安卓上打开汇率簿按返回键会直接退出整个APP
  useBackDismiss(rateBookOpen, () => setRateBookOpen(false))

  const total = expenses.reduce((a, e) => a + e.homeAmount, 0)
  const currencyLabel = trip.homeCurrency === 'MYR' ? 'RM' : trip.homeCurrency

  // 用 spentOnDate（按 expenseDate 归日）而不是行程页那个 spendByDate（按
  // itineraryDayId 归日）——两者口径不同，详见 dayAllocations.ts 里的说明。
  // 这里要的是"今天从口袋里出去多少钱"，关联没关联行程都得算
  const dayAllocations = useLiveQuery(
    () => db.expenseDayAllocations.where('tripId').equals(trip.id).toArray(), [trip.id],
  ) ?? []
  const todayISO = new Date().toLocaleDateString('sv-SE') // sv-SE 的格式刚好就是 YYYY-MM-DD，且按本地时区
  const todaySpent = spentOnDate(expenses, dayAllocations, todayISO)
  const allowance = resolveAllowance({
    todayISO,
    startDate: trip.startDate,
    endDate: trip.endDate,
    budget: overallBudget?.amount ?? null,
    total,
    todaySpent,
  })
  const myExpenseIds = myRelatedExpenseIds(expenses, splits, currentMemberId)
  const visibleExpenses = view === 'mine' ? expenses.filter((e) => myExpenseIds.has(e.id)) : expenses
  const editingExpense = expenses.find((e) => e.id === editingId)

  function categoryOf(id: string) {
    return categories.find((c) => c.id === id)
  }
  function memberOf(id: string) {
    return members.find((m) => m.id === id)
  }
  function splitCountOf(expenseId: string) {
    return splits.filter((s) => s.expenseId === expenseId).length
  }

  return (
    <div className="px-5 pt-3 pb-safe-fab-clearance overflow-y-auto no-scrollbar h-full relative">
      <div className="flex items-center justify-between mb-1">
        <span className="font-serif-sc text-sm font-semibold">记账 · 共 {visibleExpenses.length} 笔</span>
        <button
          onClick={() => { setRateBookOpen(true); markHintSeen(currentMemberId, 'rateBook') }}
          className="relative w-8 h-8 rounded-[10px] bg-card border border-line flex items-center justify-center text-[14px] text-plan"
          title="汇率簿"
        >
          簿
          <DiscoveryDot memberId={currentMemberId} hintKey="rateBook" />
        </button>
      </div>

      <div className="flex border border-line rounded-xl overflow-hidden my-1.5">
        <button
          type="button"
          onClick={() => setView('team')}
          className={`flex-1 py-1.5 text-[12px] ${view === 'team' ? 'bg-ink text-paper font-medium' : 'text-muted'}`}
        >
          团队视角
        </button>
        <button
          type="button"
          onClick={() => setView('mine')}
          className={`flex-1 py-1.5 text-[12px] ${view === 'mine' ? 'bg-ink text-paper font-medium' : 'text-muted'}`}
        >
          我的花费
        </button>
      </div>

      {/* 团队视角用"今天还能花"——那是唯一会随每次记账变化的数字，也是记账这个动作
          的即时回报。"我的花费"保持整趟汇总：预算是团队级的，没有个人预算可以推出
          个人的每日额度，硬凑一个只会让人误解 */}
      {view === 'team' ? (
        <SpendHero state={allowance} currency={currencyLabel} />
      ) : (
        <div className="bg-ink rounded-[20px] px-[18px] pt-[18px] pb-4 text-paper mb-4">
          <div className="text-[11px] tracking-wider text-paper/55">我这趟要承担</div>
          <div className="font-serif-sc text-[27px] leading-none mt-1.5">{formatMoney(myOwed, currencyLabel)}</div>
          <div className="mt-2 text-[11px] text-paper/50">自己付的 + 分摊别人垫付的</div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {visibleExpenses.map((e) => {
          const cat = categoryOf(e.categoryId)
          const payer = memberOf(e.paidBy)
          const recorder = memberOf(e.recordedBy)
          const isPersonal = e.splitType === 'none'
          const myShare = myShareOf(e.id, splits, currentMemberId)
          const isNew = !!highlightSince && e.createdAt > highlightSince && e.recordedBy !== currentMemberId
          return (
            <button
              key={e.id}
              onClick={() => setEditingId(e.id)}
              className={`text-left flex items-center gap-3 bg-card rounded-2xl px-3.5 py-2.5 border transition-colors hover:border-plan/50 ${
                isNew ? 'border-spend/70 bg-spend/[.04]' : 'border-line'
              }`}
            >
              <CategoryBadge category={cat} />
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-medium truncate">{e.description || cat?.name}</div>
                <div className="text-[11px] text-muted mt-0.5 truncate">{e.expenseDate} · {cat?.name}</div>
                <div className="flex items-center gap-1.5 mt-1 min-w-0">
                  <Avatar member={payer} size={16} />
                  <span className="text-[11px] text-muted truncate">
                    {isPersonal ? payer?.displayName : `${payer?.displayName}垫付 · ${splitCountOf(e.id)}人分摊`}
                  </span>
                  {isPersonal && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-line text-muted flex-shrink-0">个人开销</span>}
                </div>
                {/* 谁记的这笔账。只在"记的人 ≠ 付钱的人"时才显示——两者相同是最常见的
                    情况，那时候多这一行纯属噪音。这个字段一直都在存，只是以前从来没
                    显示过，所以"这笔是家里别人帮我记的"完全看不出来 */}
                {recorder && e.recordedBy !== e.paidBy && (
                  <div className="text-[10.5px] text-muted/80 mt-0.5 truncate">由 {recorder.displayName} 记录</div>
                )}
                {view === 'mine' && !isPersonal && (
                  <div className="text-[11px] text-plan mt-0.5">
                    你的份额 {myShare != null ? formatMoney(myShare, trip.homeCurrency === 'MYR' ? 'RM' : trip.homeCurrency) : '—（你垫付，不分摊给自己）'}
                  </div>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[15px] tabular">{formatMoney(e.homeAmount, trip.homeCurrency === 'MYR' ? 'RM' : trip.homeCurrency)}</div>
                {e.expenseCurrency !== trip.homeCurrency && (
                  <div className="text-[10px] text-[#A79E92] tabular">{e.expenseCurrency} {e.expenseAmount}</div>
                )}
              </div>
            </button>
          )
        })}
        {!visibleExpenses.length && (
          <div className="text-[13px] text-muted py-6 text-center">
            {view === 'mine' ? '还没有跟你相关的账目' : '还没有记账，点右下角＋记一笔'}
          </div>
        )}
      </div>

      {editingExpense && (
        <AddExpensePage
          trip={trip}
          currentMemberId={currentMemberId}
          initial={editingExpense}
          onClose={() => setEditingId(null)}
        />
      )}

      {rateBookOpen && (
        <RateBookScreen trip={trip} currentMemberId={currentMemberId} onClose={() => setRateBookOpen(false)} />
      )}
    </div>
  )
}
