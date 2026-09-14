import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

// 公开官网草稿（Artifact）落地后的正式实现——视觉/文案/视差手感跟草稿版一致，
// 但语言切换改走APP本来就有的i18next（不再是草稿里那套.zh/.en元素显隐的
// 土办法），颜色/字体直接用index.css里定稿的token对应的Tailwind class
// （bg-plan/text-ink这些，Tailwind v4从@theme自动生成），不重复定义一份。
// GSAP的scale动画特意不用——will-change:transform的图层缩放到中间某一帧时
// 会按那一帧的分辨率栅格化，缩回1:1后糊得很明显（截图这种密文字内容尤其
// 显眼，草稿阶段真的踩过这个坑）——改用opacity做"渐入聚焦"的深度感
type Phone = { src: string; alt: string; parallax: number; rotate?: number; variant?: 'hero' | 'small' | 'single' }

function PhoneFrame({ phone, className = '', inHero = false }: { phone: Phone; className?: string; inHero?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const dir = phone.parallax < 0 ? -1 : 1
    const travel = Math.abs(phone.parallax) * 300
    const rotate = phone.rotate ?? 0

    const ctx = gsap.context(() => {
      if (inHero) {
        // 首屏元素已经在首屏可见，只做"随滚动继续漂移"的终点动画，不用fromTo——
        // 避免页面一加载就先呈现一个"偏移过的"起始状态
        gsap.to(el, {
          y: -dir * travel * 0.6,
          rotation: rotate,
          ease: 'none',
          scrollTrigger: { trigger: '.welcome-hero', start: 'top top', end: 'bottom top', scrub: 0.6 },
        })
      } else {
        const section = el.closest('section')
        gsap.fromTo(
          el,
          { y: dir * travel, rotation: rotate, opacity: 0.55 },
          {
            y: -dir * travel,
            rotation: rotate,
            opacity: 1,
            ease: 'none',
            scrollTrigger: { trigger: section ?? el, start: 'top bottom', end: 'bottom top', scrub: 0.6 },
          }
        )
      }
    })

    return () => ctx.revert()
  }, [phone.parallax, phone.rotate, inHero])

  const width = phone.variant === 'small' ? 'w-[min(270px,66vw)]' : 'w-[min(340px,78vw)]'

  return (
    <div
      ref={ref}
      className={`relative ${width} bg-surface-strong rounded-[42px] p-2.5 shadow-[0_40px_70px_-30px_rgba(31,27,22,0.45),0_4px_18px_rgba(31,27,22,0.12)] ${className}`}
    >
      <div className="absolute top-[22px] left-1/2 -translate-x-1/2 w-[34%] h-2 rounded-full bg-white/[.14] z-10" />
      <img src={phone.src} alt={phone.alt} className="block w-full rounded-[32px] relative" />
    </div>
  )
}

function LangSwitch() {
  const { i18n } = useTranslation()
  return (
    <div className="flex border border-line rounded-full overflow-hidden text-[0.78rem]" role="group" aria-label="Language">
      {(['zh', 'en'] as const).map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => void i18n.changeLanguage(lang)}
          aria-pressed={i18n.language === lang}
          className={`px-3 py-1.5 ${i18n.language === lang ? 'bg-ink text-paper' : 'text-soft'}`}
        >
          {lang === 'zh' ? '中文' : 'EN'}
        </button>
      ))}
    </div>
  )
}

function StartFreeLink({ className, children }: { className: string; children: ReactNode }) {
  const { i18n } = useTranslation()
  // 同域相对链接，吃现成的 captureLocaleFromUrl（src/lib/locale.ts）——落地页选的
  // 语言会在登录前几屏优先生效，一旦选定身份后交还给该member自己的语言偏好
  return (
    <a href={`/?lang=${i18n.language}`} className={className}>
      {children}
    </a>
  )
}

const FEATURE_ACCENTS = {
  ledger: 'text-plan',
  calendar: 'text-cat-flight',
  satisfaction: 'text-positive',
  split: 'text-spend',
} as const
const RULE_ACCENTS = {
  ledger: 'bg-plan',
  calendar: 'bg-cat-flight',
  satisfaction: 'bg-positive',
  split: 'bg-spend',
} as const

function FeatureSection({
  id,
  featureKey,
  reversed,
  visual,
}: {
  id?: string
  featureKey: keyof typeof FEATURE_ACCENTS
  reversed: boolean
  visual: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <section id={id} className="py-22 border-t border-line">
      <div
        className={`max-w-[1120px] mx-auto grid grid-cols-1 md:grid-cols-2 gap-9 md:gap-14 items-center ${reversed ? 'md:[&>*:first-child]:order-2' : ''}`}
      >
        <div>
          <span className={`block text-[0.78rem] font-semibold uppercase tracking-[0.14em] mb-3.5 ${FEATURE_ACCENTS[featureKey]}`}>
            {t(`welcome.features.${featureKey}.eyebrow`)}
          </span>
          <div className={`w-11 h-[3px] rounded-full mb-4.5 ${RULE_ACCENTS[featureKey]}`} />
          <h2 className="font-serif-sc font-bold text-[clamp(1.6rem,3vw,2.15rem)] text-ink mb-4.5 text-balance">
            {t(`welcome.features.${featureKey}.heading`)}
          </h2>
          <p className="text-soft text-[1.02rem] max-w-[50ch]">{t(`welcome.features.${featureKey}.body`)}</p>
        </div>
        <div className="flex justify-center">{visual}</div>
      </div>
    </section>
  )
}

