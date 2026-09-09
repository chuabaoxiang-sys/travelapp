import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { TUTORIALS, stepRing, tutorialImage, type Tutorial } from './tutorialsData'
import { useBackDismiss } from '../../hooks/useBackDismiss'

// 滑动切页的判定阈值（px）——横向位移超过这个数、且比竖向位移更明显，才算一次滑动，
// 避免正常点击/竖向滑动被误判
const SWIPE_THRESHOLD = 40

// 教程库首页 + 详情页两层，全部收在这一个组件里自己管理内部状态——外层只需要知道
// "开/关"，不需要知道用户具体点进了哪一篇、翻到第几步，跟WishlistScreen自己管理
// "列表/地图"二级视图是同一个思路。
//
// 详情页也注册了一次useBackDismiss，跟挂载这个组件的外层（TripShell/TripPicker）
// 为"教程库开着"注册的那一层各自独立——真机反馈过"预览完按返回直接退出到APP主页
// 而不是先退回教程列表"，根因是useBackDismiss以前所有活跃实例共用同一个popstate
// 事件，两层同时响应会一起关掉。现在useBackDismiss.ts自己维护了一个共享栈，一次
// 返回键只处理最内层那一个，这里可以放心跟其他弹层一样正常嵌套注册
export function TutorialLibraryScreen({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState<string | null>(null)
  useBackDismiss(activeId !== null, () => setActiveId(null))

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
  // 记指针按下的起点，只在松开那一刻判定一次性滑动方向——不做实时拖拽跟手效果
  // （截图是静态整页，两张图之间没有中间态可以插值），这样最简单也最不容易出错
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  const steps = t(`tutorials.${tutorial.id}.steps`, { returnObjects: true }) as { title: string; desc: string }[]
  const stepId = tutorial.stepIds[stepIndex]
  const step = steps[stepIndex]
  const ring = stepRing(stepId, lang)
  const isLast = stepIndex === tutorial.stepIds.length - 1

  function goTo(i: number) {
    setStepIndex(i)
  }

  // 故意不调用 setPointerCapture——试过之后发现它会连带把"点击"也重定向到
  // 捕获它的这个外层容器上，导致容器内嵌套的圆点、翻页箭头这些按钮的onClick
  // 完全失效（用JS直接调.click()测试是正常的，因为那样绕过了浏览器原生的
  // 指针事件流程，只有真实点击才会触发这个问题，排查这个bug花了不少功夫）。
  // 不用捕获的代价：如果手指拖到这个容器范围以外才松开，这次滑动不会被计入——
  // 这个容器基本覆盖了头部以下的整个画面，真实发生这种情况的概率很低，
  // 换来嵌套按钮能正常点击是更值得的取舍
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragStart.current = { x: e.clientX, y: e.clientY }
  }
  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const start = dragStart.current
    dragStart.current = null
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return
    if (dx < 0) {
      // 最后一步再往前滑，等同于"完成"，直接退回教程库首页——没有按钮了，
      // 不能再靠"下一步"变成"完成"来提示这件事
      if (isLast) onBack()
      else goTo(stepIndex + 1)
    } else if (stepIndex > 0) {
      goTo(stepIndex - 1)
    }
  }
  function handlePointerCancel() {
    dragStart.current = null
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

      {/* 拖拽/滑动的判定挂在这一整块（头部下面除了头部本身的所有区域：图片、
          标题、说明、圆点），不是只挂在图片小方框上——之前只在图片上做过一版，
          用户真机反馈"拖图片两侧空白/标题文字也能翻页"，怀疑是移动端浏览器下
          图片容器的可交互范围跟可见范围对不上（inline-block收缩不够贴，具体
          原因没能在桌面上复现确认）。与其继续猜哪块区域算不算数，不如干脆整个
          内容区域都当成同一块可滑动画布——这样"拖哪都能翻页"就是设计好的行为，
          不再是要修的bug */}
      <div
        className="flex-1 flex flex-col min-h-0 touch-pan-y"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div className="flex-1 flex flex-col justify-center min-h-0 px-5 pt-4 pb-2">
          {/* 图片按高度封顶（不再按宽度撑满），一屏放得下图+文字+圆点，不用再
              上下拖动才能看完一步；红圈的百分比定位相对这个盒子，不用跟着改。
              尺寸用aspect-ratio+固定高度算出来（不依赖img加载状态或inline-block
              收缩行为），比单纯"按宽度撑满"更可控，虽然这次滑动判定已经挪到了
              外层，不再单独依赖这个盒子的边界，但保留这个写法本身仍然更稳妥 */}
          {/* 图片两侧加一对箭头按钮——纯图标+圆点不够明显，用户反馈"看不出来能滑动"。
              箭头本身也是可以直接点的翻页入口，跟滑动是两条并行的路，不是滑动的
              视觉提示而已。箭头按钮的点击跟外层的滑动手势各自独立：箭头是普通
              button，点击事件不会被外层的pointerdown/up判定成一次滑动（位移量
              基本是0，够不上SWIPE_THRESHOLD） */}
          <div className="relative flex justify-center mb-5 flex-shrink-0">
            <button
              onClick={() => stepIndex > 0 && goTo(stepIndex - 1)}
              disabled={stepIndex === 0}
              title={t('tutorials.prevStep')}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-card border border-line shadow-sm flex items-center justify-center text-muted disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" strokeWidth={2.2} />
            </button>
            <div
              className="relative rounded-2xl overflow-hidden border border-line shadow-sm"
              style={{ height: '60vh', aspectRatio: '390 / 844' }}
            >
              <img src={tutorialImage(stepId, lang)} alt="" className="block w-full h-full" draggable={false} />
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
            <button
              onClick={() => (isLast ? onBack() : goTo(stepIndex + 1))}
              title={t('tutorials.nextStep')}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-plan text-card shadow-sm flex items-center justify-center"
            >
              <ChevronRight className="w-4 h-4" strokeWidth={2.2} />
            </button>
          </div>
          <div className="flex-shrink-0 overflow-y-auto no-scrollbar max-h-[30vh]">
            <div className="font-serif-sc text-[18px] font-semibold text-center mb-1.5">{step.title}</div>
            <div className="text-[15px] text-muted text-center leading-relaxed max-w-[320px] mx-auto">{step.desc}</div>
          </div>
        </div>

        <div className="flex justify-center gap-1.5 py-2.5 px-5 pb-5 flex-shrink-0 overflow-x-auto no-scrollbar">
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
      </div>
    </>
  )
}
