import { useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { X, Link2, RefreshCw, BookOpen, ListChecks } from 'lucide-react'
import { assembleExportBundle } from '../../domain/export'
import { buildExcelFile, buildJsonFile, buildCsvFile } from '../../domain/exportRenderers'
import { shareReadyFile, downloadFile } from '../../lib/share'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { effectiveShareScope } from '../../domain/share'
import { formatAppVersion } from '../../lib/appVersion'
import { db } from '../../db/dexie'
import { STUCK_THRESHOLD } from '../../components/SyncDetailSheet'
import type { Trip } from '../../types'

type ExportKind = 'excel' | 'json' | 'csv'

const EXPORT_OPTIONS: { kind: ExportKind; label: string; desc: string; icon: ReactNode }[] = [
  {
    kind: 'excel',
    label: 'EXCEL',
    desc: 'Excel · 明细 + 汇总两个sheet，行程和账目都在里面',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h8M8 12h3M13 12h3M8 16h3M13 16h3" />
      </svg>
    ),
  },
  {
    kind: 'json',
    label: 'JSON',
    desc: 'JSON · 给AI工具生成游记文案/短视频脚本用',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 3h7l5 5v13H7z" />
        <path d="M14 3v5h5" />
      </svg>
    ),
  },
  {
    kind: 'csv',
    label: 'CSV',
    desc: 'CSV · 摊平成表格，方便导入其他工具',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    ),
  },
]

