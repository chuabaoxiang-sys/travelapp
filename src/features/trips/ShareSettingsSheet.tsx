import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { X, Check, Copy, RefreshCw, Eye } from 'lucide-react'
import { setShareScope, setShareTemplate, regenerateShareToken, buildShareUrl, effectiveShareScope } from '../../domain/share'
import { BottomSheet } from '../../components/BottomSheet'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { isStandalone } from '../../lib/pwa'
import { TEMPLATE_PICKER_LIST, UPCOMING_TEMPLATES } from '../share/templates/pickerList'
import type { Trip, PublicShareScope } from '../../types'

// 范围是否"变宽"了——只有变宽（从看不到某类内容变成看得到）才需要弹二次确认，
// 变窄（关闭分享、或从"两者都有"收回到只剩一种）不需要，本来就是让人看得更少
function isWidening(from: PublicShareScope, to: PublicShareScope): boolean {
  const itineraryBefore = from === 'itinerary' || from === 'both'
  const expensesBefore = from === 'expenses' || from === 'both'
  const itineraryAfter = to === 'itinerary' || to === 'both'
  const expensesAfter = to === 'expenses' || to === 'both'
  return (itineraryAfter && !itineraryBefore) || (expensesAfter && !expensesBefore)
}

function scopeDescription(scope: PublicShareScope, t: TFunction): string {
  if (scope === 'itinerary') return t('shareSettings.scopeDescItinerary')
  if (scope === 'expenses') return t('shareSettings.scopeDescExpenses')
  return t('shareSettings.scopeDescBoth')
}

