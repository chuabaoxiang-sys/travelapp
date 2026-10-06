import { supabase } from '../api/supabaseClient'
import { APP_COMMIT } from '../lib/appVersion'
import type { OutboxEntry } from '../types'

// 重试到这个次数还没成功，大概率是权限/数据冲突之类不会自愈的问题——同步详情里
// 标红"看起来卡住了"、向服务器上报，都从这一刻开始。次数少的还在正常等网络
export const STUCK_THRESHOLD = 10

// 第一次到门槛报一次；之后还卡着的话每满50次再报一次，让数据后台上的"最多重试
// 几次"不至于一直停在10。每个账号每天另有服务器端的上限（见0041）
export function shouldReportStuck(attemptsAfterThisFailure: number): boolean {
  return attemptsAfterThisFailure === STUCK_THRESHOLD
    || (attemptsAfterThisFailure > STUCK_THRESHOLD && attemptsAfterThisFailure % 50 === 0)
}

export interface SyncErrorSummary {
  code: string | null
  label: string | null
}

// 从 db/sync.ts 的 describeError() 拼出来的 "message | details | hint | code" 里，
// 只挑不会带出用户内容的部分发给服务器：
//   - code：Postgres 五位错误码；浏览器层面的网络失败记成 'network'
//   - label：违反的约束名（规则名，不是数值），或者 P0001——那是我们自己数据库函数里
//     写死的中文提示，不含用户数据
// details/hint 那几段一律不要：比如重名报错的 details 是
// "Key (trip_id, currency_code, label)=(…, KRW, rate) already exists"，里面的 rate
// 就是用户自己起的汇率名字。其他看不懂的报错只报 code，宁可少报不误报内容
export function summarizeSyncError(raw: string | null): SyncErrorSummary {
  if (!raw) return { code: null, label: null }
  const code = raw.match(/\|\s*([A-Z0-9]{5})\s*$/)?.[1] ?? null
  if (!code) {
    const isNetwork = /failed to fetch|load failed|networkerror|network request failed/i.test(raw)
    return { code: isNetwork ? 'network' : null, label: null }
  }
  const message = raw.split(' | ')[0]
  if (code === 'P0001') return { code, label: message.slice(0, 120) }
  const constraint = message.match(/constraint "([^"]+)"/)?.[1] ?? null
  return { code, label: constraint }
}

// 上报和标记恢复都是"顺手报一声"：失败了（没网、本地测试模式）就算了，绝不能
// 反过来影响同步本身，所以不往外抛、调用方也不 await 结果
export function reportStuckSync(group: OutboxEntry[], lastError: string, attempts: number): void {
  if (!supabase || !group.length) return
  const { tableName, recordId, operation } = group[group.length - 1]
  const { code, label } = summarizeSyncError(lastError)
  const queuedAt = Math.min(...group.map((e) => e.createdAt))
  void supabase
    .rpc('report_sync_problem', {
      p_table: tableName,
      p_operation: operation,
      p_record_id: recordId,
      p_error_code: code,
      p_error_label: label,
      p_attempts: attempts,
      p_queued_at: new Date(queuedAt).toISOString(),
      p_app_version: APP_COMMIT,
    })
    .then(() => undefined, () => undefined)
}

export function reportSyncResolved(tableName: string, recordId: string, status: 'resolved' | 'discarded'): void {
  if (!supabase) return
  void supabase
    .rpc('resolve_sync_problem', { p_table: tableName, p_record_id: recordId, p_status: status })
    .then(() => undefined, () => undefined)
}
