import { useTranslation } from 'react-i18next'
import { formatMoney } from '../../lib/money'
import { useAnimatedNumber } from '../../hooks/useAnimatedNumber'
import { heroRawValue, type AllowanceState } from '../../domain/dailyAllowance'

// 记账页顶部那张深色大卡（--color-surface-strong，不管App本身是浅色还是深色
// 模式都保持深色，是专门配出来的"深色装饰面"，不是跟随模式变化的背景）——
// 全APP唯一一个"每记一笔就会变"的大数字。五种状态的判定逻辑在
// domain/dailyAllowance.ts（纯函数，有单元测试），这里只负责把状态画出来。
//
// 关于配色：设计稿里超支态用过一个更亮的红，但那是调色板里没有的新颜色，
// 而 negative 在这张深色卡面上暗到几乎读不出来。所以超支态的数字继续用
// spend 橙（它本来就是"花销强调色"），"超了"这件事靠标题文案和填满的进度条表达，
// 不额外引入新颜色。

function bar(pct: number) {
  return (
    <div className="mt-2.5 h-1 rounded-full bg-on-dark/15 overflow-hidden">
      <div className="bar-fill h-full rounded-full bg-spend" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  )
}

export function SpendHero({
  state,
  currency,
  onSetBudget,
  animatedValueOverride,
}: {
  state: AllowanceState
  currency: string
  onSetBudget?: () => void
  // 传了就用这个（调用方自己接的useAnimatedNumber，比如LedgerTab要让数字跨越
  // "全部/我的"切换连续滚动）；不传就用组件自己内部这份，独立使用时（比如
  // OverviewTab）不用额外接线也能正常滚
  animatedValueOverride?: number
}) {
  const { t } = useTranslation()
  const money = (n: number) => formatMoney(n, currency)

  let label: string
  let sub: string
  let big = true // 大数字用 spend 橙；退化状态用纸色，因为它只是陈述事实，不是可行动的额度
  let progress: number | null = null
  let cta = false

  switch (state.kind) {
    case 'daily-remaining':
      label = t('spendHero.dailyRemaining.label')
      sub = t('spendHero.dailyRemaining.sub', { allowance: money(state.allowance), spent: money(state.todaySpent) })
      progress = state.allowance > 0 ? (state.todaySpent / state.allowance) * 100 : 0
      break
    case 'daily-over':
      label = t('spendHero.dailyOver.label')
      sub = t('spendHero.dailyOver.sub', { spent: money(state.todaySpent), allowance: money(state.allowance) })
      progress = 100
      break
    case 'budget-over':
      label = t('spendHero.budgetOver.label')
      sub = t('spendHero.budgetOver.sub', { total: money(state.total), budget: money(state.budget) })
      progress = 100
      break
    case 'no-budget':
      label = t('spendHero.noBudget.label')
      sub = t('spendHero.noBudget.sub', { total: money(state.total) })
      big = false
      cta = true
      break
    case 'outside-trip':
      label = t('spendHero.outsideTrip.label')
      sub = state.budget != null
        ? t('spendHero.outsideTrip.subWithBudget', { budget: money(state.budget), remaining: money(Math.max(0, state.budget - state.total)) })
        : t('spendHero.outsideTrip.subNoBudget')
      big = false
      progress = state.budget != null && state.budget > 0 ? (state.total / state.budget) * 100 : null
      cta = state.budget == null
      break
  }

  // 全app唯一一个"每记一笔就会变"的大数字，值得用滚动动效——别的formatMoney
  // 调用（sub行、进度条百分比）保持瞬间更新，不是全局规则。Hook不能条件调用，
  // 所以永远都算一遍内部动画，animatedValueOverride有值时才不用它
  const internalAnimated = useAnimatedNumber(heroRawValue(state))
  const value = money(animatedValueOverride ?? internalAnimated)

  return (
    <div className="bg-surface-strong rounded-[20px] px-[18px] pt-[18px] pb-4 text-on-dark">
      <div className="text-[11px] tracking-wider text-on-dark/55">{label}</div>
      <div className={`font-bold tracking-tight tabular leading-none mt-1.5 ${big ? 'text-[32px] text-spend' : 'text-[27px]'}`}>
        {value}
      </div>
      <div className="mt-2 text-[11px] text-on-dark/50">{sub}</div>
      {progress !== null && bar(progress)}
      {cta && onSetBudget && (
        <button onClick={onSetBudget} className="mt-2.5 text-[11px] text-plan-on-dark">
          {t('spendHero.setBudgetCta')}
        </button>
      )}
    </div>
  )
}
