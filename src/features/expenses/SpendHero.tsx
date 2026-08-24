import { formatMoney } from '../../lib/money'
import type { AllowanceState } from '../../domain/dailyAllowance'

// 记账页顶部那张深墨大卡——全APP唯一一个"每记一笔就会变"的大数字。
// 五种状态的判定逻辑在 domain/dailyAllowance.ts（纯函数，有单元测试），
// 这里只负责把状态画出来。
//
// 关于配色：设计稿里超支态用过一个更亮的红，但那是调色板里没有的新颜色，
// 而 negative(#B91C1C) 在深墨底上暗到几乎读不出来。所以超支态的数字继续用
// spend 橙（它本来就是"花销强调色"），"超了"这件事靠标题文案和填满的进度条表达，
// 不额外引入新颜色。

function bar(pct: number) {
  return (
    <div className="mt-2.5 h-1 rounded-full bg-paper/15 overflow-hidden">
      <div className="h-full rounded-full bg-spend" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  )
}

export function SpendHero({
  state,
  currency,
  onSetBudget,
}: {
  state: AllowanceState
  currency: string
  onSetBudget?: () => void
}) {
  const money = (n: number) => formatMoney(n, currency)

  let label: string
  let value: string
  let sub: string
  let big = true // 大数字用 spend 橙；退化状态用纸色，因为它只是陈述事实，不是可行动的额度
  let progress: number | null = null
  let cta = false

  switch (state.kind) {
    case 'daily-remaining':
      label = '今天还能花'
      value = money(state.remaining)
      sub = `今日额度 ${money(state.allowance)} · 已花 ${money(state.todaySpent)}`
      progress = state.allowance > 0 ? (state.todaySpent / state.allowance) * 100 : 0
      break
    case 'daily-over':
      label = '今天超了'
      value = money(state.over)
      sub = `今天已花 ${money(state.todaySpent)} · 额度 ${money(state.allowance)}`
      progress = 100
      break
    case 'budget-over':
      label = '已超总预算'
      value = money(state.over)
      sub = `这趟已花 ${money(state.total)} · 预算 ${money(state.budget)}`
      progress = 100
      break
    case 'no-budget':
      label = '今天已花'
      value = money(state.todaySpent)
      sub = `这趟共 ${money(state.total)}`
      big = false
      cta = true
      break
    case 'outside-trip':
      label = '这趟已花'
      value = money(state.total)
      sub = state.budget != null
        ? `预算 ${money(state.budget)} · 还剩 ${money(Math.max(0, state.budget - state.total))}`
        : '还没设预算'
      big = false
      progress = state.budget != null && state.budget > 0 ? (state.total / state.budget) * 100 : null
      cta = state.budget == null
      break
  }

  return (
    <div className="bg-ink rounded-[20px] px-[18px] pt-[18px] pb-4 text-paper mb-4">
      <div className="text-[11px] tracking-wider text-paper/55">{label}</div>
      <div className={`font-serif-sc leading-none mt-1.5 ${big ? 'text-[32px] text-spend' : 'text-[27px]'}`}>
        {value}
      </div>
      <div className="mt-2 text-[11px] text-paper/50">{sub}</div>
      {progress !== null && bar(progress)}
      {cta && onSetBudget && (
        <button onClick={onSetBudget} className="mt-2.5 text-[11px] text-[#C9B8EA]">
          设个预算，就能看到每天还能花多少 ›
        </button>
      )}
    </div>
  )
}
