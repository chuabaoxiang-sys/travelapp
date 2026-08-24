import { describe, it, expect } from 'vitest'
import { resolveAllowance, type AllowanceInput } from './dailyAllowance'

// 一趟 2026-09-01 到 2026-09-05 的行程，总预算 5000，方便下面各用例改单项
function input(over: Partial<AllowanceInput> = {}): AllowanceInput {
  return {
    todayISO: '2026-09-03',
    startDate: '2026-09-01',
    endDate: '2026-09-05',
    budget: 5000,
    total: 2000,
    todaySpent: 100,
    ...over,
  }
}

describe('resolveAllowance', () => {
  it('正常情况：额度按"今天之前花掉的"和剩余天数算，今天的消费再从额度里扣', () => {
    // 今天之前花了 1900，剩 3100，从9/3到9/5还有3天 → 每天 1033.33，今天已花100
    const s = resolveAllowance(input())
    expect(s.kind).toBe('daily-remaining')
    if (s.kind !== 'daily-remaining') return
    expect(s.daysLeft).toBe(3)
    expect(s.allowance).toBeCloseTo(1033.33, 2)
    expect(s.remaining).toBeCloseTo(933.33, 2)
  })

  it('今天的消费不会把今天的额度本身压低——否则同一笔钱等于扣两次', () => {
    const a = resolveAllowance(input({ total: 2000, todaySpent: 100 }))
    const b = resolveAllowance(input({ total: 2400, todaySpent: 500 }))
    // 两种情况"今天之前"都花了1900，所以额度必须相同，只有已花和剩余不同
    if (a.kind !== 'daily-remaining' || b.kind !== 'daily-remaining') throw new Error('kind')
    expect(b.allowance).toBeCloseTo(a.allowance, 2)
    expect(b.remaining).toBeCloseTo(a.remaining - 400, 2)
  })

  it('前面花超了，后面每天的额度会自动收紧（这是选滚动重算而不是固定平均的理由）', () => {
    const early = resolveAllowance(input({ todayISO: '2026-09-02', total: 500, todaySpent: 0 }))
    const late = resolveAllowance(input({ todayISO: '2026-09-02', total: 3500, todaySpent: 0 }))
    if (early.kind !== 'daily-remaining' || late.kind !== 'daily-remaining') throw new Error('kind')
    expect(late.allowance).toBeLessThan(early.allowance)
  })

  it('今天花超了额度，但整趟预算还没超 → daily-over，不返回负数', () => {
    const s = resolveAllowance(input({ total: 3000, todaySpent: 1500 }))
    expect(s.kind).toBe('daily-over')
    if (s.kind !== 'daily-over') return
    expect(s.over).toBeGreaterThan(0)
  })

  it('整趟预算超了，优先报全局，不再算每日额度', () => {
    const s = resolveAllowance(input({ total: 5300, todaySpent: 100 }))
    expect(s.kind).toBe('budget-over')
    if (s.kind !== 'budget-over') return
    expect(s.over).toBeCloseTo(300, 2)
  })

  it('没设预算：退回"今天已花"，仍然是一个会随记账变化的数字', () => {
    const s = resolveAllowance(input({ budget: null }))
    expect(s.kind).toBe('no-budget')
    if (s.kind !== 'no-budget') return
    expect(s.todaySpent).toBe(100)
  })

  it('还没出发 / 已经回家 / 行程没设日期，都退回整趟视角', () => {
    expect(resolveAllowance(input({ todayISO: '2026-08-20' })).kind).toBe('outside-trip')
    expect(resolveAllowance(input({ todayISO: '2026-09-20' })).kind).toBe('outside-trip')
    expect(resolveAllowance(input({ startDate: null, endDate: null })).kind).toBe('outside-trip')
  })

  it('不在行程期内时，即使没设预算也不会被误判成 no-budget——判定顺序不能调换', () => {
    const s = resolveAllowance(input({ todayISO: '2026-08-20', budget: null }))
    expect(s.kind).toBe('outside-trip')
    if (s.kind !== 'outside-trip') return
    expect(s.budget).toBeNull()
  })

  it('行程最后一天：剩余天数是1，额度就是全部剩下的钱', () => {
    const s = resolveAllowance(input({ todayISO: '2026-09-05', total: 4000, todaySpent: 0 }))
    if (s.kind !== 'daily-remaining') throw new Error('kind')
    expect(s.daysLeft).toBe(1)
    expect(s.allowance).toBeCloseTo(1000, 2)
  })

  it('一天的行程（起止同一天）不会除零', () => {
    const s = resolveAllowance(input({
      todayISO: '2026-09-01', startDate: '2026-09-01', endDate: '2026-09-01', total: 0, todaySpent: 0,
    }))
    if (s.kind !== 'daily-remaining') throw new Error('kind')
    expect(s.daysLeft).toBe(1)
    expect(s.allowance).toBeCloseTo(5000, 2)
  })
})
