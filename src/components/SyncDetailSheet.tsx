import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { X, Trash2 } from 'lucide-react'
import { db } from '../db/dexie'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { relativeTime } from '../lib/relativeTime'
import { BottomSheet } from './BottomSheet'
import { ConfirmDialog } from './ConfirmDialog'
import type { OutboxEntry } from '../types'

// 重试到这个次数还没成功，大概率是权限/数据冲突之类不会自愈的问题，值得
// 标红提醒——次数少的还在正常等网络，不用紧张。这里刻意只是"标出来给人看"，
// 不停止重试、不引入新的终止状态：万一真是网络问题，后台该怎么重试还怎么重试
export const STUCK_THRESHOLD = 10

// 从payload里挑一个人能看懂的字段，帮用户定位"到底是哪一条"卡住了——
// 光看"账目·新增/修改"认不出是哪笔账。delete操作没有payload（见dexie.ts
// 的deleting hook），认不出来时就不显示这一行，不瞎猜
function describeRecord(entry: OutboxEntry, t: TFunction): string | null {
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
      return pick('description') ?? (typeof p.expenseAmount === 'number' ? t('syncDetail.amountLabel', { amount: p.expenseAmount }) : null)
    case 'settlements':
      return typeof p.amount === 'number' ? t('syncDetail.amountLabel', { amount: p.amount }) : null
    case 'feedback':
      return pick('content') ?? null
    default:
      return null
  }
}

// 约束名列表，覆盖 supabase/migrations 里全部的 CHECK 约束——翻译文本在
// locales/*.json 的 syncDetail.constraints 里。命名不到的新约束不会报错，
// 只是拿不到人话提示、退回显示原始技术报错（见 humanizeSyncError）
const KNOWN_CONSTRAINTS = [
  'trip_check', 'trip_home_currency_check', 'trip_name_check', 'trip_public_share_scope_check',
  'trip_public_share_scope_token_check', 'expense_expense_amount_check', 'expense_home_amount_check',
  'expense_expense_currency_check', 'expense_rate_used_check', 'expense_day_spread_mode_check',
  'expense_category_name_check', 'expense_day_allocation_amount_check', 'expense_rate_allocation_foreign_amount_check',
  'expense_rate_allocation_home_amount_check', 'expense_rate_allocation_rate_used_check', 'expense_split_share_amount_check',
  'feedback_content_check', 'itinerary_item_booking_status_check', 'itinerary_item_lat_check',
  'itinerary_item_lng_check', 'itinerary_item_title_check', 'member_display_name_check',
  'rate_book_entry_currency_code_check', 'rate_book_entry_exchanged_foreign_amount_check',
  'rate_book_entry_exchanged_home_amount_check', 'rate_book_entry_label_check', 'rate_book_entry_rate_check',
  'rate_book_entry_use_count_check', 'settlement_amount_check', 'settlement_check',
  'budget_amount_check', 'budget_alert_threshold_pct_check',
] as const

// 把 db/sync.ts 里 describeError() 拼出来的原始报错（message | details | hint | code）
// 翻成人能看懂的一句话。翻不出来时返回 null，调用方保留原来只显示原始报错的样子，
// 不会因为遇到没见过的错误就什么提示都没有
function humanizeSyncError(raw: string, t: TFunction): string | null {
  const code = raw.match(/\|\s*([A-Z0-9]{5})\s*$/)?.[1]

  // P0001 是数据库函数里手写的 RAISE EXCEPTION，消息本身已经是给人看的中文，
  // 只需要去掉拼在后面的错误码后缀——这句本身没法翻译成英文，因为它是数据库
  // 存储过程里写死的中文字符串，不是这个前端能控制的文案
  if (code === 'P0001') return raw.replace(/\s*\|\s*P0001\s*$/, '').trim()

  // 外键约束——这条记录依赖的另一条（通常是它所属的行程）还没同步成功，
  // 不是这条记录本身有问题，等依赖项同步好了会自动跟着重试成功
  if (code === '23503') return t('syncDetail.dependencyWaiting')

  if (code === '23514') {
    const constraint = raw.match(/constraint "([^"]+)"/)?.[1]
    if (constraint && (KNOWN_CONSTRAINTS as readonly string[]).includes(constraint)) {
      return t(`syncDetail.constraints.${constraint}`)
    }
  }

  return null
}

export function SyncDetailSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
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
          <span className="text-sm font-semibold">{t('syncDetail.title')}</span>
          <button onClick={onClose} className="text-muted" title={t('syncDetail.close')}>
            <X className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </button>
        </div>

        {sorted.length === 0 ? (
          <div className="text-center py-10 text-[12px] text-muted">
            <div className="text-[26px] mb-2">✓</div>
            {t('syncDetail.allSynced')}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {sorted.map((entry: OutboxEntry) => {
              const stuck = entry.attempts >= STUCK_THRESHOLD
              const record = describeRecord(entry, t)
              return (
                <div
                  key={entry.id}
                  className={`rounded-xl border px-2.5 py-2 ${stuck ? 'border-negative/35 bg-negative/[0.04]' : 'border-line bg-card'}`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-[12.5px] font-semibold">
                      {t(`syncDetail.tables.${entry.tableName}`, { defaultValue: entry.tableName })} · {entry.operation === 'delete' ? t('syncDetail.opDelete') : t('syncDetail.opUpsert')}
                    </span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-muted">{relativeTime(entry.createdAt, now, t)}</span>
                      <button onClick={() => setPendingDeleteId(entry.id)} className="text-muted" title={t('syncDetail.discardTitle')}>
                        <Trash2 className="w-[13px] h-[13px]" strokeWidth={1.8} />
                      </button>
                    </div>
                  </div>
                  {record && <div className="text-[11px] text-ink/70 mt-0.5 truncate">{record}</div>}
                  {entry.attempts > 0 && (
                    <div className={`text-[10.5px] mt-1 flex items-center gap-1 ${stuck ? 'text-negative' : 'text-spend'}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {stuck ? t('syncDetail.retryStuck', { count: entry.attempts }) : t('syncDetail.retryingNormally')}
                    </div>
                  )}
                  {stuck && entry.lastError && (
                    <>
                      {(() => {
                        const friendly = humanizeSyncError(entry.lastError, t)
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
          title={t('syncDetail.discardConfirmTitle')}
          message={t('syncDetail.discardConfirmMessage')}
          confirmLabel={t('syncDetail.discardConfirm')}
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
