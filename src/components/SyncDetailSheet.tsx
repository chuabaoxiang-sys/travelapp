import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { X, Trash2 } from 'lucide-react'
import { db } from '../db/dexie'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { BottomSheet } from './BottomSheet'
import { ConfirmDialog } from './ConfirmDialog'
import type { OutboxEntry } from '../types'

// 重试到这个次数还没成功，大概率是权限/数据冲突之类不会自愈的问题，值得
// 标红提醒——次数少的还在正常等网络，不用紧张。这里刻意只是"标出来给人看"，
// 不停止重试、不引入新的终止状态：万一真是网络问题，后台该怎么重试还怎么重试
export const STUCK_THRESHOLD = 10

const TABLE_LABELS: Record<string, string> = {
  trips: '行程',
  members: '家庭成员',
  tripMembers: '行程成员',
  itineraryDays: '行程日期',
  itineraryItems: '行程项',
  rateBookEntries: '汇率簿',
  expenses: '账目',
  expenseSplits: '账目分摊',
  expenseDayAllocations: '跨天分摊',
  expenseRateAllocations: '换汇分摊',
  budgets: '预算',
  settlements: '结算记录',
  feedback: '反馈',
  wishlistPlaces: '想去的地点',
}

// 从payload里挑一个人能看懂的字段，帮用户定位"到底是哪一条"卡住了——
// 光看"账目·新增/修改"认不出是哪笔账。delete操作没有payload（见dexie.ts
// 的deleting hook），认不出来时就不显示这一行，不瞎猜
function describeRecord(entry: OutboxEntry): string | null {
  if (entry.operation === 'delete' || !entry.payload || typeof entry.payload !== 'object') return null
  const p = entry.payload as Record<string, unknown>
  const pick = (...fields: string[]) => fields.map((f) => p[f]).find((v): v is string => typeof v === 'string' && v.length > 0)
  switch (entry.tableName) {
    case 'trips':
    case 'wishlistPlaces':
      return pick('name') ?? null
    case 'members':
      return pick('displayName') ?? null
    case 'itineraryDays':
      return pick('date') ?? null
    case 'itineraryItems':
    case 'rateBookEntries':
      return pick('title', 'label') ?? null
    case 'expenses':
      return pick('description') ?? (typeof p.expenseAmount === 'number' ? `金额 ${p.expenseAmount}` : null)
    case 'settlements':
      return typeof p.amount === 'number' ? `金额 ${p.amount}` : null
    case 'feedback':
      return pick('content') ?? null
    default:
      return null
  }
}

// 约束名 -> 人话提示，覆盖 supabase/migrations 里全部的 CHECK 约束。命名不到的
// 新约束不会报错，只是拿不到人话提示、退回显示原始技术报错（见 humanizeSyncError）
const CHECK_CONSTRAINT_MESSAGES: Record<string, string> = {
  trip_check: '返程日期不能早于出发日期',
  trip_home_currency_check: '本位币代码格式不对，应该是3个大写字母，比如 MYR',
  trip_name_check: '行程名称不能是空的',
  trip_public_share_scope_check: '分享范围的值不合法',
  trip_public_share_scope_token_check: '开启分享前需要先生成分享链接',
  expense_expense_amount_check: '账目金额必须大于0',
  expense_home_amount_check: '折算后的本位币金额必须大于0',
  expense_expense_currency_check: '币种代码格式不对，应该是3个大写字母，比如 MYR',
  expense_rate_used_check: '汇率必须大于0',
  expense_day_spread_mode_check: '跨天分摊方式的值不合法',
  expense_category_name_check: '分类名称不能是空的',
  expense_day_allocation_amount_check: '跨天分摊的金额不能是负数',
  expense_rate_allocation_foreign_amount_check: '换汇分摊的外币金额必须大于0',
  expense_rate_allocation_home_amount_check: '换汇分摊的本位币金额不能是负数',
  expense_rate_allocation_rate_used_check: '换汇分摊用到的汇率必须大于0',
  expense_split_share_amount_check: '分摊金额不能是负数',
  feedback_content_check: '反馈内容不能是空的',
  itinerary_item_booking_status_check: '预约状态的值不合法',
  itinerary_item_lat_check: '纬度超出了合理范围（-90到90）',
  itinerary_item_lng_check: '经度超出了合理范围（-180到180）',
  itinerary_item_title_check: '行程项标题不能是空的',
  member_display_name_check: '成员名字不能是空的',
  rate_book_entry_currency_code_check: '币种代码格式不对，应该是3个大写字母',
  rate_book_entry_exchanged_foreign_amount_check: '实际换到的外币金额必须大于0',
  rate_book_entry_exchanged_home_amount_check: '实际付出的本位币金额必须大于0',
  rate_book_entry_label_check: '汇率标签不能是空的',
  rate_book_entry_rate_check: '汇率必须大于0',
  rate_book_entry_use_count_check: '使用次数不能是负数',
  settlement_amount_check: '结算金额必须大于0',
  settlement_check: '付款人和收款人不能是同一个人',
  budget_amount_check: '预算金额必须大于0',
  budget_alert_threshold_pct_check: '预算提醒比例必须在0到200之间',
}

