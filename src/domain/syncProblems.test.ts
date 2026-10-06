import { describe, it, expect } from 'vitest'
import { summarizeSyncError, shouldReportStuck, STUCK_THRESHOLD } from './syncProblems'

// 上报给服务器的错误信息绝不能带出用户填写的内容——这组测试锁定"只取规则名、
// 不取数值"这条线（0041 的隐私承诺）
describe('summarizeSyncError', () => {
  it('10-06 那次的汇率重名：只留约束名，details 里的汇率名字 rate 不能带出去', () => {
    const raw = 'duplicate key value violates unique constraint "idx_rate_book_entry_trip_currency_label" | ' +
      'Key (trip_id, currency_code, label)=(7d257967-e435-4443-b237-1f8bb3558d6a, KRW, rate) already exists. | 23505'
    const s = summarizeSyncError(raw)
    expect(s).toEqual({ code: '23505', label: 'idx_rate_book_entry_trip_currency_label' })
    expect(JSON.stringify(s)).not.toContain('rate)')
    expect(JSON.stringify(s)).not.toContain('KRW')
  })

  it('外键报错：只留约束名，details 里的记录 id 不带', () => {
    const raw = 'insert or update on table "expense" violates foreign key constraint "expense_rate_book_entry_id_fkey" | ' +
      'Key is not present in table "rate_book_entry". | 23503'
    expect(summarizeSyncError(raw)).toEqual({ code: '23503', label: 'expense_rate_book_entry_id_fkey' })
  })

  it('P0001 是我们数据库函数里写死的中文提示，原样保留', () => {
    expect(summarizeSyncError('无权操作这笔费用的分摊记录 | P0001')).toEqual({ code: 'P0001', label: '无权操作这笔费用的分摊记录' })
  })

  it('没有约束名的数据库报错只留错误码', () => {
    expect(summarizeSyncError('new row violates row-level security policy for table "expense" | 42501')).toEqual({ code: '42501', label: null })
  })

  it('浏览器层面的网络失败记成 network（Chrome 和 Safari 的说法都认）', () => {
    expect(summarizeSyncError('TypeError: Failed to fetch')).toEqual({ code: 'network', label: null })
    expect(summarizeSyncError('Load failed')).toEqual({ code: 'network', label: null })
  })

  it('看不懂的报错什么都不带——宁可少报，也不把可能含内容的原文发出去', () => {
    expect(summarizeSyncError('Something odd happened with 机场换的')).toEqual({ code: null, label: null })
    expect(summarizeSyncError(null)).toEqual({ code: null, label: null })
  })
})

describe('shouldReportStuck', () => {
  it('刚好到门槛报一次，之后每满50次再报一次，其余时候不报', () => {
    expect(shouldReportStuck(STUCK_THRESHOLD - 1)).toBe(false)
    expect(shouldReportStuck(STUCK_THRESHOLD)).toBe(true)
    expect(shouldReportStuck(STUCK_THRESHOLD + 1)).toBe(false)
    expect(shouldReportStuck(50)).toBe(true)
    expect(shouldReportStuck(75)).toBe(false)
    expect(shouldReportStuck(100)).toBe(true)
  })
})
