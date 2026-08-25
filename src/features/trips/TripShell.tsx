import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown } from 'lucide-react'
import { db } from '../../db/dexie'
import { BottomNav, type TabKey } from '../../components/BottomNav'
import { OverviewTab } from './OverviewTab'
import { ItineraryTab } from '../itinerary/ItineraryTab'
import { LedgerTab } from '../expenses/LedgerTab'
import { AddExpensePage } from '../expenses/AddExpensePage'
import { SyncStatusBadge } from '../../components/SyncStatusBadge'
import { TripMoreSheet } from './TripMoreSheet'
import { ShareSettingsSheet } from './ShareSettingsSheet'
import { FeedbackSheet } from '../feedback/FeedbackSheet'
import { IdentitySwitcher } from '../members/IdentitySwitcher'
import { DiscoveryDot } from '../../components/DiscoveryDot'
import { markHintSeen } from '../../domain/discoveryHints'
import { InviteCodeSheet } from '../members/InviteCodeSheet'
import { ShareStatusBadge } from './ShareStatusBadge'
import { useBackDismiss } from '../../hooks/useBackDismiss'
import { useLastSeen, countUnseen } from './useLastSeen'
import { SyncDetailSheet } from '../../components/SyncDetailSheet'

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
  // "概览"取代"行程"成为默认首页——四个功能tab时代默认停在"行程"，但概览才是
  // 回答"我现在该看什么"的地方，行程/账目都是从这里再点进去的具体功能
  const [tab, setTab] = useState<TabKey>('overview')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [shareSettingsOpen, setShareSettingsOpen] = useState(false)
  const [inviteCodeOpen, setInviteCodeOpen] = useState(false)
  const [syncDetailOpen, setSyncDetailOpen] = useState(false)
  const [itineraryFormOpen, setItineraryFormOpen] = useState(false)
  // FAB在"行程"tab上被接成"添加行程项"而不是"记一笔"——它没法直接调用ItineraryTab
  // 内部的setFormState，靠这个自增计数器当信号，ItineraryTab自己的effect监听变化
  const [itineraryAddSignal, setItineraryAddSignal] = useState(0)

  useEffect(() => {
    if (tripResult === NOT_FOUND) onSwitchTrip()
  }, [tripResult, onSwitchTrip])

  // "更多"从顶部的图标按钮搬进了底部导航，点击时不再走 setTab（'more' 不是一个
  // 会渲染内容的tab，是一个开弹层的动作，跟"记一笔"是同一类东西）——不然
  // BottomNav 的 active 高亮会跳到一个没有对应内容区域的tab上
  function handleNavChange(key: TabKey) {
    if (key === 'more') {
      setMoreOpen(true)
      markHintSeen(currentMemberId, 'moreSheet')
      return
    }
    setTab(key)
  }

  // 安卓装成PWA后没有浏览器返回按钮，系统返回键是唯一的"退一步"手势。不接这个的话
  // 弹层开着按返回会直接退出整个APP
  //
  // 只按"有没有弹层开着"注册一次，而不是每个弹层各注册一次——后者在"关掉这个、
  // 同时打开那个"的切换里必然出bug：关闭方的清理函数调 history.back() 回收历史，
  // 但 back() 是异步的，等它真正触发 popstate 时，接住的已经是刚打开的那个弹层，
  // 它会以为用户按了返回键、立刻把自己关掉。表现就是"从更多面板点分享设置/提交
  // 反馈完全没反应"（真机反馈过）。合成一个之后，弹层之间切换时这个
  // hook 的 active 一直是 true，不发生卸载+装载，那个竞态从根上就不存在了
  const anySheetOpen = sheetOpen || moreOpen || feedbackOpen || shareSettingsOpen || inviteCodeOpen || syncDetailOpen
  function closeAllSheets() {
    setSheetOpen(false)
    setMoreOpen(false)
    setFeedbackOpen(false)
    setShareSettingsOpen(false)
    setInviteCodeOpen(false)
    setSyncDetailOpen(false)
  }
  useBackDismiss(anySheetOpen, closeAllSheets)

  // 未读提示：家里别人记的账，进"账目"tab之前先在tab上点个红点。只有账目能做到这件事，
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
            <SyncStatusBadge onOpenDetail={() => setSyncDetailOpen(true)} />
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
        </div>

        <div className="flex-1 relative overflow-hidden">
          {tab === 'overview' && <OverviewTab trip={trip} currentMemberId={currentMemberId} />}
          {tab === 'itinerary' && (
            <ItineraryTab
              trip={trip}
              currentMemberId={currentMemberId}
              onFormOpenChange={setItineraryFormOpen}
              addSignal={itineraryAddSignal}
            />
          )}
          {tab === 'ledger' && (
            <LedgerTab trip={trip} currentMemberId={currentMemberId} highlightSince={ledgerHighlightSince} />
          )}
        </div>

        <BottomNav
          active={tab}
          onChange={handleNavChange}
          badges={{ ledger: unseenLedger }}
          onAddExpense={() => (tab === 'itinerary' ? setItineraryAddSignal((s) => s + 1) : setSheetOpen(true))}
          showFab={!(tab === 'itinerary' && itineraryFormOpen)}
          decorate={{ more: <DiscoveryDot memberId={currentMemberId} hintKey="moreSheet" /> }}
        />

        {sheetOpen && (
          <AddExpensePage trip={trip} currentMemberId={currentMemberId} onClose={() => setSheetOpen(false)} />
        )}

        {moreOpen && (
          <TripMoreSheet
            trip={trip}
            onClose={() => setMoreOpen(false)}
            onOpenFeedback={() => { setMoreOpen(false); setFeedbackOpen(true) }}
            onOpenShareSettings={() => { setMoreOpen(false); setShareSettingsOpen(true) }}
            onOpenSyncDetail={() => { setMoreOpen(false); setSyncDetailOpen(true) }}
          />
        )}

        {syncDetailOpen && <SyncDetailSheet onClose={() => setSyncDetailOpen(false)} />}

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
