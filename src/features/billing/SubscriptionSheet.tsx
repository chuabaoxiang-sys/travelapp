import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Lock, Unlock, Coffee } from 'lucide-react'
import gsap from 'gsap'
import {
  getSubscriptionStatus,
  startCheckout,
  consumePendingPurchaseKind,
  PRICE_TIERS,
  type HouseholdSubscription,
  type PriceTier,
} from '../../domain/billing'
import { BottomSheet } from '../../components/BottomSheet'
import { useEscapeKey } from '../../hooks/useEscapeKey'

// 三档"咖啡"按钮——1/2/3杯对应RM39/89/139，三档解锁的是完全一样的东西，杯数只是
// "想支持多少"的刻度，不是"买得多解锁更多功能"，所以不用箭头/推荐标签这类暗示
// 层级的装饰。悬停时整颗按钮和杯子图标一起轻轻上浮，点击后播放"续杯"动画（杯子
// 缩一下再弹回、轻轻晃两下、冒起几缕蒸汽）再进入跳转中状态——蒸汽这条动效语言
// 是特意跟下面"解锁成功"的涟漪+火花区分开，两个庆祝时刻不该长得一样
function TierButton({
  tier,
  cups,
  price,
  pendingTier,
  disabled,
  onPick,
}: {
  tier: PriceTier
  cups: number
  price: string
  pendingTier: PriceTier | null
  disabled: boolean
  onPick: (tier: PriceTier) => void
}) {
  const { t } = useTranslation()
  const btnRef = useRef<HTMLButtonElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const isPending = pendingTier === tier

  useEffect(() => {
    if (!isPending) return
    const wrap = wrapRef.current
    if (!wrap) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) return

    const steams: HTMLDivElement[] = []
    const steamCount = 3
    for (let i = 0; i < steamCount; i++) {
      const s = document.createElement('div')
      s.className = 'absolute bottom-1/2 left-1/2 w-[3px] h-[3px] rounded-full bg-plan opacity-0'
      wrap.appendChild(s)
      steams.push(s)
    }

    gsap.set(wrap, { transformOrigin: '50% 50%' })
    const tl = gsap.timeline()
    tl.to(wrap, { scale: 0.9, duration: 0.1, ease: 'power1.out' })
      .to(wrap, { scale: 1, duration: 0.2, ease: 'back.out(3)' })
      .to(wrap, { rotate: -6, duration: 0.09 }, '<')
      .to(wrap, { rotate: 6, duration: 0.18, ease: 'power1.inOut' })
      .to(wrap, { rotate: 0, duration: 0.12 })

    steams.forEach((s, i) => {
      tl.to(
        s,
        { opacity: 0.6, y: -16 - i * 5, x: (i - 1) * 5, duration: 0.75, ease: 'power1.out' },
        0.15 + i * 0.07
      ).to(s, { opacity: 0, y: -28 - i * 5, duration: 0.4 }, '-=0.2')
    })

    return () => {
      tl.kill()
      steams.forEach((s) => s.remove())
    }
  }, [isPending])

  function handleEnter() {
    if (disabled) return
    gsap.to(btnRef.current, { y: -2, duration: 0.15, ease: 'power1.out' })
    gsap.to(wrapRef.current, { y: -1, duration: 0.15, ease: 'power1.out' })
  }
  function handleLeave() {
    gsap.to(btnRef.current, { y: 0, duration: 0.15, ease: 'power1.out' })
    gsap.to(wrapRef.current, { y: 0, duration: 0.15, ease: 'power1.out' })
  }

  return (
    <button
      ref={btnRef}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={() => onPick(tier)}
      disabled={disabled}
      className="relative flex-1 flex flex-col items-center gap-1.5 rounded-xl border border-line bg-card py-3 disabled:opacity-50"
    >
      <div ref={wrapRef} className="relative flex items-center justify-center gap-0.5 h-5">
        {Array.from({ length: cups }).map((_, i) => (
          <Coffee key={i} className="w-[16px] h-[16px] text-plan" strokeWidth={1.8} />
        ))}
      </div>
      <span className="text-[11px] font-medium">
        {isPending ? t('subscription.redirecting') : t('subscription.tierLabel', { count: cups, price })}
      </span>
    </button>
  )
}

