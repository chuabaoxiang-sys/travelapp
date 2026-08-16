import { describe, it, expect } from 'vitest'
import { APP_COMMIT, formatAppVersion } from './appVersion'

describe('formatAppVersion', () => {
  // 用正则断言格式、而不是断言具体日期时间数值——因为formatAppVersion内部用的是
  // getFullYear/getHours这些本地时区方法，具体数值会随测试运行机器的时区变化，
  // 断言精确值在CI换时区时会变得脆弱
  it('格式是"commit · YYYY-MM-DD HH:mm"', () => {
    expect(formatAppVersion()).toMatch(/^\S+ · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('版本号里包含当前的APP_COMMIT', () => {
    expect(formatAppVersion()).toContain(APP_COMMIT)
  })
})
