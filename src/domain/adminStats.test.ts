import { describe, it, expect } from 'vitest'
import {
  isWithinDays,
  sliceDaily,
  funnelRows,
  funnelNote,
  neverCameBack,
  followUpCount,
  householdHasNoActivity,
  integerTicks,
  chartMaxValue,
  xLabelIndices,
  formatDateKeyMonthDay,
  formatMonthDay,
  formatMonthDayTime,
  isNotAuthorizedError,
  type AdminDailyRow,
  type AdminFunnel,
} from './adminStats'

function days(n: number): AdminDailyRow[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    accounts: i,
    testAccounts: 0,
    trips: 0,
  }))
}

const funnel = (f: Partial<AdminFunnel>): AdminFunnel => ({
  registered: 0,
  inHousehold: 0,
  householdHasTrip: 0,
  householdHasExpense: 0,
  householdSupported: 0,
  ...f,
})

describe('isWithinDays', () => {
  const now = Date.parse('2026-09-28T12:00:00Z')
  it('7天以内算', () => {
    expect(isWithinDays('2026-09-22T12:00:00Z', now, 7)).toBe(true)
    expect(isWithinDays('2026-09-21T12:00:00Z', now, 7)).toBe(true)
  })
  it('超过7天不算', () => {
    expect(isWithinDays('2026-09-21T11:59:59Z', now, 7)).toBe(false)
  })
  it('解析不了的时间不算', () => {
    expect(isWithinDays('not-a-date', now, 7)).toBe(false)
  })
})

describe('sliceDaily', () => {
  it('7天/30天取尾巴', () => {
    const rows = days(31)
    expect(sliceDaily(rows, '7d')).toHaveLength(7)
    expect(sliceDaily(rows, '7d')[6].date).toBe('2026-08-31')
    expect(sliceDaily(rows, '30d')).toHaveLength(30)
    expect(sliceDaily(rows, '30d')[0].date).toBe('2026-08-02')
  })
  it('数据不够时全给', () => {
    expect(sliceDaily(days(3), '30d')).toHaveLength(3)
  })
  it('全部就是原样', () => {
    const rows = days(50)
    expect(sliceDaily(rows, 'all')).toBe(rows)
  })
})

describe('funnelRows', () => {
  it('百分比相对注册人数，四舍五入', () => {
    const rows = funnelRows(funnel({ registered: 3, inHousehold: 2, householdHasTrip: 1 }))
    expect(rows.map((r) => r.percent)).toEqual([100, 67, 33, 0, 0])
  })
  it('没人注册时百分比都是0', () => {
    expect(funnelRows(funnel({})).every((r) => r.percent === 0)).toBe(true)
  })
})

describe('funnelNote', () => {
  it('没人注册 → empty', () => {
    expect(funnelNote(funnel({}))).toEqual({ kind: 'empty' })
  })
  it('一路没掉人 → noDrop', () => {
    expect(
      funnelNote(funnel({ registered: 2, inHousehold: 2, householdHasTrip: 2, householdHasExpense: 2, householdSupported: 2 })),
    ).toEqual({ kind: 'noDrop' })
  })
  it('打赏那一步不参与"掉人最多"——设计稿同一组真实数据 5/4/3/3/0 应该点出两个上手步骤', () => {
    const note = funnelNote(funnel({ registered: 5, inHousehold: 4, householdHasTrip: 3, householdHasExpense: 3, householdSupported: 0 }))
    expect(note).toEqual({
      kind: 'drops',
      lost: 1,
      drops: [
        { from: 'registered', to: 'inHousehold', lost: 1 },
        { from: 'inHousehold', to: 'householdHasTrip', lost: 1 },
      ],
    })
  })
  it('找出掉人最多的一步', () => {
    const note = funnelNote(funnel({ registered: 6, inHousehold: 5, householdHasTrip: 2, householdHasExpense: 2, householdSupported: 0 }))
    expect(note).toEqual({
      kind: 'drops',
      lost: 3,
      drops: [{ from: 'inHousehold', to: 'householdHasTrip', lost: 3 }],
    })
  })
  it('只有打赏那一步掉人 → noDrop', () => {
    expect(
      funnelNote(funnel({ registered: 2, inHousehold: 2, householdHasTrip: 2, householdHasExpense: 2, householdSupported: 0 })),
    ).toEqual({ kind: 'noDrop' })
  })
  it('并列时全部列出', () => {
    const note = funnelNote(funnel({ registered: 5, inHousehold: 4, householdHasTrip: 3, householdHasExpense: 3, householdSupported: 3 }))
    expect(note.kind).toBe('drops')
    if (note.kind !== 'drops') return
    expect(note.lost).toBe(1)
    expect(note.drops.map((d) => d.to)).toEqual(['inHousehold', 'householdHasTrip'])
  })
  it('后一步比前一步还多时不算负的掉人', () => {
    const note = funnelNote(funnel({ registered: 3, inHousehold: 3, householdHasTrip: 1, householdHasExpense: 2, householdSupported: 2 }))
    expect(note).toEqual({ kind: 'drops', lost: 2, drops: [{ from: 'inHousehold', to: 'householdHasTrip', lost: 2 }] })
  })
})