// 免费1趟、第2趟起要点单解锁的真付费墙——不是订阅，锁头图标就是这个状态最直接
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
  const [pendingTier, setPendingTier] = useState<PriceTier | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [purchaseWasTip, setPurchaseWasTip] = useState(false)

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

  // 跳转前会记一下这次点的是"第一次解锁"还是"已解锁后的打赏"（见billing.ts的
  // markPendingPurchaseKind）——Checkout整页跳转会离开这个页面，等Stripe跳回来
  // 已经没有当时点击的context了，只能靠这个在跳转前先存一下
  useEffect(() => {
    if (!justPurchased) return
    setPurchaseWasTip(consumePendingPurchaseKind() === 'tip')
  }, [justPurchased])

  // 解锁成功的庆祝动画：锁上的图标淡出缩小，打开的图标同时弹入放大再回弹——两个
  // 都是lucide本来的Lock/Unlock图案，不是拿一条弧线硬转出假的"开锁"效果（试过，
  // 效果很别扭）。配一圈涟漪+几点火花，克制一点，不是撒花那种庆祝。已解锁后的
  // 打赏走同一套感谢弹层但不重放这个动画——没有"解锁"这件事发生，重放会显得奇怪
  useEffect(() => {
    if (!justPurchased || purchaseWasTip) return
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
  }, [justPurchased, purchaseWasTip])

  async function handlePick(tier: PriceTier, kind: 'unlock' | 'tip') {
    setPendingTier(tier)
    setActionError(null)
    try {
      await startCheckout(tier, kind)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
      setPendingTier(null)
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
            {!purchaseWasTip && (
              <>
                <div ref={ring1Ref} className="absolute inset-0 rounded-full border-[1.5px] border-plan opacity-0" />
                <div ref={ring2Ref} className="absolute inset-0 rounded-full border-[1.5px] border-plan opacity-0" />
              </>
            )}
            <div className="absolute inset-0 m-auto w-11 h-11 rounded-[13px] bg-plan/[0.08] flex items-center justify-center text-plan">
              {purchaseWasTip ? (
                <Coffee className="w-[22px] h-[22px]" strokeWidth={1.8} />
              ) : (
                <>
                  <Lock ref={closedIconRef} className="w-[22px] h-[22px] absolute inset-0 m-auto" strokeWidth={1.8} />
                  <Unlock ref={openIconRef} className="w-[22px] h-[22px] absolute inset-0 m-auto" strokeWidth={1.8} />
                </>
              )}
            </div>
          </div>
          <div className="text-[13px] font-semibold mb-1.5">
            {t(purchaseWasTip ? 'subscription.tipThankYouTitle' : 'subscription.thankYouTitle')}
          </div>
          <div className="text-[11.5px] text-muted leading-relaxed">
            {t(purchaseWasTip ? 'subscription.tipThankYouBody' : 'subscription.thankYouBody')}
          </div>
        </div>
      ) : (
        <>
          {sub === undefined && (
            <div className="text-[12px] text-muted text-center py-4">{t('subscription.loading')}</div>
          )}
          {sub === null && <div className="text-[12px] text-negative text-center py-4">{t('subscription.loadError')}</div>}

          {sub && (
            <>
              {!isActive && blocked && (
                <div className="mb-3">
                  <div className="text-[12.5px] font-semibold mb-1">{t('subscription.limitTitle')}</div>
                  <div className="text-[11.5px] text-muted leading-relaxed">{t('subscription.limitBody')}</div>
                </div>
              )}

              {!isActive && (
                <div className="text-[11.5px] text-muted leading-relaxed mb-4">{t('subscription.description')}</div>
              )}

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
              </div>

              {isActive && (
                <div className="text-[11.5px] text-muted leading-relaxed mt-4 mb-3">
                  {t('subscription.tipSectionLede')}
                </div>
              )}

              <div className={`flex gap-2 ${isActive ? '' : 'mt-3'}`}>
                {PRICE_TIERS.map(({ tier, cups, display }) => (
                  <TierButton
                    key={tier}
                    tier={tier}
                    cups={cups}
                    price={display}
                    pendingTier={pendingTier}
                    disabled={pendingTier !== null}
                    onPick={(t) => handlePick(t, isActive ? 'tip' : 'unlock')}
                  />
                ))}
              </div>

              {actionError && <div className="text-[11px] text-negative mt-2 text-center">{actionError}</div>}
            </>
          )}
        </>
      )}
    </BottomSheet>
  )
}
