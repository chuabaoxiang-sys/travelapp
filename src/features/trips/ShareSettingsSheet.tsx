import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { X, Check, Copy, RefreshCw, Eye } from 'lucide-react'
import { setShareScope, setShareTemplate, regenerateShareToken, buildShareUrl, effectiveShareScope } from '../../domain/share'
import { BottomSheet } from '../../components/BottomSheet'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useEscapeKey } from '../../hooks/useEscapeKey'
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
            <div className="grid grid-cols-2 gap-2 mb-4">
              {TEMPLATE_PICKER_LIST.map((tpl) => {
                const active = trip.publicShareTemplate === tpl.id
                const Thumb = tpl.thumbnail
                return (
                  <button
                    key={tpl.id}
                    onClick={() => selectTemplate(tpl.id)}
                    disabled={syncing}
                    className={`rounded-xl overflow-hidden border text-left bg-card disabled:opacity-50 ${active ? 'border-plan border-2' : 'border-line'}`}
                  >
                    <div className="h-[62px] relative">
                      <Thumb />
                      {active && (
                        <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-plan text-card flex items-center justify-center">
                          <Check className="w-2.5 h-2.5" strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-medium px-2 py-1.5 truncate">{t(`shareSettings.templates.${tpl.id}`, { defaultValue: tpl.label })}</div>
                  </button>
                )
              })}
              {UPCOMING_TEMPLATES.map((tpl) => (
                <div key={tpl.id} className="rounded-xl border border-dashed border-line opacity-50 flex flex-col">
                  <div className="h-[62px] flex items-center justify-center text-[10.5px] text-muted">{t('shareSettings.comingSoon')}</div>
                  <div className="text-[11px] px-2 py-1.5 truncate">{tpl.label}</div>
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
                        href={buildShareUrl(trip.publicShareToken!)}
                        target="_blank"
                        rel="noopener noreferrer"
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