// 把 db/sync.ts 里 describeError() 拼出来的原始报错（message | details | hint | code）
// 翻成人能看懂的一句话。翻不出来时返回 null，调用方保留原来只显示原始报错的样子，
// 不会因为遇到没见过的错误就什么提示都没有
function humanizeSyncError(raw: string): string | null {
  const code = raw.match(/\|\s*([A-Z0-9]{5})\s*$/)?.[1]

  // P0001 是数据库函数里手写的 RAISE EXCEPTION，消息本身已经是给人看的中文，
  // 只需要去掉拼在后面的错误码后缀
  if (code === 'P0001') return raw.replace(/\s*\|\s*P0001\s*$/, '').trim()

  // 外键约束——这条记录依赖的另一条（通常是它所属的行程）还没同步成功，
  // 不是这条记录本身有问题，等依赖项同步好了会自动跟着重试成功
  if (code === '23503') return '这条数据依赖的另一条记录还没同步成功，等它同步好之后这条会自动跟着重试，不用手动处理'

  if (code === '23514') {
    const constraint = raw.match(/constraint "([^"]+)"/)?.[1]
    if (constraint) return CHECK_CONSTRAINT_MESSAGES[constraint] ?? null
  }

  return null
}

function relativeTime(at: number, now: number): string {
  const diffMin = Math.round((now - at) / 60_000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin}分钟前`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}小时前`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 30) return `${diffDay}天前`
  return new Date(at).toISOString().slice(0, 10)
}

export function SyncDetailSheet({ onClose }: { onClose: () => void }) {
  useEscapeKey(true, onClose)
  const pending = useLiveQuery(() => db.outbox.where('status').equals('pending').sortBy('createdAt')) ?? []
  const now = Date.now()
  const sorted = [...pending].sort((a, b) => b.attempts - a.attempts)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  return (
    <>
    <BottomSheet onClose={onClose} cardClassName="px-5 pt-3.5 pb-7 max-h-[88%] overflow-y-auto no-scrollbar">
        <div className="w-[38px] h-1 rounded-full bg-handle mx-auto mb-3.5" />
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-semibold">同步详情</span>
          <button onClick={onClose} className="text-muted" title="关闭">
            <X className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </button>
        </div>

        {sorted.length === 0 ? (
          <div className="text-center py-10 text-[12px] text-muted">
            <div className="text-[26px] mb-2">✓</div>
            全部已同步，没有卡住的记录
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {sorted.map((entry: OutboxEntry) => {
              const stuck = entry.attempts >= STUCK_THRESHOLD
              const record = describeRecord(entry)
              return (
                <div
                  key={entry.id}
                  className={`rounded-xl border px-2.5 py-2 ${stuck ? 'border-negative/35 bg-negative/[0.04]' : 'border-line bg-card'}`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-[12.5px] font-semibold">
                      {TABLE_LABELS[entry.tableName] ?? entry.tableName} · {entry.operation === 'delete' ? '删除' : '新增/修改'}
                    </span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-muted">{relativeTime(entry.createdAt, now)}</span>
                      <button onClick={() => setPendingDeleteId(entry.id)} className="text-muted" title="放弃同步">
                        <Trash2 className="w-[13px] h-[13px]" strokeWidth={1.8} />
                      </button>
                    </div>
                  </div>
                  {record && <div className="text-[11px] text-ink/70 mt-0.5 truncate">{record}</div>}
                  {entry.attempts > 0 && (
                    <div className={`text-[10.5px] mt-1 flex items-center gap-1 ${stuck ? 'text-negative' : 'text-spend'}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {stuck ? `重试${entry.attempts}次，看起来卡住了` : '正常重试中'}
                    </div>
                  )}
                  {stuck && entry.lastError && (
                    <>
                      {(() => {
                        const friendly = humanizeSyncError(entry.lastError)
                        return friendly && <div className="text-[11px] text-negative mt-1.5">{friendly}</div>
                      })()}
                      <div className="text-[10px] text-muted bg-paper rounded-md px-2 py-1.5 mt-1.5 font-mono break-all">
                        {entry.lastError}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
    </BottomSheet>

      {pendingDeleteId && (
        <ConfirmDialog
          title="放弃同步这条记录？"
          message="本地这条数据不会被删除，还在你手机上——但这次改动以后不会再同步给其他设备/家人，也不会再重试。确定要放弃吗？"
          confirmLabel="放弃同步"
          onConfirm={async () => {
            await db.outbox.delete(pendingDeleteId)
            setPendingDeleteId(null)
          }}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}
    </>
  )
}
