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

  useEffect(() => {
    if (tripResult === NOT_FOUND) onSwitchTrip()
  }, [tripResult, onSwitchTrip])

  if (tripResult === undefined || tripResult === NOT_FOUND) return null
  const trip = tripResult

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center p-4">
      <div className="w-full max-w-[420px] h-[860px] max-h-[92vh] bg-paper paper-texture rounded-[34px] overflow-hidden relative flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-3.5 text-[11px] text-muted flex-shrink-0">
          <IdentitySwitcher currentMemberId={currentMemberId} onSelectMember={onSelectMember} />
          <SyncStatusBadge />
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
          {tab === 'itinerary' && <ItineraryTab trip={trip} />}
          {tab === 'ledger' && <LedgerTab trip={trip} currentMemberId={currentMemberId} />}
          {tab === 'budget' && <BudgetTab trip={trip} />}
          {tab === 'split' && <SplitTab trip={trip} />}
        </div>

        <Fab onClick={() => setSheetOpen(true)} />
        <BottomNav active={tab} onChange={setTab} />

        {sheetOpen && (
          <AddExpenseSheet trip={trip} currentMemberId={currentMemberId} onClose={() => setSheetOpen(false)} />
        )}

        {moreOpen && (
          <TripMoreSheet
            trip={trip}
            onClose={() => setMoreOpen(false)}
            onOpenFeedback={() => { setMoreOpen(false); setFeedbackOpen(true) }}
            onOpenShareSettings={() => { setMoreOpen(false); setShareSettingsOpen(true) }}
          />
        )}

        {feedbackOpen && (
          <FeedbackSheet tripId={trip.id} currentMemberId={currentMemberId} onClose={() => setFeedbackOpen(false)} />
        )}

        {shareSettingsOpen && (
          <ShareSettingsSheet trip={trip} onClose={() => setShareSettingsOpen(false)} />
        )}
      </div>
    </div>
  )
}