describe('neverCameBack', () => {
  const createdAt = '2026-09-27T08:52:00Z'
  it('从没打开过', () => {
    expect(neverCameBack({ createdAt, lastSeenAt: null })).toBe(true)
  })
  it('只有注册那一下（10分钟内）', () => {
    expect(neverCameBack({ createdAt, lastSeenAt: '2026-09-27T09:02:00Z' })).toBe(true)
  })
  it('之后又打开过', () => {
    expect(neverCameBack({ createdAt, lastSeenAt: '2026-09-27T09:02:01Z' })).toBe(false)
  })
})

describe('followUpCount', () => {
  it('不算测试账号', () => {
    const base = { provider: null, createdAt: '', lastSeenAt: null }
    expect(
      followUpCount([
        { ...base, email: 'a@x.com', isTest: false },
        { ...base, email: 'test@test.com', isTest: true },
      ]),
    ).toBe(1)
  })
})

describe('householdHasNoActivity', () => {
  it('没行程没账没活跃时间才算', () => {
    expect(householdHasNoActivity({ tripCount: 0, expenseCount: 0, lastActivityAt: null })).toBe(true)
    expect(householdHasNoActivity({ tripCount: 1, expenseCount: 0, lastActivityAt: null })).toBe(false)
    expect(householdHasNoActivity({ tripCount: 0, expenseCount: 0, lastActivityAt: '2026-09-01T00:00:00Z' })).toBe(false)
  })
})

describe('integerTicks', () => {
  it('小数字每个整数一条线', () => {
    expect(integerTicks(0)).toEqual([1])
    expect(integerTicks(2)).toEqual([1, 2])
    expect(integerTicks(4)).toEqual([1, 2, 3, 4])
  })
  it('大一点时换成好读的步长，最多4条', () => {
    expect(integerTicks(5)).toEqual([2, 4, 6])
    expect(integerTicks(9)).toEqual([5, 10])
    expect(integerTicks(37)).toEqual([10, 20, 30, 40])
    expect(integerTicks(120)).toEqual([50, 100, 150])
  })
})

describe('chartMaxValue', () => {
  it('账号柱把测试账号叠上去一起算', () => {
    expect(chartMaxValue([{ date: '2026-09-01', accounts: 1, testAccounts: 2, trips: 2 }])).toBe(3)
    expect(chartMaxValue([])).toBe(0)
  })
})

describe('xLabelIndices', () => {
  it('首中尾，天数少时去重', () => {
    expect(xLabelIndices(30)).toEqual([0, 14, 29])
    expect(xLabelIndices(2)).toEqual([0, 1])
    expect(xLabelIndices(1)).toEqual([0])
    expect(xLabelIndices(0)).toEqual([])
  })
})

describe('日期格式', () => {
  it('日期键直接拆，不经过时区换算', () => {
    expect(formatDateKeyMonthDay('2026-09-07')).toBe('9/7')
  })
  it('时间戳按本地时区显示', () => {
    const iso = new Date(2026, 8, 27, 16, 5).toISOString()
    expect(formatMonthDay(iso)).toBe('9/27')
    expect(formatMonthDayTime(iso)).toBe('9/27 16:05')
  })
})

describe('isNotAuthorizedError', () => {
  it('认得出权限错误', () => {
    expect(isNotAuthorizedError({ code: '42501', message: 'not authorized' })).toBe(true)
    expect(isNotAuthorizedError({ message: 'not authorized' })).toBe(true)
  })
  it('网络错误不算', () => {
    expect(isNotAuthorizedError(new TypeError('Failed to fetch'))).toBe(false)
    expect(isNotAuthorizedError(null)).toBe(false)
  })
})