export function ShareSettingsSheet({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const { t } = useTranslation()

  const SCOPE_OPTIONS: { value: PublicShareScope; label: string }[] = [
    { value: 'none', label: t('shareSettings.scopeNone') },
    { value: 'itinerary', label: t('shareSettings.scopeItinerary') },
    { value: 'expenses', label: t('shareSettings.scopeExpenses') },
    { value: 'both', label: t('shareSettings.scopeBoth') },
  ]
  const [pendingScope, setPendingScope] = useState<PublicShareScope | null>(null)
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false)
  const [copied, setCopied] = useState(false)
  // 分享范围/模板/token这几个改动本地写完之后，domain/share.ts 会立刻尝试推一次
  // 同步，但推送本身还是有真实网络耗时的——这个状态就是盖住那个短暂窗口，防止
  // 用户手一快、改完立刻点"预览"，看到远端还没更新完的旧数据（真机复现过两次：
  // 刚开启分享就预览显示"链接打不开"、切换模板后预览还是显示旧模板）
  const [syncing, setSyncing] = useState(false)

  const currentScope = effectiveShareScope(trip)

  useEscapeKey(!pendingScope && !confirmingRegenerate, onClose)

  async function requestScopeChange(next: PublicShareScope) {
    if (next === currentScope) return
    if (isWidening(currentScope, next)) {
      setPendingScope(next)
      return
    }
    setSyncing(true)
    try {
      await setShareScope(trip.id, next)
    } finally {
      setSyncing(false)
    }
  }

  async function confirmScopeChange() {
    if (!pendingScope) return
    setSyncing(true)
    try {
      await setShareScope(trip.id, pendingScope)
    } finally {
      setSyncing(false)
    }
    setPendingScope(null)
  }

  async function selectTemplate(id: string) {
    setSyncing(true)
    try {
      await setShareTemplate(trip.id, id)
    } finally {
      setSyncing(false)
    }
  }

  async function copyLink() {
    if (!trip.publicShareToken) return
    await navigator.clipboard.writeText(buildShareUrl(trip.publicShareToken))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function confirmRegenerate() {
    setSyncing(true)
    try {
      await regenerateShareToken(trip.id)
    } finally {
      setSyncing(false)
    }
    setConfirmingRegenerate(false)
  }

  const sharing = currentScope !== 'none'
  const canGetLink = sharing && !!trip.publicShareToken && !!trip.publicShareTemplate

  return (
    <>
    <BottomSheet onClose={onClose} cardClassName="px-5 pt-3.5 pb-7 max-h-[88%] overflow-y-auto no-scrollbar">
        <div className="w-[38px] h-1 rounded-full bg-handle mx-auto mb-3.5" />
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm font-semibold">{t('shareSettings.title')}</span>
          <button onClick={onClose} className="text-muted" title={t('shareSettings.close')}>
            <X className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </button>
        </div>
        <div className="text-[11.5px] text-muted leading-relaxed mb-3">
          {t('shareSettings.intro')}
        </div>

        <div className="text-[10.5px] tracking-widest uppercase text-muted mb-1.5">{t('shareSettings.scopeLabel')}</div>
        <div className="flex gap-1.5 flex-wrap mb-4">
          {SCOPE_OPTIONS.map((opt) => {
            const active = currentScope === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => requestScopeChange(opt.value)}
                disabled={syncing}
                className={`rounded-full px-3.5 py-1.5 text-[12.5px] border disabled:opacity-50 ${
                  active ? 'bg-plan text-card border-plan font-medium' : 'bg-card border-line text-soft'
                }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>

        {sharing && (
          <>
            <div className="text-[10.5px] tracking-widest uppercase text-muted mb-1.5">{t('shareSettings.templateLabel')}</div>
            {/* 原本是2列网格，10套模板要占5行、把弹层撑得很高，选完模板还得往下滑
                一大截才摸到"复制链接"。改成横向一排滑动——跟LedgerTab/ItineraryTab
                里的日期条同一个写法（-mx-5 px-5 让滚动区域吃到卡片的左右padding，
                内容对齐不受影响），弹层整体矮下来，很多手机屏幕已经不需要再滚动 */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5 mb-4 pb-0.5">
              {TEMPLATE_PICKER_LIST.map((tpl) => {
                const active = trip.publicShareTemplate === tpl.id
                const Thumb = tpl.thumbnail
                return (
                  <button
                    key={tpl.id}
                    onClick={() => selectTemplate(tpl.id)}
                    disabled={syncing}
                    className={`flex-shrink-0 w-[108px] rounded-xl overflow-hidden border text-left bg-card disabled:opacity-50 ${active ? 'border-plan border-2' : 'border-line'}`}
                  >
                    <div className="h-[58px] relative">
                      <Thumb />
                      {active && (
                        <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-plan text-card flex items-center justify-center">
                          <Check className="w-2.5 h-2.5" strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <div className="text-[10.5px] font-medium px-2 py-1.5 truncate">{t(`shareSettings.templates.${tpl.id}`, { defaultValue: tpl.label })}</div>
                  </button>
                )
              })}
              {UPCOMING_TEMPLATES.map((tpl) => (
                <div key={tpl.id} className="flex-shrink-0 w-[108px] rounded-xl border border-dashed border-line opacity-50 flex flex-col">
                  <div className="h-[58px] flex items-center justify-center text-[10.5px] text-muted">{t('shareSettings.comingSoon')}</div>
                  <div className="text-[10.5px] px-2 py-1.5 truncate">{tpl.label}</div>
                </div>
              ))}
            </div>

            {canGetLink ? (
              <div className="bg-card border border-line rounded-xl p-3">
                {syncing ? (
                  <div className="text-[11.5px] text-muted text-center py-1.5 flex items-center justify-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={1.8} />
                    {t('shareSettings.syncingToServer')}
                  </div>
                ) : (
                  <>
                    <div className="text-[11px] text-muted break-all">{buildShareUrl(trip.publicShareToken!)}</div>
                    <div className="flex gap-2 mt-2.5">
                      <button
                        onClick={copyLink}
                        className="flex-1 rounded-lg bg-plan text-card py-2 text-[12.5px] font-medium flex items-center justify-center gap-1.5"
                      >
                        <Copy className="w-3.5 h-3.5" strokeWidth={1.8} />
                        {copied ? t('shareSettings.copied') : t('shareSettings.copyLink')}
                      </button>
                      <a
                        // 加?preview=1只是给SharePage一个信号，让它知道这次访问是从APP内部
                        // 点预览进来的，可以显示悬浮的"返回"按钮——不影响"复制链接"给出的
                        // 正式分享地址（那个没有这个参数），朋友收到的链接不会看到这个按钮
                        href={`${buildShareUrl(trip.publicShareToken!)}?preview=1`}
                        // 已安装成独立APP时不能用target="_blank"——真机反馈"预览后按返回
                        // 直接退出整个APP"：standalone模式的PWA通常只有一个窗口，_blank
                        // 打开的新页面自己的浏览历史是空的，按返回等于直接关掉这个唯一的
                        // 窗口。改成不开新窗口、就在当前窗口跳转，历史栈里有上一页，返回键
                        // 才能正常回到APP。普通浏览器标签页里没有这个问题，保留新标签页
                        // 的习惯用法（预览和分享设置可以同时开着对照看）
                        {...(isStandalone() ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                        className="rounded-lg border border-line px-3 py-2 text-muted flex items-center justify-center"
                        title={t('shareSettings.previewTitle')}
                      >
                        <Eye className="w-3.5 h-3.5" strokeWidth={1.8} />
                      </a>
                      <button
                        onClick={() => setConfirmingRegenerate(true)}
                        className="rounded-lg border border-line px-3 py-2 text-muted flex items-center justify-center"
                        title={t('shareSettings.regenerateTitle')}
                      >
                        <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.8} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="text-[11.5px] text-muted text-center py-2">{t('shareSettings.pickTemplateFirst')}</div>
            )}
          </>
        )}
    </BottomSheet>

      {pendingScope && (
        <ConfirmDialog
          title={t('shareSettings.widenConfirmTitle')}
          message={t('shareSettings.widenConfirmMessage', { scope: scopeDescription(pendingScope, t) })}
          confirmLabel={t('shareSettings.confirm')}
          danger={false}
          onConfirm={confirmScopeChange}
          onCancel={() => setPendingScope(null)}
        />
      )}

      {confirmingRegenerate && (
        <ConfirmDialog
          title={t('shareSettings.regenerateConfirmTitle')}
          message={t('shareSettings.regenerateConfirmMessage')}
          confirmLabel={t('shareSettings.regenerateConfirm')}
          onConfirm={confirmRegenerate}
          onCancel={() => setConfirmingRegenerate(false)}
        />
      )}
    </>
  )
}
