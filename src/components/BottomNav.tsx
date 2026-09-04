import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'

// 图标路径来自设计稿《底部导航图标.dc.html》(claude.ai/design 项目 504930bf-8bee-40ef-8a96-d7c3e5f39ae7)
// 规范：24×24 viewBox，stroke-width 1.6，圆头圆角；选中态图标 --color-plan，未选中 --color-nav-inactive。
// "概览"和"更多"是这次重构新加的两个tab，设计稿里没有对应图标，照着同一套规范新画：
// 概览用"眼睛"（一眼看完这趟的意思），更多沿用顶部已经在用的三点样式，保持用户已经
// 认得的符号，不额外发明一个新图形
const ICON_PATHS: Record<Exclude<TabKey, 'more'>, { d: string; d2: string }> = {
  overview: { d: 'M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z', d2: 'M12 14.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z' },
  itinerary: { d: 'M4 6.5 9.5 4.5 14.5 6.5 20 4.5v13L14.5 19.5 9.5 17.5 4 19.5z', d2: 'M9.5 4.5v13M14.5 6.5v13' },
  ledger: { d: 'M6 3.5h9.5L19 7v13.5H6z', d2: 'M9 9.5h7M9 13h7M9 16.5h4' },
}

export type TabKey = 'overview' | 'itinerary' | 'ledger' | 'more'

function TabIcon({ tab, active }: { tab: TabKey; active: boolean }) {
  const color = active ? 'var(--color-plan)' : 'var(--color-nav-inactive)'
  const common = { viewBox: '0 0 24 24', style: { width: 23, height: 23, display: 'block' as const } }
  if (tab === 'more') {
    return (
      <svg {...common} fill="none">
        <circle cx="5" cy="12" r="1.4" fill={color} stroke="none" />
        <circle cx="12" cy="12" r="1.4" fill={color} stroke="none" />
        <circle cx="19" cy="12" r="1.4" fill={color} stroke="none" />
      </svg>
    )
  }
  const { d, d2 } = ICON_PATHS[tab]
  return (
    <svg {...common} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
      <path d={d2} />
    </svg>
  )
}

const TAB_KEYS: TabKey[] = ['overview', 'itinerary', 'ledger', 'more']

export function BottomNav({
  active,
  onChange,
  badges,
  onAddExpense,
  showFab = true,
  decorate,
}: {
  active: TabKey
  onChange: (k: TabKey) => void
  // 每个tab上"别人新写了几条"的未读数。故意做成可选：不传就完全是原来的样子
  badges?: Partial<Record<TabKey, number>>
  onAddExpense: () => void
  // 行程表单展开时腾出这个位置，跟之前独立悬浮的Fab是同一条隐藏逻辑，只是现在
  // Fab挪进了导航栏内部，由外面统一控制显隐而不是整个不渲染
  showFab?: boolean
  // 挂在某个tab图标右上角的自定义装饰，目前只有"更多"用来放首次使用的发现提示红点——
  // 那个红点要读当前成员id才能判断"看没看过"，BottomNav本身不该知道这件事，
  // 由调用方把渲染好的节点传进来最省事
  decorate?: Partial<Record<TabKey, ReactNode>>
}) {
  const { t } = useTranslation()

  // "记一笔"插在"行程"和"账目"中间——五格视觉上分成两半，中间那颗是唯一的
  // 强调色圆钮，而不是第五个平权的tab。用 slice 在数组中间插入渲染，而不是给
  // TAB_KEYS 数组本身加一项，是因为它的语义是"动作"不是"页面"，selected态、路由都不适用
  const left = TAB_KEYS.slice(0, 2)
  const right = TAB_KEYS.slice(2)

  function renderTab(key: TabKey) {
    const isActive = active === key
    const unseen = badges?.[key] ?? 0
    return (
      <button key={key} onClick={() => onChange(key)} className="flex-1 flex flex-col items-center gap-1 py-0.5">
        <span className="relative">
          <TabIcon tab={key} active={isActive} />
          {/* 只显示一个小圆点，不显示具体数字——数字会让人以为"必须逐条处理完"，
              而这里想传达的只是"有人动过，去看一眼" */}
          {unseen > 0 && (
            <span
              className="absolute -top-0.5 -right-1 w-[7px] h-[7px] rounded-full bg-spend ring-2 ring-paper"
              aria-label={t('nav.unseenBadge', { count: unseen })}
            />
          )}
          {decorate?.[key]}
        </span>
        <span className={`text-[10.5px] tracking-wide ${isActive ? 'text-ink' : 'text-nav-inactive'}`}>{t(`nav.${key}`)}</span>
      </button>
    )
  }

  return (
    <div className="nav-blur absolute left-0 right-0 bottom-0 z-10 bg-paper/[.92] backdrop-blur-[18px] border-t border-line pt-[9px] pb-safe-nav px-3 flex flex-col items-center">
      <div className="flex w-full items-end">
        {left.map(renderTab)}
        <div className="flex-shrink-0 w-11 flex justify-center">
          {showFab && (
            <button
              onClick={onAddExpense}
              // 行程tab上这颗按钮的动作被TripShell换成了"添加行程项"（同一个"+"，
              // 不新增按钮），title跟着换一下，长按/悬停时读到的文字才对得上
              title={active === 'itinerary' ? t('nav.addItineraryItem') : t('nav.addExpense')}
              className="w-[46px] h-[46px] rounded-full bg-plan text-card flex items-center justify-center -mt-[22px] transition-transform active:scale-95"
              style={{ boxShadow: '0 8px 18px color-mix(in srgb, var(--color-plan) 35%, transparent)' }}
            >
              <Plus className="w-6 h-6" strokeWidth={2} />
            </button>
          )}
        </div>
        {right.map(renderTab)}
      </div>
    </div>
  )
}
