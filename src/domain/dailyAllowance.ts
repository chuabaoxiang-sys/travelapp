// 「今天还能花」——记账页顶部那个大数字算什么、显示什么。
//
// 为什么要有这个东西：原来那个位置显示的是"团队已花费"，一个只会往上涨的总账。
// 它是个事实，但你看完没法采取任何行动，而且它不会因为你刚记了一笔而产生有意义的
// 变化——记账因此变成纯粹的义务，没有任何即时回报。
//
// 这一版改成"今天还能花"：每记一笔它就往下走，动作立刻有反馈。这也回到了设计定稿
// 原本的意图（"剩余额度大数字"、"今日还能花 RM 432" 被明确写成页面视觉锚点），
// 实现时不知为何做成了记分牌。
//
// 额度按剩余天数滚动重算，而不是固定的"总预算÷总天数"：前面几天花多了，后面每天
// 自动收紧。这样它永远回答的是"以现在的情况看，今天能花多少"，是可行动的；固定平均
// 值过了头两天就和现实脱节了。

import { daysInclusive } from '../lib/dates'

export type AllowanceState =
  // 正常：今天还能花多少
  | { kind: 'daily-remaining'; remaining: number; allowance: number; todaySpent: number; daysLeft: number }
  // 今天的额度花超了（但整趟预算还没超）
  | { kind: 'daily-over'; over: number; allowance: number; todaySpent: number }
  // 整趟预算已经超了——这时候再算"今天还能花"是自欺欺人，直接说全局
  | { kind: 'budget-over'; over: number; total: number; budget: number }
  // 没设预算：没有上限可参照，但仍然给一个"会随记账变化"的数字
  | { kind: 'no-budget'; todaySpent: number; total: number }
  // 今天不在行程期内（还没出发 / 已经回家 / 行程没设日期）：每日额度没有意义
  | { kind: 'outside-trip'; total: number; budget: number | null }

export interface AllowanceInput {
  todayISO: string // 'YYYY-MM-DD'
  startDate: string | null
  endDate: string | null
  budget: number | null // 整趟总预算，没设就是 null
  total: number // 这趟已花（本位币）
  todaySpent: number // 今天已花（本位币）
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export function resolveAllowance(input: AllowanceInput): AllowanceState {
  const { todayISO, startDate, endDate, budget, total, todaySpent } = input

  // 判定顺序是有讲究的，不能调换：
  // 先问"今天算不算这趟行程里的一天"，再问"有没有预算"，最后才轮到超支判断。
  // 反过来的话，一趟还没出发的行程会显示"今天超了"——今天根本不属于这趟行程
  const inTrip = !!startDate && !!endDate && todayISO >= startDate && todayISO <= endDate
  if (!inTrip) {
    return { kind: 'outside-trip', total: round2(total), budget }
  }

  if (budget == null) {
    return { kind: 'no-budget', todaySpent: round2(todaySpent), total: round2(total) }
  }

  if (total > budget) {
    return { kind: 'budget-over', over: round2(total - budget), total: round2(total), budget }
  }

  // 今天的额度在"今天开始的那一刻"就定下来了，然后今天的消费去吃它——
  // 所以分子要用"今天之前花掉的"，不能用含今天的总额，否则今天每记一笔都会
  // 把额度本身也压低一点，等于同一笔钱扣两次
  const spentBeforeToday = total - todaySpent
  const daysLeft = daysInclusive(todayISO, endDate!)
  // daysLeft 理论上 ≥1（已经确认 today ≤ endDate），保险起见兜一下底防止除零
  const allowance = round2((budget - spentBeforeToday) / Math.max(1, daysLeft))

  if (todaySpent > allowance) {
    return { kind: 'daily-over', over: round2(todaySpent - allowance), allowance, todaySpent: round2(todaySpent) }
  }

  return {
    kind: 'daily-remaining',
    remaining: round2(allowance - todaySpent),
    allowance,
    todaySpent: round2(todaySpent),
    daysLeft,
  }
}
