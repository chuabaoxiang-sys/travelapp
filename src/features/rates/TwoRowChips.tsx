import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp } from 'lucide-react'

// 一排可以换行的按钮，默认最多显示两行，其余收进「更多（n）」（2026-10-20：汇率越记越多，
// 全部平铺会把记账页撑得又长又乱）。
//
// "两行"按实际排出来的行数算，不是固定个数：汇率名字长短差很多，名字短的一行放得下
// 三四个，长的一行只放一两个，固定个数要么太挤要么浪费。做法是量每个子元素的 offsetTop——
// 收起时只是给外层加 max-height + overflow:hidden，子元素的排版位置不变，所以收起状态下
// 照样量得准。
//
// 子元素上带 data-selected="true" 的（当前选中的那个）如果排在两行以外，第一次量到它时
// 自动展开——编辑老账目时不会出现"选了却看不到"。只在第一次自动展开，之后用户自己收起就
// 收起，不会被反复撑开
const ROW_GAP_PX = 6 // 跟下面的 gap-1.5 对应

export function TwoRowChips({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [clip, setClip] = useState<{ height: number; hidden: number } | null>(null)
  const selectionChecked = useRef(false)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const items = Array.from(el.children) as HTMLElement[]
      const rowTops = [...new Set(items.map((c) => c.offsetTop))].sort((a, b) => a - b)
      if (!selectionChecked.current && items.some((c) => c.dataset.selected === 'true')) {
        selectionChecked.current = true
        if (rowTops.length > 2 && items.some((c) => c.dataset.selected === 'true' && c.offsetTop >= rowTops[2])) {
          setExpanded(true)
        }
      }
      const next = rowTops.length > 2
        ? { height: rowTops[2] - ROW_GAP_PX, hidden: items.filter((c) => c.offsetTop >= rowTops[2]).length }
        : null
      setClip((prev) => (prev?.height === next?.height && prev?.hidden === next?.hidden ? prev : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  })

  const collapsed = !!clip && !expanded
  return (
    <div>
      <div
        ref={containerRef}
        className="relative flex flex-wrap gap-1.5"
        style={collapsed ? { maxHeight: clip.height, overflow: 'hidden' } : undefined}
      >
        {children}
      </div>
      {clip && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-[11.5px] text-plan font-semibold mt-1.5"
        >
          {expanded ? <ChevronUp className="w-3 h-3" strokeWidth={2.5} /> : <ChevronDown className="w-3 h-3" strokeWidth={2.5} />}
          {expanded ? t('rateChip.showLess') : t('rateChip.more', { count: clip.hidden })}
        </button>
      )}
    </div>
  )
}
