import { useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { X, Link2, RefreshCw, BookOpen, ListChecks, MoonStar, Languages } from 'lucide-react'
import { assembleExportBundle } from '../../domain/export'
import { shareReadyFile, downloadFile } from '../../lib/share'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { effectiveShareScope } from '../../domain/share'
import { formatAppVersion } from '../../lib/appVersion'
import { useThemePreference, type ThemePreference } from '../../lib/theme'
import { useLocalePreference, type LocalePreference } from '../../lib/locale'
import { db } from '../../db/dexie'
import { BottomSheet } from '../../components/BottomSheet'
import { STUCK_THRESHOLD } from '../../components/SyncDetailSheet'
import type { Trip } from '../../types'

type ExportKind = 'excel' | 'json' | 'csv'

export function TripMoreSheet({
  trip,
  currentMemberId,
  onClose,
  onOpenFeedback,
  onOpenShareSettings,
  onOpenSyncDetail,
}: {
  trip: Trip
  currentMemberId: string
  onClose: () => void
  onOpenFeedback: () => void
  onOpenShareSettings: () => void
  onOpenSyncDetail: () => void
}) {
  const { t } = useTranslation()

  const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
    { value: 'light', label: t('more.themeLight') },
    { value: 'dark', label: t('more.themeDark') },
    { value: 'system', label: t('more.followSystem') },
  ]

  const LOCALE_OPTIONS: { value: LocalePreference; label: string }[] = [
    { value: null, label: t('more.followSystem') },
    { value: 'zh', label: '中文' },
    { value: 'en', label: 'English' },
  ]

  const EXPORT_OPTIONS: { kind: ExportKind; label: string; desc: string; icon: ReactNode }[] = [
    {
      kind: 'excel',
      label: 'EXCEL',
      desc: t('more.excelDesc'),
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
      desc: t('more.jsonDesc'),
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
      desc: t('more.csvDesc'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      ),
    },
  ]

  const pendingOutbox = useLiveQuery(() => db.outbox.where('status').equals('pending').toArray()) ?? []
  const stuckCount = pendingOutbox.filter((e) => e.attempts >= STUCK_THRESHOLD).length
  const syncSummary =
    stuckCount > 0
      ? t('more.syncStuck', { count: stuckCount })
      : pendingOutbox.length > 0
        ? t('more.syncPendingRetry', { count: pendingOutbox.length })
        : t('more.syncAllSynced')
  const syncSummaryClass = stuckCount > 0 ? 'text-negative' : pendingOutbox.length > 0 ? 'text-spend' : 'text-muted'

  const [busy, setBusy] = useState<ExportKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // 文件生成好了、等着被分享的那一份——分成"生成"和"分享"两次独立点击，是因为
  // 安卓部分Chrome版本要求 navigator.share() 必须紧跟在用户点击后面调用，中间
  // 隔一段生成文件的 await 就会被判定"用户手势已过期"，报 NotAllowedError
  const [readyFile, setReadyFile] = useState<{ kind: ExportKind; file: File } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [themePref, setThemePref] = useThemePreference()
  const [localePref, , setLocalePref] = useLocalePreference(currentMemberId)

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
      const bundle = await assembleExportBundle(trip.id, t)
      // buildExcelFile 依赖的 xlsx 库源码7MB+，绝大多数用户从来不点导出——
      // 动态import让它只在真的点了导出按钮时才下载，不拖累主包体积
      const { buildExcelFile, buildJsonFile, buildCsvFile } = await import('../../domain/exportRenderers')
      const file =
        kind === 'excel' ? buildExcelFile(bundle, t) : kind === 'json' ? buildJsonFile(bundle, t) : buildCsvFile(bundle, t)
      if (!navigator.share) {
        downloadFile(file)
        return
      }
      setReadyFile({ kind, file })
    } catch {
      setError(t('more.exportFailed'))
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
    shareReadyFile(file, t('more.shareTitle', { trip: trip.name })).then((result) => {
      if (result.outcome === 'downloaded' && result.failureReason) {
        setNote(t('more.shareFallbackNote', { reason: result.failureReason }))
      }
    })
  }

  return (
    <BottomSheet onClose={onClose} cardClassName="px-5 pt-3.5 pb-7 max-h-[88%] overflow-y-auto no-scrollbar">
        <div className="w-[38px] h-1 rounded-full bg-handle mx-auto mb-3.5" />

        <div className="flex justify-between items-center mb-1">
          <span className="text-sm font-semibold">{t('more.title')}</span>
          <button onClick={onClose} className="text-muted" title={t('more.close')}>
            <X className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </button>
        </div>

        <div className="text-[10px] font-bold text-muted tracking-wide mt-3.5 mb-1.5">{t('more.appearance')}</div>

        <div className="flex items-center gap-3 py-1.5">
          <span className="w-[30px] h-[30px] rounded-[9px] bg-plan/[0.06] flex items-center justify-center text-plan flex-shrink-0">
            <MoonStar className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </span>
          <div className="text-[13px] font-medium flex-1 min-w-0">{t('more.darkMode')}</div>
          <div className="flex gap-1 bg-segment rounded-[10px] p-[3px] flex-shrink-0">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setThemePref(opt.value)}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] whitespace-nowrap ${
                  themePref === opt.value ? 'bg-ink text-paper font-medium' : 'text-soft'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 py-1.5">
          <span className="w-[30px] h-[30px] rounded-[9px] bg-plan/[0.06] flex items-center justify-center text-plan flex-shrink-0">
            <Languages className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </span>
          <div className="text-[13px] font-medium flex-1 min-w-0">{t('more.language')}</div>
          <div className="flex gap-1 bg-segment rounded-[10px] p-[3px] flex-shrink-0">
            {LOCALE_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={() => setLocalePref(opt.value)}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] whitespace-nowrap ${
                  localePref === opt.value ? 'bg-ink text-paper font-medium' : 'text-soft'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="text-[10px] font-bold text-muted tracking-wide mt-3.5 mb-1.5 border-t border-line pt-3.5">{t('more.exportShare')}</div>

        <div className="flex items-center gap-3 py-1.5">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium">{t('more.exportTrip')}</div>
            <div className="text-[10.5px] text-muted mt-0.5">
              {busy
                ? t('more.exportGenerating')
                : readyFile
                  ? t('more.exportReady', { format: EXPORT_OPTIONS.find((o) => o.kind === readyFile.kind)?.label })
                  : t('more.exportHint')}
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
            <div className="text-[13px] font-medium">{t('more.shareSettings')}</div>
            <div className="text-[10.5px] text-muted mt-0.5">
              {effectiveShareScope(trip) === 'none' ? t('more.shareOff') : t('more.shareOn')}
            </div>
          </div>
          <span className="text-[11.5px] text-plan flex-shrink-0">{t('more.settingsArrow')}</span>
        </button>

        <div className="text-[10px] font-bold text-muted tracking-wide mt-4 mb-1.5">{t('more.otherSection')}</div>

        {/* "旅程回顾"和"行程动态"这两项搬进了「概览」tab——"回家后"形态就是旅程回顾的
            内容，"旅途中"形态里"家里刚才"是行程动态的精简版（带"查看全部"回到完整列表）。
            两份数据只留一个入口，不然改一处容易忘改另一处 */}

        <button onClick={onOpenSyncDetail} className="w-full flex items-center gap-2.5 py-2 text-left">
          <span className="w-[30px] h-[30px] rounded-[9px] bg-plan/[0.06] flex items-center justify-center text-plan flex-shrink-0">
            <ListChecks className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium">{t('more.syncDetail')}</div>
            <div className={`text-[9.5px] mt-0.5 ${syncSummaryClass}`}>{syncSummary}</div>
          </div>
          <span className="text-[10.5px] text-plan flex-shrink-0">{t('more.syncViewArrow')}</span>
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
            <div className="text-[12px] font-medium">{t('more.userGuide')}</div>
            <div className="text-[9.5px] text-muted mt-0.5">{t('more.userGuideDesc')}</div>
          </div>
          <span className="text-[10.5px] text-plan flex-shrink-0">{t('more.userGuideArrow')}</span>
        </a>

        <button onClick={onOpenFeedback} className="w-full flex items-center gap-2.5 py-2 border-t border-line text-left">
          <span className="w-[30px] h-[30px] rounded-[9px] bg-plan/[0.06] flex items-center justify-center text-plan flex-shrink-0">
            <svg viewBox="0 0 24 24" className="w-[15px] h-[15px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium">{t('more.feedback')}</div>
            <div className="text-[9.5px] text-muted mt-0.5">{t('more.feedbackDesc')}</div>
          </div>
          <span className="text-[10.5px] text-plan flex-shrink-0">{t('more.feedbackArrow')}</span>
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
            <div className="text-[12px] font-medium">{t('more.checkUpdate')}</div>
            <div className="text-[9.5px] text-muted mt-0.5 tabular">{t('more.currentVersion', { version: formatAppVersion() })}</div>
          </div>
          <span className="text-[10.5px] text-plan flex-shrink-0">{refreshing ? t('more.refreshing') : t('more.tapToRefresh')}</span>
        </button>
    </BottomSheet>
  )
}
