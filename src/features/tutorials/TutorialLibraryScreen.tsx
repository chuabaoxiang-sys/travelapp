import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ChevronLeft } from 'lucide-react'
import { TUTORIALS, stepRing, tutorialImage, type Tutorial } from './tutorialsData'

// 教程库首页 + 详情页两层，全部收在这一个组件里自己管理内部状态——外层只需要知道
// "开/关"，不需要知道用户具体点进了哪一篇、翻到第几步，跟WishlistScreen自己管理
// "列表/地图"二级视图是同一个思路。
//
// 这里刻意不为 activeId 再单独注册一次 useBackDismiss——试过之后发现真会出bug：
// 挂载这个组件的外层（TripShell/TripPicker）已经为"教程库开着"这件事注册了一次
// useBackDismiss，如果这里再注册第二层，两个popstate监听器会同时收到同一次
// history.back()触发的事件，导致"从详情退回首页"这个内层动作，会被外层监听器
// 误判成"用户按了返回键"，整个教程库跟着一起被关掉。WishlistScreen自己的
// "列表/地图"切换同样没有再注册一次——这是这个项目里"弹层内部还有二级视图"时
// 该有的正确写法：安卓返回键统一退出整个弹层，二级视图内的"返回上一级"只通过
// 界面上的按钮（上面的返回箭头）来做，不接管系统返回键
export function TutorialLibraryScreen({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState<string | null>(null)

  const active = TUTORIALS.find((tut) => tut.id === activeId) ?? null

  return (
    <div className="absolute inset-0 z-30 bg-paper flex flex-col">
      {active ? (
        <TutorialDetail tutorial={active} onBack={() => setActiveId(null)} />
      ) : (
        <>
          <div className="flex items-center justify-between px-5 pt-4 pb-2 flex-shrink-0 border-b border-line">
            <span className="font-serif-sc text-[15px] font-semibold">{t('tutorials.libraryTitle')}</span>
            <button onClick={onClose} className="text-muted" title={t('wishlist.close')}>
              <X className="w-[15px] h-[15px]" strokeWidth={1.8} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-3">
            <div className="grid gap-2.5">
              {TUTORIALS.map((tut) => {
                const Icon = tut.icon
                return (
                  <button
                    key={tut.id}
                    onClick={() => setActiveId(tut.id)}
                    className="flex items-center gap-3 rounded-2xl border border-line bg-card px-3.5 py-3 text-left"
                  >
                    <span className="w-[38px] h-[38px] rounded-xl bg-plan/[0.07] text-plan flex items-center justify-center flex-shrink-0">
                      <Icon className="w-[18px] h-[18px]" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold">{t(`tutorials.${tut.id}.title`)}</span>
                      <span className="block text-[11.5px] text-muted mt-0.5 leading-snug">
                        {t(`tutorials.${tut.id}.desc`)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function TutorialDetail({ tutorial, onBack }: { tutorial: Tutorial; onBack: () => void }) {
  const { t, i18n } = useTranslation()
  const [stepIndex, setStepIndex] = useState(0)
  const lang = i18n.language === 'en' ? 'en' : 'zh'

  const steps = t(`tutorials.${tutorial.id}.steps`, { returnObjects: true }) as { title: string; desc: string }[]
  const stepId = tutorial.stepIds[stepIndex]
  const step = steps[stepIndex]
  const ring = stepRing(stepId, lang)
  const isLast = stepIndex === tutorial.stepIds.length - 1

  function goTo(i: number) {
    setStepIndex(i)
  }

  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-4 pb-2.5 flex-shrink-0 border-b border-line">
        <button onClick={onBack} className="text-muted flex-shrink-0" title={t('wishlist.close')}>
          <ChevronLeft className="w-[18px] h-[18px]" strokeWidth={1.8} />
        </button>
        <span className="font-serif-sc text-[14.5px] font-semibold truncate flex-1">
          {t(`tutorials.${tutorial.id}.title`)}
        </span>
        <span className="w-[18px] flex-shrink-0" />
      </div>

      <div className="flex-1 overflow-y-auto px-5 pt-4 pb-2">
        <div className="relative w-full rounded-2xl overflow-hidden border border-line shadow-sm mb-4">
          <img src={tutorialImage(stepId, lang)} alt="" className="w-full h-auto block" />
          {ring && (
            <div
              className="absolute border-[3px] border-negative rounded-full pointer-events-none"
              style={{
                left: `${ring.left}%`,
                top: `${ring.top}%`,
                width: `${ring.width}%`,
                height: `${ring.height}%`,
                boxShadow: '0 0 0 3px color-mix(in srgb, var(--color-negative) 15%, transparent)',
              }}
            />
          )}
        </div>
        <div className="font-serif-sc text-[16px] font-semibold text-center mb-1.5">{step.title}</div>
        <div className="text-[13px] text-muted text-center leading-relaxed max-w-[320px] mx-auto">{step.desc}</div>
      </div>

      <div className="flex justify-center gap-1.5 py-2.5 px-5 flex-shrink-0 overflow-x-auto no-scrollbar">
        {tutorial.stepIds.map((id, i) => (
          <button
            key={id}
            onClick={() => goTo(i)}
            className={`h-[6px] rounded-full flex-shrink-0 transition-all ${
              i === stepIndex ? 'w-[18px] bg-plan' : 'w-[6px] bg-line'
            }`}
          />
        ))}
      </div>

      <div className="flex gap-2.5 px-5 pb-5 pt-1 flex-shrink-0">
        <button
          onClick={() => stepIndex > 0 && goTo(stepIndex - 1)}
          disabled={stepIndex === 0}
          className="flex-1 rounded-full border border-line text-muted py-2.5 text-[13.5px] font-semibold disabled:opacity-35"
        >
          {t('tutorials.back')}
        </button>
        <button
          onClick={() => (isLast ? onBack() : goTo(stepIndex + 1))}
          className="flex-1 rounded-full bg-plan text-card py-2.5 text-[13.5px] font-semibold"
        >
          {isLast ? t('tutorials.done') : t('tutorials.next')}
        </button>
      </div>
    </>
  )
}
