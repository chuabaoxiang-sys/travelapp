import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown } from 'lucide-react'
import { db } from '../../db/dexie'
import { BottomNav, Fab, type TabKey } from '../../components/BottomNav'
import { ItineraryTab } from '../itinerary/ItineraryTab'
import { LedgerTab } from '../expenses/LedgerTab'
import { BudgetTab } from '../budget/BudgetTab'
import { SplitTab } from '../split/SplitTab'
import { AddExpenseSheet } from '../expenses/AddExpenseSheet'
import { SyncStatusBadge } from '../../components/SyncStatusBadge'
import { TripMoreSheet } from './TripMoreSheet'
import { ShareSettingsSheet } from './ShareSettingsSheet'
import { FeedbackSheet } from '../feedback/FeedbackSheet'
import { IdentitySwitcher } from '../members/IdentitySwitcher'
import { InviteCodeSheet } from '../members/InviteCodeSheet'
import { ShareStatusBadge } from './ShareStatusBadge'
import { useBackDismiss } from '../../hooks/useBackDismiss'
import { useLastSeen, countUnseen } from './useLastSeen'
import { ActivityFeed } from '../activity/ActivityFeed'

const NOT_FOUND = Symbol('trip-not-found')

export function TripShell({
  tripId,
  currentMemberId,
  onSwitchTrip,
  onSelectMember,
}: {
  tripId: string
  currentMemberId: string
  onSwitchTrip: () => void
  onSelectMember: (id: string) => void
}) {
  // useLiveQuery 在"还没查完"和"查完了但真的没这条记录"两种情况下都会给 undefined，
  // 用 NOT_FOUND 这个哨兵值把两者区分开——不然本地存的当前行程ID一旦指向一个已经
  // 不存在的行程（换设备、行程被删、本地数据被重置……），APP会永远卡在空白页，
  // 没有任何提示，也不会自动跳回选行程界面
  const tripResult = useLiveQuery(async () => (await db.trips.get(tripId)) ?? NOT_FOUND, [tripId])
  const [tab, setTab] = useState<TabKey>('itinerary')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [shareSettingsOpen, setShareSettingsOpen] = useState(false)
  const [inviteCodeOpen, setInviteCodeOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)

  useEffect(() => {
    if (tripResult === NOT_FOUND) onSwitchTrip()
  }, [tripResult, onSwitchTrip])

  // 安卓装成PWA后没有浏览器返回按钮，系统返回键是唯一的"退一步"手势。不接这个的话
  // 弹层开着按返回会直接退出整个APP
  useBackDismiss(sheetOpen, () => setSheetOpen(false))
  useBackDismiss(moreOpen, () => setMoreOpen(false))
  useBackDismiss(feedbackOpen, () => setFeedbackOpen(false))
  useBackDismiss(shareSettingsOpen, () => setShareSettingsOpen(false))
  useBackDismiss(inviteCodeOpen, () => setInviteCodeOpen(false))
  useBackDismiss(activityOpen, () => setActivityOpen(false))

  // 未读提示：家里别人记的账，进"记账"tab之前先在tab上点个红点。只有账目能做到这件事，
  // 因为只有 expense 存了作者（recordedBy）；行程项和结算记录还没有作者字段
  const expenses = useLiveQuery(() => db.expenses.where('tripId').equals(tripId).toArray(), [tripId]) ?? []
  const { seenAt: ledgerSeenAt, markSeen: markLedgerSeen } = useLastSeen(tripId, 'ledger')
  const unseenLedger = countUnseen(expenses, ledgerSeenAt, currentMemberId, (e) => e.recordedBy)
  // 进tab时把"上次看到哪"作为高亮基准记下来，同时把这一刻标成已看过。
  // markLedgerSeen 会返回更新前的旧值，所以这里不需要再去读 ledgerSeenAt——
  // 避免了"在 effect 里引用一个自己会改掉的值"那种要靠省略依赖才能成立的写法
  const [ledgerHighlightSince, setLedgerHighlightSince] = useState(0)
  useEffect(() => {
    if (tab !== 'ledger') return
    setLedgerHighlightSince(markLedgerSeen())
  }, [tab, markLedgerSeen])

  if (tripResult === undefined || tripResult === NOT_FOUND) return null
  const trip = tripResult

  return (
    // 手机上占满整屏（100dvh 而不是 vh——地址栏伸缩时 vh 会跳）；从 sm 往上才恢复成
    // 居中的"手机框"外观。那个框是当初做可点击设计稿留下来的，在电脑上是加分项，
    // 但装到手机主屏幕之后会变成一圈深色边框 + 上下各浪费一截屏幕，反而不像原生APP
    <div className="min-h-[100dvh] bg-ink flex items-center justify-center sm:p-4">
      <div className="w-full h-[100dvh] bg-paper paper-texture overflow-hidden relative flex flex-col sm:max-w-[420px] sm:h-[860px] sm:max-h-[92vh] sm:rounded-[34px] sm:shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-safe-header text-[11px] text-muted flex-shrink-0">
          <IdentitySwitcher
            currentMemberId={currentMemberId}
            onSelectMember={onSelectMember}
            onOpenInviteCode={() => setInviteCodeOpen(true)}
          />
          <div className="flex items-center gap-2">
            <ShareStatusBadge trip={trip} onOpen={() => setShareSettingsOpen(true)} />
            <SyncStatusBadge />
          </div>
        </div>

        <div className="flex gap-2 mx-5 mt-2.5 flex-shrink-0">
          <button
            onClick={onSwitchTrip}
            className="flex-1 min-w-0 flex items-center justify-between rounded-[13px] border border-line bg-card px-3.5 py-2.5"
          >
            <div className="text-left min-w-0 flex-1">
              <div className="font-serif-sc text-[13.5px] font-semibold truncate">{trip.name}</div>
              <div className="text-[10.5px] text-muted mt-0.5 truncate">
                {trip.startDate ?? '日期未定'} {trip.endDate ? `– ${trip.endDate}` : ''} · {trip.homeCurrency}
              </div>
            </div>
            <span className="text-muted text-xs flex-shrink-0 whitespace-nowrap pl-2 flex items-center gap-0.5">
              切换
              <ChevronDown className="w-3 h-3" strokeWidth={1.8} />
            </span>
          </button>
          <button
            onClick={() => setMoreOpen(true)}
            className="w-[46px] rounded-[13px] border border-line bg-card flex items-center justify-center text-ink flex-shrink-0"
            title="导出与分享"
          >
            <svg viewBox="0 0 24 24" className="w-[19px] h-[19px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
              <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
              <circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </div>

        <div className="flex-1 relative overflow-hidden">
          {tab === 'itinerary' && <ItineraryTab trip={trip} currentMemberId={currentMemberId} />}
          {tab === 'ledger' && (
            <LedgerTab trip={trip} currentMemberId={currentMemberId} highlightSince={ledgerHighlightSince} />
          )}
          {tab === 'budget' && <BudgetTab trip={trip} />}
          {tab === 'split' && <SplitTab trip={trip} currentMemberId={currentMemberId} />}
        </div>

        <Fab onClick={() => setSheetOpen(true)} />
        <BottomNav active={tab} onChange={setTab} badges={{ ledger: unseenLedger }} />

        {sheetOpen && (
          <AddExpenseSheet trip={trip} currentMemberId={currentMemberId} onClose={() => setSheetOpen(false)} />
        )}

        {moreOpen && (
          <TripMoreSheet
            trip={trip}
            onClose={() => setMoreOpen(false)}
            onOpenFeedback={() => { setMoreOpen(false); setFeedbackOpen(true) }}
            onOpenShareSettings={() => { setMoreOpen(false); setShareSettingsOpen(true) }}
            onOpenActivity={() => { setMoreOpen(false); setActivityOpen(true) }}
          />
        )}

        {activityOpen && <ActivityFeed trip={trip} onClose={() => setActivityOpen(false)} />}

        {feedbackOpen && (
          <FeedbackSheet tripId={trip.id} currentMemberId={currentMemberId} onClose={() => setFeedbackOpen(false)} />
        )}

        {shareSettingsOpen && (
          <ShareSettingsSheet trip={trip} onClose={() => setShareSettingsOpen(false)} />
        )}

        {inviteCodeOpen && <InviteCodeSheet onClose={() => setInviteCodeOpen(false)} />}
      </div>
    </div>
  )
}
