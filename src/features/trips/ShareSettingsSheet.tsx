import { useState } from 'react'
import { X, Check, Copy, RefreshCw, Eye } from 'lucide-react'
import { setShareScope, setShareTemplate, regenerateShareToken, buildShareUrl, effectiveShareScope } from '../../domain/share'
import { BottomSheet } from '../../components/BottomSheet'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { TEMPLATE_PICKER_LIST, UPCOMING_TEMPLATES } from '../share/templates/pickerList'
import type { Trip, PublicShareScope } from '../../types'

const SCOPE_OPTIONS: { value: PublicShareScope; label: string }[] = [
  { value: 'none', label: '关闭' },
  { value: 'itinerary', label: '仅行程' },
  { value: 'expenses', label: '仅花费' },
  { value: 'both', label: '两者都有' },
]

// 范围是否"变宽"了——只有变宽（从看不到某类内容变成看得到）才需要弹二次确认，
// 变窄（关闭分享、或从"两者都有"收回到只剩一种）不需要，本来就是让人看得更少
function isWidening(from: PublicShareScope, to: PublicShareScope): boolean {
  const itineraryBefore = from === 'itinerary' || from === 'both'
  const expensesBefore = from === 'expenses' || from === 'both'
  const itineraryAfter = to === 'itinerary' || to === 'both'
  const expensesAfter = to === 'expenses' || to === 'both'
  return (itineraryAfter && !itineraryBefore) || (expensesAfter && !expensesBefore)
}

function scopeDescription(scope: PublicShareScope): string {
  if (scope === 'itinerary') return '行程安排（日期、时间、地点）'
  if (scope === 'expenses') return '花费汇总（总额和分类小计，不含每一笔明细）'
  return '行程安排和花费汇总'
}

export function ShareSettingsSheet({ trip, onClose }: { trip: Trip; onClose: () => void }) {
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
          <span className="text-sm font-semibold">分享设置</span>
          <button onClick={onClose} className="text-muted" title="关闭">
            <X className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </button>
        </div>
        <div className="text-[11.5px] text-muted leading-relaxed mb-3">
          生成一个只读链接，拿到链接的人不用登录就能看，但不能编辑。
        </div>

        <div className="text-[10.5px] tracking-widest uppercase text-muted mb-1.5">分享范围</div>
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
            <div className="text-[10.5px] tracking-widest uppercase text-muted mb-1.5">选一套分享页模板</div>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {TEMPLATE_PICKER_LIST.map((t) => {
                const active = trip.publicShareTemplate === t.id
                const Thumb = t.thumbnail
                return (
                  <button
                    key={t.id}
                    onClick={() => selectTemplate(t.id)}
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
                    <div className="text-[11px] font-medium px-2 py-1.5 truncate">{t.label}</div>
                  </button>
                )
              })}
              {UPCOMING_TEMPLATES.map((t) => (
                <div key={t.id} className="rounded-xl border border-dashed border-line opacity-50 flex flex-col">
                  <div className="h-[62px] flex items-center justify-center text-[10.5px] text-muted">即将推出</div>
                  <div className="text-[11px] px-2 py-1.5 truncate">{t.label}</div>
                </div>
              ))}
            </div>

            {canGetLink ? (
              <div className="bg-card border border-line rounded-xl p-3">
                {syncing ? (
                  <div className="text-[11.5px] text-muted text-center py-1.5 flex items-center justify-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" strokeWidth={1.8} />
                    正在同步到服务器…
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
                        {copied ? '已复制' : '复制链接'}
                      </button>
                      <a
                        href={buildShareUrl(trip.publicShareToken!)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border border-line px-3 py-2 text-muted flex items-center justify-center"
                        title="预览分享页——发给朋友前，先看看对方会看到什么样子"
                      >
                        <Eye className="w-3.5 h-3.5" strokeWidth={1.8} />
                      </a>
                      <button
                        onClick={() => setConfirmingRegenerate(true)}
                        className="rounded-lg border border-line px-3 py-2 text-muted flex items-center justify-center"
                        title="重新生成链接（旧链接会失效）"
                      >
                        <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.8} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="text-[11.5px] text-muted text-center py-2">先选一套模板才能生成链接</div>
            )}
          </>
        )}
    </BottomSheet>

      {pendingScope && (
        <ConfirmDialog
          title="确认开启分享？"
          message={`任何拿到这个链接的人都能看到：${scopeDescription(pendingScope)}。确定要开启吗？`}
          confirmLabel="确认"
          danger={false}
          onConfirm={confirmScopeChange}
          onCancel={() => setPendingScope(null)}
        />
      )}

      {confirmingRegenerate && (
        <ConfirmDialog
          title="重新生成链接？"
          message="旧链接会立刻失效、无法再打开，记得把新链接重新发给对方。"
          confirmLabel="重新生成"
          onConfirm={confirmRegenerate}
          onCancel={() => setConfirmingRegenerate(false)}
        />
      )}
    </>
  )
}