export function WelcomePage() {
  const { t } = useTranslation()

  return (
    <div className="min-h-screen bg-paper text-ink overflow-x-hidden px-6">
      <header className="sticky top-0 z-40 py-3.5 -mx-6 px-6 bg-paper/[.86] backdrop-blur-[10px] border-b border-line">
        <div className="max-w-[1120px] mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="font-serif-sc font-bold text-[1.15rem] tracking-[0.02em]">
            旅记<span className="font-sans-sc font-medium text-soft text-[0.85rem] ml-2">TripNotes</span>
          </div>
          <div className="flex items-center gap-2.5">
            <LangSwitch />
            <StartFreeLink className="inline-flex items-center gap-2 rounded-full bg-plan text-on-dark text-[0.82rem] font-semibold px-4 py-2">
              {t('welcome.header.cta')}
            </StartFreeLink>
          </div>
        </div>
      </header>

      <section className="welcome-hero relative pt-[72px] pb-10 overflow-hidden">
        <div
          className="absolute -top-[0.2em] -right-[0.1em] font-serif-sc font-bold text-ink/[.05] leading-none whitespace-nowrap pointer-events-none select-none z-0"
          style={{ fontSize: 'min(34vw, 420px)' }}
          aria-hidden="true"
        >
          旅記
        </div>
        <div className="relative z-10 max-w-[1120px] mx-auto grid grid-cols-1 md:grid-cols-[1.1fr_0.9fr] gap-12 items-center">
          <div>
            <span className="block text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-plan mb-3.5">
              {t('welcome.hero.eyebrow')}
            </span>
            <h1 className="font-serif-sc font-bold text-[clamp(2.1rem,4.6vw,3.4rem)] text-ink mb-5 text-balance">
              {t('welcome.hero.headline')}
            </h1>
            <p className="text-[1.08rem] text-soft max-w-[46ch] mb-7">{t('welcome.hero.lede')}</p>
            <div className="flex gap-3.5 flex-wrap">
              <StartFreeLink className="inline-flex items-center gap-2 rounded-full bg-plan text-on-dark text-[0.92rem] font-semibold px-5 py-2.5">
                {t('welcome.hero.ctaPrimary')}
              </StartFreeLink>
              <a
                href="#feature-ledger"
                className="inline-flex items-center gap-2 rounded-full border border-line text-ink text-[0.92rem] font-semibold px-5 py-2.5"
              >
                {t('welcome.hero.ctaSecondary')}
              </a>
            </div>
          </div>
          <div className="relative flex justify-center order-first md:order-none">
            <PhoneFrame
              inHero
              phone={{ src: '/welcome-shots/map.png', alt: 'TripNotes map view', parallax: 0.22, variant: 'hero' }}
            />
          </div>
        </div>
      </section>

      <FeatureSection
        id="feature-ledger"
        featureKey="ledger"
        reversed={false}
        visual={
          <div className="relative flex justify-center items-center min-h-[280px] md:min-h-[340px]">
            <PhoneFrame
              className="absolute left-[8%]"
              phone={{ src: '/welcome-shots/timeline.png', alt: 'Itinerary timeline', parallax: 0.2, rotate: -4, variant: 'small' }}
            />
            <PhoneFrame
              className="relative -right-[6%]"
              phone={{ src: '/welcome-shots/expense-list.png', alt: 'Expense list', parallax: -0.18, rotate: 3, variant: 'small' }}
            />
          </div>
        }
      />

      <FeatureSection
        featureKey="calendar"
        reversed={true}
        visual={<PhoneFrame phone={{ src: '/welcome-shots/calendar.png', alt: 'Calendar view', parallax: 0.24 }} />}
      />

      <FeatureSection
        featureKey="satisfaction"
        reversed={false}
        visual={<PhoneFrame phone={{ src: '/welcome-shots/satisfaction.png', alt: 'Satisfaction flip-card review', parallax: 0.24 }} />}
      />

      <FeatureSection
        featureKey="split"
        reversed={true}
        visual={
          <div className="relative flex justify-center items-center min-h-[280px] md:min-h-[340px]">
            <PhoneFrame
              className="absolute left-[8%]"
              phone={{ src: '/welcome-shots/rate-book.png', alt: 'Exchange rate book', parallax: 0.2, rotate: -4, variant: 'small' }}
            />
            <PhoneFrame
              className="relative -right-[6%]"
              phone={{ src: '/welcome-shots/settlement.png', alt: 'Settlement overview', parallax: -0.18, rotate: 3, variant: 'small' }}
            />
          </div>
        }
      />

      <div className="max-w-[1120px] mx-auto">
        <div className="mt-10 bg-plan rounded-[32px] px-10 py-16 text-center">
          <h2 className="font-serif-sc font-bold text-on-dark text-[clamp(1.6rem,3.4vw,2.3rem)] mb-3">{t('welcome.cta.heading')}</h2>
          <p className="text-plan-on-dark text-[1.05rem] mb-7">{t('welcome.cta.sub')}</p>
          <StartFreeLink className="inline-flex items-center gap-2 rounded-full bg-paper text-plan text-[0.92rem] font-semibold px-5 py-2.5">
            {t('welcome.cta.button')}
          </StartFreeLink>
        </div>
      </div>

      <footer className="max-w-[1120px] mx-auto py-8 pb-12 flex justify-between items-center flex-wrap gap-3 text-muted text-[0.85rem]">
        <div className="font-serif-sc font-bold text-[0.95rem]">
          旅记<span className="font-sans-sc font-medium text-soft text-[0.85rem] ml-2">TripNotes</span>
        </div>
        <div>{t('welcome.footer')}</div>
      </footer>
    </div>
  )
}
