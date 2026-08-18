import { Plus } from 'lucide-react'

// 图标路径来自设计稿《底部导航图标.dc.html》(claude.ai/design 项目 504930bf-8bee-40ef-8a96-d7c3e5f39ae7)
// 规范：24×24 viewBox，stroke-width 1.6，圆头圆角；选中态图标 #4C1D95，未选中 #A79E92
const ICON_PATHS: Record<TabKey, { d: string; d2: string }> = {
  itinerary: { d: 'M4 6.5 9.5 4.5 14.5 6.5 20 4.5v13L14.5 19.5 9.5 17.5 4 19.5z', d2: 'M9.5 4.5v13M14.5 6.5v13' },
  ledger: { d: 'M6 3.5h9.5L19 7v13.5H6z', d2: 'M9 9.5h7M9 13h7M9 16.5h4' },
  budget: { d: 'M12 3.5a8.5 8.5 0 1 0 8.5 8.5', d2: 'M12 12V3.5a8.5 8.5 0 0 1 8.5 8.5z' },
  split: {
    d: 'M8.5 8.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5M3.5 20.5c0-3 2.2-5 5-5s5 2 5 5',
    d2: 'M16.5 10.5h5m-2.5-2.5v5M17 20.5c0-2.3 1.4-4 3.5-4.4',
  },
}

export type TabKey = 'itinerary' | 'ledger' | 'budget' | 'split'

function TabIcon({ tab, active }: { tab: TabKey; active: boolean }) {
  const { d, d2 } = ICON_PATHS[tab]
  const color = active ? '#4C1D95' : '#A79E92'
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ width: 23, height: 23, display: 'block' }}>
      <path d={d} />
      <path d={d2} />
    </svg>
  )
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'itinerary', label: '行程' },
  { key: 'ledger', label: '记账' },
  { key: 'budget', label: '预算' },
  { key: 'split', label: '分账' },
]

export function BottomNav({
  active,
  onChange,
  badges,
}: {
  active: TabKey
  onChange: (k: TabKey) => void
  // 每个tab上"别人新写了几条"的未读数。故意做成可选：不传就完全是原来的样子
  badges?: Partial<Record<TabKey, number>>
}) {
  return (
    <div className="absolute left-0 right-0 bottom-0 z-10 bg-paper/[.92] backdrop-blur-[18px] border-t border-[#E4DCCF] pt-[9px] pb-safe-nav px-3 flex flex-col items-center">
      <div className="flex w-full">
        {TABS.map((t) => {
          const isActive = active === t.key
          const unseen = badges?.[t.key] ?? 0
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className="flex-1 flex flex-col items-center gap-1 py-0.5"
            >
              <span className="relative">
                <TabIcon tab={t.key} active={isActive} />
                {/* 只显示一个小圆点，不显示具体数字——数字会让人以为"必须逐条处理完"，
                    而这里想传达的只是"有人动过，去看一眼" */}
                {unseen > 0 && (
                  <span
                    className="absolute -top-0.5 -right-1 w-[7px] h-[7px] rounded-full bg-spend ring-2 ring-paper"
                    aria-label={`有 ${unseen} 条新记录`}
                  />
                )}
              </span>
              <span className={`text-[10.5px] tracking-wide ${isActive ? 'text-ink' : 'text-[#A79E92]'}`}>{t.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function Fab({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="记一笔"
      className="absolute right-5 bottom-safe-fab w-[54px] h-[54px] rounded-full bg-plan text-card flex items-center justify-center z-20 shadow-[0_8px_20px_rgba(76,29,149,0.35)] transition-transform active:scale-95"
    >
      <Plus className="w-7 h-7" strokeWidth={2} />
    </button>
  )
}