export function TripMoreSheet({
  trip,
  onClose,
  onOpenFeedback,
  onOpenShareSettings,
  onOpenSyncDetail,
}: {
  trip: Trip
  onClose: () => void
  onOpenFeedback: () => void
  onOpenShareSettings: () => void
  onOpenSyncDetail: () => void
}) {
  const pendingOutbox = useLiveQuery(() => db.outbox.where('status').equals('pending').toArray()) ?? []
  const stuckCount = pendingOutbox.filter((e) => e.attempts >= STUCK_THRESHOLD).length
  const syncSummary =
    stuckCount > 0 ? `${stuckCount}条看起来卡住了，点击查看` : pendingOutbox.length > 0 ? `${pendingOutbox.length}条还在重试中` : '全部已同步'
  const syncSummaryClass = stuckCount > 0 ? 'text-negative' : pendingOutbox.length > 0 ? 'text-spend' : 'text-muted'

  const [busy, setBusy] = useState<ExportKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // 文件生成好了、等着被分享的那一份——分成"生成"和"分享"两次独立点击，是因为
  // 安卓部分Chrome版本要求 navigator.share() 必须紧跟在用户点击后面调用，中间
  // 隔一段生成文件的 await 就会被判定"用户手势已过期"，报 NotAllowedError
  const [readyFile, setReadyFile] = useState<{ kind: ExportKind; file: File } | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEscapeKey(true, onClose)

  // 手机上装成PWA之后没有浏览器的刷新按钮，下拉刷新手势也被关掉了（会误触发跳回
  // "行程"页），用户没有任何办法主动"刷新一下试试"、也无从确认刚才那下到底有没有
  // 生效。这里主动问一次有没有新版本，不管查到没查到都强制重新加载页面——真有新
  // 版本的话会先经过main.tsx里controllerchange的自动跳转，版本号变了就是刷新生效的证据
  async function handleManualRefresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      const reg = await navigator.serviceWorker?.getRegistration()
      await reg?.update()
      // reg.update() resolve时只代表"检查请求发出去了"，新worker通常还要再装一下
      // 才会真正接管页面——如果这时候就立刻刷新，大概率抢在新版本生效之前，刷出来
      // 的还是旧缓存（之前这里就是这么写的，导致"检查更新"点了总感觉没生效）。
      // 这里等一下真正的接管事件，最多等4秒，避免真没有新版本时按钮卡住不刷新
      if (reg?.installing || reg?.waiting) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
          setTimeout(resolve, 4000)
        })
      }
    } catch {
      // 查更新失败不影响下面还是要刷新一次
    }
    window.location.reload()
  }

  async function handlePrepare(kind: ExportKind) {
    setError(null)
    setNote(null)
    setReadyFile(null)
    setBusy(kind)
    try {
      const bundle = await assembleExportBundle(trip.id)
      const file =
        kind === 'excel' ? buildExcelFile(bundle) : kind === 'json' ? buildJsonFile(bundle) : buildCsvFile(bundle)
      if (!navigator.share) {
        downloadFile(file)
        return
      }
      setReadyFile({ kind, file })
    } catch {
      setError('导出失败，请重试')
    } finally {
      setBusy(null)
    }
  }

  // 必须是这个按钮自己点击事件里的第一步、不经过任何 await 就直接调用
  // navigator.share()，才能保住"用户手势"，所以这里不能是 async 函数体第一行
  function handleShare() {
    if (!readyFile) return
    const { file } = readyFile
    setReadyFile(null)
    shareReadyFile(file, `${trip.name} · 旅记导出`).then((result) => {
      if (result.outcome === 'downloaded' && result.failureReason) {
        setNote(`已改为直接下载文件（系统分享没有打开，原因：${result.failureReason}）`)
      }
    })
  }

  return (
    <div className="absolute inset-0 z-30 bg-ink/35" onClick={onClose}>
      <div className="absolute inset-0 flex flex-col justify-end px-2.5 pb-2.5 pointer-events-none">
        <div
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto bg-paper rounded-[26px] px-5 pt-3.5 pb-7 shadow-[0_-6px_28px_rgba(31,27,22,0.22)] max-h-[88%] overflow-y-auto no-scrollbar"
        >
        <div className="w-[38px] h-1 rounded-full bg-[#D8CFC0] mx-auto mb-3.5" />

        <div className="flex justify-between items-center mb-1">
          <span className="text-sm font-semibold">更多</span>
          <button onClick={onClose} className="text-muted" title="关闭">
            <X className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </button>
        </div>

        <div className="text-[10px] font-bold text-muted tracking-wide mt-3.5 mb-1.5">导出与分享</div>

        <div className="flex items-center gap-3 py-1.5">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium">导出行程</div>
            <div className="text-[10.5px] text-muted mt-0.5">
              {busy
                ? '生成中…'
                : readyFile
                  ? `${EXPORT_OPTIONS.find((o) => o.kind === readyFile.kind)?.label}文件已就绪，点击分享`
                  : '选个格式，明细+汇总都在里面'}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {EXPORT_OPTIONS.map((opt) => {
              const isReady = readyFile?.kind === opt.kind
              return (
                <button
                  key={opt.kind}
                  onClick={isReady ? handleShare : () => handlePrepare(opt.kind)}
                  disabled={busy !== null}
                  title={opt.desc}
                  className={`w-10 h-10 rounded-[11px] border flex flex-col items-center justify-center gap-0.5 disabled:opacity-50 [&_svg]:w-[15px] [&_svg]:h-[15px] ${
                    isReady ? 'bg-plan text-paper border-plan' : 'bg-card border-line text-plan'
                  }`}
                >
                  {opt.icon}
                  <span className={`text-[7px] font-bold ${isReady ? 'text-paper/80' : 'text-muted'}`}>{opt.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {error && <div className="text-[11.5px] text-negative mt-1">{error}</div>}
        {note && <div className="text-[11.5px] text-muted mt-1">{note}</div>}

        <button
          onClick={onOpenShareSettings}
          className="w-full flex items-center gap-3 py-2.5 mt-1 border-t border-line text-left"
        >
          <span className="w-[34px] h-[34px] rounded-[10px] bg-card border border-line flex items-center justify-center text-plan flex-shrink-0">
            <Link2 className="w-[17px] h-[17px]" strokeWidth={1.8} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium">分享设置</div>
            <div className="text-[10.5px] text-muted mt-0.5">
              {effectiveShareScope(trip) === 'none' ? '还没开启只读分享链接' : '只读分享链接已开启'}
            </div>
          </div>
          <span className="text-[11.5px] text-plan flex-shrink-0">设置 ›</span>
        </button>

        <div className="text-[10px] font-bold text-muted tracking-wide mt-4 mb-1.5">更多</div>

        {/* "旅程回顾"和"行程动态"这两项搬进了「概览」tab——"回家后"形态就是旅程回顾的
            内容，"旅途中"形态里"家里刚才"是行程动态的精简版（带"查看全部"回到完整列表）。
            两份数据只留一个入口，不然改一处容易忘改另一处 */}

        <button onClick={onOpenSyncDetail} className="w-full flex items-center gap-2.5 py-2 text-left">
          <span className="w-[30px] h-[30px] rounded-[9px] bg-plan/[0.06] flex items-center justify-center text-plan flex-shrink-0">
            <ListChecks className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium">同步详情</div>
            <div className={`text-[9.5px] mt-0.5 ${syncSummaryClass}`}>{syncSummary}</div>
          </div>
          <span className="text-[10.5px] text-plan flex-shrink-0">查看 ›</span>
        </button>

        <a
          href="/user-guide.html"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center gap-2.5 py-2 border-t border-line text-left"
        >
          <span className="w-[30px] h-[30px] rounded-[9px] bg-plan/[0.06] flex items-center justify-center text-plan flex-shrink-0">
            <BookOpen className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium">使用指南</div>
            <div className="text-[9.5px] text-muted mt-0.5">行程、记账、分账这些功能怎么用，照真实界面讲一遍</div>
          </div>
          <span className="text-[10.5px] text-plan flex-shrink-0">去看看 ›</span>
        </a>

        <button onClick={onOpenFeedback} className="w-full flex items-center gap-2.5 py-2 border-t border-line text-left">
          <span className="w-[30px] h-[30px] rounded-[9px] bg-plan/[0.06] flex items-center justify-center text-plan flex-shrink-0">
            <svg viewBox="0 0 24 24" className="w-[15px] h-[15px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium">提交反馈</div>
            <div className="text-[9.5px] text-muted mt-0.5">用得不顺手的地方、想加的功能，都可以说</div>
          </div>
          <span className="text-[10.5px] text-plan flex-shrink-0">去反馈 ›</span>
        </button>

        <button
          onClick={handleManualRefresh}
          disabled={refreshing}
          className="w-full flex items-center gap-2.5 py-2 border-t border-line text-left disabled:opacity-50"
        >
          <span className="w-[30px] h-[30px] rounded-[9px] bg-plan/[0.06] flex items-center justify-center text-plan flex-shrink-0">
            <RefreshCw className={`w-[15px] h-[15px] ${refreshing ? 'animate-spin' : ''}`} strokeWidth={1.8} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium">检查更新</div>
            <div className="text-[9.5px] text-muted mt-0.5 tabular">当前版本 {formatAppVersion()}</div>
          </div>
          <span className="text-[10.5px] text-plan flex-shrink-0">{refreshing ? '刷新中…' : '点击刷新'}</span>
        </button>
        </div>
      </div>
    </div>
  )
}
