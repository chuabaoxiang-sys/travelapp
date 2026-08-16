import { useState } from 'react'
import { X, Check, Copy, RefreshCw, Eye } from 'lucide-react'
import { setShareScope, setShareTemplate, regenerateShareToken, buildShareUrl, effectiveShareScope } from '../../domain/share'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { TEMPLATE_REGISTRY, UPCOMING_TEMPLATES } from '../share/templates/registry'
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

  const currentScope = effectiveShareScope(trip)

  useEscapeKey(!pendingScope && !confirmingRegenerate, onClose)

  function requestScopeChange(next: PublicShareScope) {
    if (next === currentScope) return
    if (isWidening(currentScope, next)) {
      setPendingScope(next)
    } else {
      setShareScope(trip.id, next)
    }
  }

  async function confirmScopeChange() {
    if (!pendingScope) return
    await setShareScope(trip.id, pendingScope)
    setPendingScope(null)
  }

  function selectTemplate(id: string) {
    setShareTemplate(trip.id, id)
  }

  async function copyLink() {
    if (!trip.publicShareToken) return
    await navigator.clipboard.writeText(buildShareUrl(trip.publicShareToken))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function confirmRegenerate() {
    await regenerateShareToken(trip.id)
    setConfirmingRegenerate(false)
  }

  const sharing = currentScope !== 'none'
  const canGetLink = sharing && !!trip.publicShareToken && !!trip.publicShareTemplate

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <div className="flex-1 bg-ink/35" onClick={onClose} />
      <div className="bg-paper rounded-t-[26px] px-5 pt-3.5 pb-7 shadow-[0_-10px_40px_rgba(31,27,22,0.2)] max-h-[88%] overflow-y-auto no-scrollbar">
        <div className="w-[38px] h-1 rounded-full bg-[#D8CFC0] mx-auto mb-3.5" />
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
                className={`rounded-full px-3.5 py-1.5 text-[12.5px] border ${
                  active ? 'bg-plan text-card border-plan font-medium' : 'bg-card border-line text-[#57534E]'
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
              {TEMPLATE_REGISTRY.map((t) => {
                const active = trip.publicShareTemplate === t.id
                const Thumb = t.thumbnail
                return (
                  <button
                    key={t.id}
                    onClick={() => selectTemplate(t.id)}
                    className={`rounded-xl overflow-hidden border text-left bg-card ${active ? 'border-plan border-2' : 'border-line'}`}
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
              </div>
            ) : (
              <div className="text-[11.5px] text-muted text-center py-2">先选一套模板才能生成链接</div>
            )}
          </>
        )}
      </div>

      {pendingScope && (
        <ConfirmDialog
          title="确认开启分享？"
          message={`任何拿到这个链接的人都能看到：${scopeDescription(pendingScope)}。确定要生成/更新这个分享范围吗？`}
          confirmLabel="确认"
          danger={false}
          onConfirm={confirmScopeChange}
          onCancel={() => setPendingScope(null)}
        />
      )}

      {confirmingRegenerate && (
        <ConfirmDialog
          title="重新生成链接？"
          message="旧链接会立刻失效，之前发出去的链接将无法再打开，需要重新分享新链接。"
          confirmLabel="重新生成"
          onConfirm={confirmRegenerate}
          onCancel={() => setConfirmingRegenerate(false)}
        />
      )}
    </div>
  )
}
