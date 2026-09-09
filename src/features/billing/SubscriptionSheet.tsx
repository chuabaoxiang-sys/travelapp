import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Lock, Unlock } from 'lucide-react'
import gsap from 'gsap'
import { getSubscriptionStatus, startCheckout, UNLOCK_PRICE_DISPLAY, type HouseholdSubscription } from '../../domain/billing'
import { BottomSheet } from '../../components/BottomSheet'
import { useEscapeKey } from '../../hooks/useEscapeKey'

// 免费1趟、第2趟起要一次性解锁的真付费墙——不是订阅，锁头图标就是这个状态最直接
// 的隐喻：没解锁时锁着，解锁成功那一刻会真的"弹开"（见下面的动画effect），之后
// 再打开这个弹层锁头直接是开着的，不会每次都重放一遍。blocked为true时（从
// TripPicker建第2趟被拦下那里进来）多显示一句"你已经用掉免费额度了"，跟从
// "更多"菜单点进来的一般浏览场景区分开
export function SubscriptionSheet({
  onClose,
  justPurchased = false,
  blocked = false,
}: {
  onClose: () => void
  justPurchased?: boolean
  blocked?: boolean
}) {
  const { t } = useTranslation()
  const [sub, setSub] = useState<HouseholdSubscription | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const closedIconRef = useRef<SVGSVGElement>(null)
  const openIconRef = useRef<SVGSVGElement>(null)
  const ring1Ref = useRef<HTMLDivElement>(null)
  const ring2Ref = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEscapeKey(true, onClose)

  useEffect(() => {
    getSubscriptionStatus()
      .then(setSub)
      .catch(() => setSub(null))
  }, [])

  // 解锁成功的庆祝动画：锁上的图标淡出缩小，打开的图标同时弹入放大再回弹——两个
  // 都是lucide本来的Lock/Unlock图案，不是拿一条弧线硬转出假的"开锁"效果（试过，
  // 效果很别扭）。配一圈涟漪+几点火花，克制一点，不是撒花那种庆祝
  useEffect(() => {
    if (!justPurchased) return
    const closedEl = closedIconRef.current
    const openEl = openIconRef.current
    const ring1 = ring1Ref.current
    const ring2 = ring2Ref.current
    const wrap = wrapRef.current
    if (!closedEl || !openEl || !ring1 || !ring2 || !wrap) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      gsap.set(closedEl, { opacity: 0 })
      gsap.set(openEl, { opacity: 1, scale: 1 })
      gsap.set([ring1, ring2], { opacity: 0 })
      return
    }

    const sparks: HTMLDivElement[] = []
    const sparkCount = 7
    for (let i = 0; i < sparkCount; i++) {
      const s = document.createElement('div')
      s.className = 'absolute top-1/2 left-1/2 w-[5px] h-[5px] rounded-full bg-plan opacity-0'
      wrap.appendChild(s)
      sparks.push(s)
    }

    gsap.set(closedEl, { opacity: 1, scale: 1, transformOrigin: '50% 50%' })
    gsap.set(openEl, { opacity: 0, scale: 0.5, transformOrigin: '50% 50%' })
    gsap.set([ring1, ring2], { opacity: 0, scale: 0.6 })
    gsap.set(sparks, { opacity: 0, x: 0, y: 0 })

    const tl = gsap.timeline()
    tl.to(closedEl, { opacity: 0, scale: 0.75, duration: 0.22, ease: 'power1.in' })
      .to(openEl, { opacity: 1, scale: 1.15, duration: 0.34, ease: 'back.out(2.4)' }, '<0.05')
      .to(openEl, { scale: 1, duration: 0.22, ease: 'power2.out' })
      .to(ring1, { opacity: 0.55, scale: 1.9, duration: 0.55, ease: 'power1.out' }, '-=0.5')
      .to(ring1, { opacity: 0, duration: 0.25 }, '-=0.15')
      .to(ring2, { opacity: 0.35, scale: 2.6, duration: 0.7, ease: 'power1.out' }, '-=0.55')
      .to(ring2, { opacity: 0, duration: 0.3 }, '-=0.2')

    sparks.forEach((s, i) => {
      const angle = (Math.PI * 2 * i) / sparkCount + Math.random() * 0.4
      const dist = 26 + Math.random() * 10
      tl.to(
        s,
        { opacity: 1, x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, duration: 0.5, ease: 'power2.out' },
        0.3 + i * 0.02
      ).to(s, { opacity: 0, duration: 0.35 }, 0.55 + i * 0.02)
    })

    return () => {
      tl.kill()
      sparks.forEach((s) => s.remove())
    }
  }, [justPurchased])

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

      {justPurchased ? (
        <div className="bg-card border border-line rounded-xl p-4 mt-3 text-center">
          <div ref={wrapRef} className="relative w-[52px] h-[52px] mx-auto mb-3">
            <div ref={ring1Ref} className="absolute inset-0 rounded-full border-[1.5px] border-plan opacity-0" />
            <div ref={ring2Ref} className="absolute inset-0 rounded-full border-[1.5px] border-plan opacity-0" />
            <div className="absolute inset-0 m-auto w-11 h-11 rounded-[13px] bg-plan/[0.08] flex items-center justify-center text-plan">
              <Lock ref={closedIconRef} className="w-[22px] h-[22px] absolute inset-0 m-auto" strokeWidth={1.8} />
              <Unlock ref={openIconRef} className="w-[22px] h-[22px] absolute inset-0 m-auto" strokeWidth={1.8} />
            </div>
          </div>
          <div className="text-[13px] font-semibold mb-1.5">{t('subscription.thankYouTitle')}</div>
          <div className="text-[11.5px] text-muted leading-relaxed">{t('subscription.thankYouBody')}</div>
        </div>
      ) : (
        <>
          {blocked && (
            <div className="mb-3">
              <div className="text-[12.5px] font-semibold mb-1">{t('subscription.limitTitle')}</div>
              <div className="text-[11.5px] text-muted leading-relaxed">{t('subscription.limitBody')}</div>
            </div>
          )}
          <div className="text-[11.5px] text-muted leading-relaxed mb-4">
            {t('subscription.description', { price: UNLOCK_PRICE_DISPLAY })}
          </div>

          {sub === undefined && (
            <div className="text-[12px] text-muted text-center py-4">{t('subscription.loading')}</div>
          )}
          {sub === null && <div className="text-[12px] text-negative text-center py-4">{t('subscription.loadError')}</div>}

          {sub && (
            <div className="bg-card border border-line rounded-xl p-4">
              <div className="flex items-center gap-2.5">
                <span className="w-[30px] h-[30px] rounded-[9px] bg-plan/[0.06] flex items-center justify-center text-plan flex-shrink-0">
                  {isActive ? (
                    <Unlock className="w-[15px] h-[15px]" strokeWidth={1.8} />
                  ) : (
                    <Lock className="w-[15px] h-[15px]" strokeWidth={1.8} />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-medium">
                    {isActive
                      ? t('subscription.statusActive', { date: sub.purchasedAt?.slice(0, 10) })
                      : t('subscription.statusFree')}
                  </div>
                </div>
              </div>

              {!isActive && (
                <button
                  onClick={handleUnlock}
                  disabled={busy}
                  className="w-full mt-3 rounded-lg bg-plan text-card py-2 text-[12.5px] font-medium disabled:opacity-50"
                >
                  {busy ? t('subscription.redirecting') : t('subscription.unlock', { price: UNLOCK_PRICE_DISPLAY })}
                </button>
              )}
              {actionError && <div className="text-[11px] text-negative mt-2 text-center">{actionError}</div>}
            </div>
          )}
        </>
      )}
    </BottomSheet>
  )
}
