import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { ChevronRight, CircleDollarSign, Wallet } from 'lucide-react'
import { db } from '../../db/dexie'
import type { Trip, ExpenseSplit } from '../../types'
import { formatMoney } from '../../lib/money'
import { categoryLabel } from '../../lib/categoryLabel'
import { formatDateChipDow, formatDateChipDate } from '../../lib/dateChip'
import type { ResolvedLocale } from '../../lib/locale'
import { AddExpensePage } from './AddExpensePage'
import { RateBookScreen } from '../rates/RateBookScreen'
import { getOverallBudget, getCategoryBudgets, overBudgetCategories } from '../../domain/budgets'
import { computeBalances } from '../../domain/splits'
import { myRelatedExpenseIds, myShareOf } from '../../domain/expenses'
import { CategoryBadge } from '../../components/CategoryBadge'
import { Avatar } from '../../components/Avatar'
import { spentOnDate } from '../../domain/dayAllocations'
import { resolveAllowance, heroRawValue } from '../../domain/dailyAllowance'
import { SpendHero } from './SpendHero'
import { SpendBreakdownCard } from './SpendBreakdownCard'
import { useAnimatedNumber } from '../../hooks/useAnimatedNumber'
import { useBackDismiss } from '../../hooks/useBackDismiss'
import { DiscoveryDot } from '../../components/DiscoveryDot'
import { markHintSeen } from '../../domain/discoveryHints'
import { BudgetSheet } from '../budget/BudgetSheet'
import { SplitTab } from '../split/SplitTab'

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
  const { t, i18n } = useTranslation()
  const locale: ResolvedLocale = i18n.language === 'en' ? 'en' : 'zh'
  // 排序刻意不用Dexie的sortBy——要按"行程日期"分组、组内再按记账时间排，
  // 这是个两层排序键，不如查回来直接用JS一次排完
  const expenses = useLiveQuery(
    () => db.expenses.where('tripId').equals(trip.id).toArray(),
    [trip.id],
  ) ?? []
  const expenseIds = expenses.map((e) => e.id)
  const splits = useLiveQuery(
    () => (expenseIds.length ? db.expenseSplits.where('expenseId').anyOf(expenseIds).toArray() : Promise.resolve<ExpenseSplit[]>([])),
    [expenseIds.join(',')],
  ) ?? []
  const categories = useLiveQuery(() => db.expenseCategories.toArray()) ?? []
  const members = useLiveQuery(() => db.members.toArray()) ?? []
  // 关联行程项的名字——没写备注、又关联了具体某个行程项（比如"Toya Sun Palace"）
  // 的账目，标题不该退到分类名（"住宿现付"），那样好几笔同分类账目会长得一模
  // 一样，只能靠金额分辨；关联行程项本身就是比分类名更具体的名字
  const itineraryItems = useLiveQuery(() => db.itineraryItems.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const overallBudget = useLiveQuery(() => getOverallBudget(trip.id), [trip.id])
  const categoryBudgets = useLiveQuery(() => getCategoryBudgets(trip.id), [trip.id]) ?? []
  // "管理预算"入口只负责报"这趟已花"深色大卡没说的事——具体哪个分类超支了。
  // 总预算超没超、花了多少/还剩多少，大卡（SpendHero）早就说完了，这里不重复
  const overCategories = overBudgetCategories(expenses, categoryBudgets, categories)
  const budgetOverSubtitle =
    overCategories.length === 0
      ? null
      : overCategories.length === 1
        ? t('ledger.budgetOverOne', { category: categoryLabel(overCategories[0], t) })
        : overCategories.length === 2
          ? t('ledger.budgetOverTwo', { a: categoryLabel(overCategories[0], t), b: categoryLabel(overCategories[1], t) })
          : t('ledger.budgetOverMany', { count: overCategories.length })
  // computeBalances 里的"应分摊(owed)"本来就是"这个人对这趟行程要负责多少钱"——
  // 不管是分摊来的还是自己的个人开销，一笔账只要有他的 expense_split 行就会算进去，
  // 正好就是"我的花费"这个数字，不用另外算一遍
  const balances = useLiveQuery(() => computeBalances(trip.id), [trip.id]) ?? []
  const myOwed = balances.find((b) => b.memberId === currentMemberId)?.owed ?? 0
  const [editingId, setEditingId] = useState<string | null>(null)
  const [rateBookOpen, setRateBookOpen] = useState(false)
  const [budgetOpen, setBudgetOpen] = useState(false)
  // 日期条跳转用——scrollAreaRef是滚动容器本身，必须是position:relative，
  // 不然offsetTop会算到再往上第一个"有定位"的祖先节点上（很多情况下是body），
  // 跳转位置会整个错掉，这是做mockup原型时真的踩过的坑
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const dayRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [flashDate, setFlashDate] = useState<string | null>(null)
  function scrollToDate(date: string) {
    const container = scrollAreaRef.current
    const target = dayRefs.current.get(date)
    if (!container || !target) return
    container.scrollTo({ top: target.offsetTop - 8, behavior: 'smooth' })
    setFlashDate(date)
    setTimeout(() => setFlashDate((d) => (d === date ? null : d)), 900)
  }
  // 三段视角：全部（团队）/我的花费/结算——预算和分账不再是各自独立的tab，
  // 并进了账目页当中的两个分段，"预算"进一步降级成"全部"视角里的一个次级入口
  // （见下面的"管理预算"），因为它本来就是"花了多少"的参照系，不该跟账目分开看
  const [view, setView] = useState<'team' | 'mine' | 'settle'>('team')

  // 编辑账目现在是全屏页而不是带X的弹层，安卓硬件返回键是唯一预期的退出方式——
  // 之前这个入口完全没接返回键（只有TripShell里"＋"新增那条接了），弹层时代还有
  // 个明显的关闭按钮兜底，全屏页上不接会比之前更糟
  useBackDismiss(!!editingId, () => setEditingId(null))
  // 汇率簿同理——之前完全没接返回键，安卓上打开汇率簿按返回键会直接退出整个APP
  useBackDismiss(rateBookOpen, () => setRateBookOpen(false))
  useBackDismiss(budgetOpen, () => setBudgetOpen(false))

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
  // "全部/我的"切两张卡时，用户要看到数字本身也连续滚过去（哪怕两边含义不同），
  // 不只是卡片淡入——所以两张卡的大数字接到同一个useAnimatedNumber上，只是
  // "目标值"跟着view切换，起点永远是当前视觉上正显示的那个数
  const activeHeroValue = view === 'mine' ? myOwed : heroRawValue(allowance)
  const animatedActiveHeroValue = useAnimatedNumber(activeHeroValue)
  const myExpenseIds = myRelatedExpenseIds(expenses, splits, currentMemberId)
  const visibleExpenses = view === 'mine' ? expenses.filter((e) => myExpenseIds.has(e.id)) : expenses
  const editingExpense = expenses.find((e) => e.id === editingId)

  // 按行程日期分组——之前拍平按记账先后排，多天行程账目一多，"回看第3天花了
  // 什么"得整段划过去肉眼找。组内保留原来"最近记的排前面"的顺序
  const sortedVisibleExpenses = [...visibleExpenses].sort((a, b) => {
    if (a.expenseDate !== b.expenseDate) return a.expenseDate < b.expenseDate ? -1 : 1
    return b.createdAt - a.createdAt
  })
  const expensesByDay: { date: string; items: typeof sortedVisibleExpenses }[] = []
  for (const e of sortedVisibleExpenses) {
    const lastGroup = expensesByDay[expensesByDay.length - 1]
    if (lastGroup && lastGroup.date === e.expenseDate) lastGroup.items.push(e)
    else expensesByDay.push({ date: e.expenseDate, items: [e] })
  }

  function categoryOf(id: string) {
    return categories.find((c) => c.id === id)
  }
  function memberOf(id: string) {
    return members.find((m) => m.id === id)
  }
  function itineraryItemOf(id: string) {
    return itineraryItems.find((it) => it.id === id)
  }
  function splitCountOf(expenseId: string) {
    return splits.filter((s) => s.expenseId === expenseId).length
  }

  return (
    <div className="h-full flex flex-col relative">
      <div className="px-5 pt-3 pb-3.5 flex-shrink-0 flex flex-col gap-3.5">
        <div className="flex items-center justify-between">
          <span className="font-serif-sc text-sm font-semibold">{t('ledger.title')}</span>
          <button
            onClick={() => { setRateBookOpen(true); markHintSeen(currentMemberId, 'rateBook') }}
            className="relative w-8 h-8 rounded-[10px] bg-card border border-line flex items-center justify-center text-plan"
            title={t('ledger.rateBookTitle')}
          >
            <CircleDollarSign className="w-[15px] h-[15px]" strokeWidth={1.8} />
            <DiscoveryDot memberId={currentMemberId} hintKey="rateBook" />
          </button>
        </div>

        <div className="flex border border-line rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setView('team')}
            className={`flex-1 py-1.5 text-[12px] ${view === 'team' ? 'bg-ink text-paper font-medium' : 'text-muted'}`}
          >
            {t('ledger.tabs.all')}
          </button>
          <button
            type="button"
            onClick={() => setView('mine')}
            className={`flex-1 py-1.5 text-[12px] ${view === 'mine' ? 'bg-ink text-paper font-medium' : 'text-muted'}`}
          >
            {t('ledger.tabs.mine')}
          </button>
          <button
            type="button"
            onClick={() => setView('settle')}
            className={`flex-1 py-1.5 text-[12px] ${view === 'settle' ? 'bg-ink text-paper font-medium' : 'text-muted'}`}
          >
            {t('ledger.tabs.settle')}
          </button>
        </div>
      </div>

      {/* "结算"是分账的全部内容原样搬过来——SplitTab自己管滚动/内边距，
          跟"全部/我的"那份列表分开渲染，不共用滚动容器 */}
      {view === 'settle' ? (
        <div className="flex-1 relative overflow-hidden">
          <SplitTab trip={trip} currentMemberId={currentMemberId} />
        </div>
      ) : (
      <div
        ref={scrollAreaRef}
        className="relative px-5 pb-safe-fab-clearance overflow-y-auto no-scrollbar flex-1 min-h-0 flex flex-col gap-3.5"
      >
      {/* min-h-0：这个滚动容器自己也是flex-col，套了"按天分组"那层嵌套之后，
          Safari会让它按内容撑高而不是卡在flex-1分到的那块空间——真机上表现
          就是划不动，Chrome这边测不出来。加这个限制强制它老实待在分到的
          空间里，不管里面嵌套几层都能正常滚动 */}
      {/* 全部视角用"今天还能花"——那是唯一会随每次记账变化的数字，也是记账这个动作
          的即时回报。"我的"保持整趟汇总：预算是团队级的，没有个人预算可以推出
          个人的每日额度，硬凑一个只会让人误解 */}
      {view === 'team' ? (
        <div key="team" className="card-swap flex flex-col gap-3.5">
          <SpendHero state={allowance} currency={currencyLabel} animatedValueOverride={animatedActiveHeroValue} />
          <SpendBreakdownCard
            expenses={expenses}
            categories={categories}
            dayAllocations={dayAllocations}
            todayISO={todayISO}
            currency={currencyLabel}
          />
          {/* 预算不再是独立tab，降级成这里的一个次级入口——它本来就是"花了多少"
              的参照系，跟账目列表放在一起看才有意义，改总预算/加分类预算的表单
              逻辑完全没动，只是换了个容器（见 BudgetSheet） */}
          <button
            onClick={() => setBudgetOpen(true)}
            className="w-full flex items-center gap-3 rounded-2xl border border-line bg-card px-3.5 py-2.5 text-left"
          >
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={
                overCategories.length > 0
                  ? { background: 'color-mix(in srgb, var(--color-negative) 14%, var(--color-card))', color: 'var(--color-negative)' }
                  : { background: 'color-mix(in srgb, var(--color-plan) 13%, var(--color-card))', color: 'var(--color-plan)' }
              }
            >
              <Wallet className="w-[18px] h-[18px]" strokeWidth={1.9} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-semibold">{t('ledger.manageBudget')}</span>
              {budgetOverSubtitle && (
                <span className="block text-[11px] font-semibold mt-0.5 text-negative">{budgetOverSubtitle}</span>
              )}
            </span>
            <ChevronRight className="w-4 h-4 text-muted flex-shrink-0" strokeWidth={1.8} />
          </button>
        </div>
      ) : (
        <div key="mine" className="card-swap bg-surface-strong rounded-[20px] px-[18px] pt-[18px] pb-4 text-on-dark">
          <div className="text-[11px] tracking-wider text-on-dark/55">{t('ledger.mineHero.label')}</div>
          <div className="font-bold tracking-tight tabular text-[27px] leading-none mt-1.5">{formatMoney(animatedActiveHeroValue, currencyLabel)}</div>
          <div className="mt-2 text-[11px] text-on-dark/50">{t('ledger.mineHero.sublabel')}</div>
        </div>
      )}

      {/* 日期条：只在有不止一天记录时才出现，一天的账目本来就不用跳。
          虚线框表示这天不在行程正式日期范围内（比如出发前很早就买好的机票）——
          这类账目确实存在，不能因为不在行程日期里就没有入口跳过去看 */}
      {expensesByDay.length > 1 && (
        // min-h-min：这个横向滚动条自己也在一个flex-col容器里当flex item，
        // 浏览器对"overflow-x-auto的flex item"有个隐藏规则——纵轴的自动最小高度
        // 会被当成可滚动内容直接归零，整条日期条因此被压成0高度、内容还在但看不见。
        // 显式给个min-content撑住高度就绕开了这条规则
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-5 px-5 min-h-min">
          {expensesByDay.map(({ date }) => {
            const dow = formatDateChipDow(date, locale)
            const md = formatDateChipDate(date, locale)
            const outsideTrip = !!trip.startDate && !!trip.endDate && (date < trip.startDate || date > trip.endDate)
            return (
              <button
                key={date}
                onClick={() => scrollToDate(date)}
                className={`flex-shrink-0 rounded-xl px-2.5 py-1.5 text-center border bg-card font-serif-sc ${
                  outsideTrip ? 'border-dashed border-line text-muted' : 'border-line text-soft'
                }`}
              >
                <div className="text-[8px] opacity-70">{dow}</div>
                <div className="text-[12.5px] mt-0.5 tabular">{md}</div>
              </button>
            )
          })}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {expensesByDay.map(({ date, items }) => {
          const daySubtotal = items.reduce((a, e) => a + e.homeAmount, 0)
          return (
            <div
              key={date}
              ref={(el) => {
                if (el) dayRefs.current.set(date, el)
                else dayRefs.current.delete(date)
              }}
              className={`flex flex-col gap-2 rounded-2xl transition-shadow ${flashDate === date ? 'ring-2 ring-plan' : ''}`}
            >
              <div className="flex items-baseline justify-between">
                <span className="font-serif-sc text-[13px]">{date}</span>
                <span className="text-[11px] text-muted tabular">{t('ledger.dayTotalLabel')} {formatMoney(daySubtotal, currencyLabel)}</span>
              </div>
              {items.map((e) => {
                const cat = categoryOf(e.categoryId)
                const payer = memberOf(e.paidBy)
                const recorder = memberOf(e.recordedBy)
                const linkedItem = e.itineraryItemId ? itineraryItemOf(e.itineraryItemId) : undefined
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
                      {/* 没写备注时，先看有没有关联到具体某个行程项——那个名字比分类名
                          （"住宿现付"）具体得多，好几笔同分类账目才不会长得一模一样，
                          真的什么都没有才退到分类名兜底 */}
                      <div className="text-[13.5px] font-medium truncate">{e.description || linkedItem?.title || categoryLabel(cat, t)}</div>
                      <div className="text-[11px] text-muted mt-0.5 truncate">{categoryLabel(cat, t)}</div>
                      <div className="flex items-center gap-1.5 mt-1 min-w-0">
                        <Avatar member={payer} size={16} />
                        <span className="text-[11px] text-muted truncate">
                          {isPersonal ? payer?.displayName : t('ledger.paidBySummary', { name: payer?.displayName, count: splitCountOf(e.id) })}
                        </span>
                        {isPersonal && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-line text-muted flex-shrink-0">{t('ledger.personalBadge')}</span>}
                      </div>
                      {/* 谁记的这笔账。只在"记的人 ≠ 付钱的人"时才显示——两者相同是最常见的
                          情况，那时候多这一行纯属噪音。这个字段一直都在存，只是以前从来没
                          显示过，所以"这笔是家里别人帮我记的"完全看不出来 */}
                      {recorder && e.recordedBy !== e.paidBy && (
                        <div className="text-[10.5px] text-muted/80 mt-0.5 truncate">{t('ledger.recordedBy', { name: recorder.displayName })}</div>
                      )}
                      {view === 'mine' && !isPersonal && (
                        <div className="text-[11px] text-plan mt-0.5">
                          {t('ledger.yourShareLabel')} {myShare != null ? formatMoney(myShare, trip.homeCurrency === 'MYR' ? 'RM' : trip.homeCurrency) : t('ledger.yourShareNotApplicable')}
                        </div>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[15px] tabular">{formatMoney(e.homeAmount, trip.homeCurrency === 'MYR' ? 'RM' : trip.homeCurrency)}</div>
                      {e.expenseCurrency !== trip.homeCurrency && (
                        <div className="text-[10px] text-muted tabular">{e.expenseCurrency} {e.expenseAmount}</div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )
        })}
        {!visibleExpenses.length && (
          <div className="text-[13px] text-muted py-6 text-center">
            {view === 'mine' ? t('ledger.emptyMine') : t('ledger.emptyAll')}
          </div>
        )}
      </div>
      </div>
      )}

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

      {budgetOpen && <BudgetSheet trip={trip} onClose={() => setBudgetOpen(false)} />}
    </div>
  )
}
