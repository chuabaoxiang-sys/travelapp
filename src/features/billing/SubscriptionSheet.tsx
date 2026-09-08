import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Crown } from 'lucide-react'
import { getSubscriptionStatus, startCheckout, type HouseholdSubscription } from '../../domain/billing'
import { BottomSheet } from '../../components/BottomSheet'
import { useEscapeKey } from '../../hooks/useEscapeKey'

// 纯状态展示 + 一个"解锁"按钮，没有任何锁功能/付费墙——具体哪些功能算Pro是
// 以后再定的事，这一版只负责"看到自己解锁没有，能自助解锁"。定价是终生一次性，
// 不是订阅，所以解锁之后没有"管理/取消"这类动作可做
export function SubscriptionSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [sub, setSub] = useState<HouseholdSubscription | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEscapeKey(true, onClose)

  useEffect(() => {
    getSubscriptionStatus()
      .then(setSub)
      .catch(() => setSub(null))
  }, [])

  async function handleUnlock() {
    setBusy(true)
    setActionError(null)
    try {
      await startCheckout()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const isActive = sub?.status === 'active'

  return (
    <BottomSheet onClose={onClose} cardClassName="px-5 pt-3.5 pb-7 max-h-[88%] overflow-y-auto no-scrollbar">
      <div className="w-[38px] h-1 rounded-full bg-handle mx-auto mb-3.5" />
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-semibold">{t('subscription.title')}</span>
        <button onClick={onClose} className="text-muted" title={t('subscription.close')}>
          <X className="w-[15px] h-[15px]" strokeWidth={1.8} />
        </button>
      </div>
      <div className="text-[11.5px] text-muted leading-relaxed mb-4">{t('subscription.description')}</div>

      {sub === undefined && <div className="text-[12px] text-muted text-center py-4">{t('subscription.loading')}</div>}
      {sub === null && <div className="text-[12px] text-negative text-center py-4">{t('subscription.loadError')}</div>}

      {sub && (
        <div className="bg-card border border-line rounded-xl p-4">
          <div className="flex items-center gap-2.5">
            <span className="w-[30px] h-[30px] rounded-[9px] bg-plan/[0.06] flex items-center justify-center text-plan flex-shrink-0">
              <Crown className="w-[15px] h-[15px]" strokeWidth={1.8} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold">
                {isActive ? t('subscription.statusActive') : t('subscription.statusFree')}
              </div>
              {isActive && sub.purchasedAt && (
                <div className="text-[10.5px] text-muted mt-0.5 tabular">
                  {t('subscription.purchasedOn', { date: sub.purchasedAt.slice(0, 10) })}
                </div>
              )}
            </div>
          </div>

          {!isActive && (
            <button
              onClick={handleUnlock}
              disabled={busy}
              className="w-full mt-3 rounded-lg bg-plan text-card py-2 text-[12.5px] font-medium disabled:opacity-50"
            >
              {busy ? t('subscription.redirecting') : t('subscription.unlock')}
            </button>
          )}
          {actionError && <div className="text-[11px] text-negative mt-2 text-center">{actionError}</div>}
        </div>
      )}
    </BottomSheet>
  )
}
