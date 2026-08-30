import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEscapeKey } from '../hooks/useEscapeKey'

const DOW = ['一', '二', '三', '四', '五', '六', '日']
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

function parseISO(v: string) {
  const [y, m, d] = v.split('-').map(Number)
  return { y, m, d }
}

function toISO(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function daysInMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate()
}

// getDay(): 0=周日..6=周六 → 转成周一开头的偏移量
function mondayOffset(y: number, m: number) {
  const dow = new Date(y, m - 1, 1).getDay()
  return (dow + 6) % 7
}

function formatDisplay(v: string) {
  if (!v) return ''
  const { y, m, d } = parseISO(v)
  return `${y}年${m}月${d}日`
}

export function DatePicker({
  value,
  onChange,
  placeholder = '选择日期',
  min,
  max,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  // 允许选择的日期范围（闭区间，ISO字符串），超出范围的日期在日历里直接置灰点不了，
  // 而不是等选完了再在别处报错——目前唯一用到的地方是行程表单的出发/返程日期
  // 互相约束对方能选的范围
  min?: string
  max?: string
}) {
  const [open, setOpen] = useState(false)
  const init = value ? parseISO(value) : { y: new Date().getFullYear(), m: new Date().getMonth() + 1, d: 1 }
  const [viewY, setViewY] = useState(init.y)
  const [viewM, setViewM] = useState(init.m)
  const ref = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  // 日历弹层的位置要算，不能写死。它宽 280px 而触发它的输入框可能只有一半卡片宽
  // （比如"出发日期/返程日期"是两列并排），`absolute` 默认从容器左边展开的话，
  // 右列那个必然把日历铺到屏幕外面去——真机上就是右边一整列日期看不见。
  // 垂直方向同理：以前永远向下弹，不管下面还剩多少空间。
  //
  // 做法：打开时量一次弹层的真实尺寸（月份不同行数不同，高度会变，所以 viewY/viewM
  // 也在依赖里），水平方向不够就整体往左推、但不越过左边界；下面放不下而上面更宽裕
  // 就改成向上弹。算出来之前先渲染成透明的，避免看到跳一下
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const anchor = ref.current?.getBoundingClientRect()
    const popup = popupRef.current?.getBoundingClientRect()
    if (!anchor || !popup) return

    const MARGIN = 8
    // 用布局视口（documentElement.clientWidth/Height）而不是 window.innerWidth/Height：
    // innerWidth 会把桌面端的滚动条宽度算进去，导致按它算出来的位置还是差几像素被切；
    // 真机上如果页面本身横向能滚，两者也会不一致。clientWidth 才是内容真正可用的宽度
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight

    // 先按"跟输入框左边对齐"，再夹进视口范围内。用 max(MARGIN, ...) 兜底：
    // 万一屏幕比弹层还窄，至少保证左边不被切
    const clampedLeft = Math.min(Math.max(anchor.left, MARGIN), Math.max(MARGIN, vw - popup.width - MARGIN))
    const left = clampedLeft - anchor.left

    const spaceBelow = vh - anchor.bottom
    const openUp = spaceBelow < popup.height + MARGIN && anchor.top > spaceBelow

    setPos(openUp ? { left, bottom: anchor.height + 6 } : { left, top: anchor.height + 6 })
  }, [open, viewY, viewM])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEscapeKey(open, () => setOpen(false))

  function shiftMonth(delta: number) {
    let m = viewM + delta
    let y = viewY
    if (m < 1) { m = 12; y -= 1 }
    if (m > 12) { m = 1; y += 1 }
    setViewM(m)
    setViewY(y)
  }

  const offset = mondayOffset(viewY, viewM)
  const total = daysInMonth(viewY, viewM)
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)]

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-left outline-none focus:border-plan flex items-center justify-between gap-1.5"
      >
        <span className={`min-w-0 truncate ${value ? 'text-ink tabular' : 'text-muted'}`}>{value ? formatDisplay(value) : placeholder}</span>
        <Calendar className="w-3.5 h-3.5 text-muted flex-shrink-0" strokeWidth={1.8} />
      </button>

      {open && (
        <div
          ref={popupRef}
          style={pos ? { left: pos.left, top: pos.top, bottom: pos.bottom } : undefined}
          className={`absolute z-40 w-[280px] max-w-[calc(100vw-16px)] rounded-2xl border border-line bg-card shadow-lg p-3 ${
            pos ? '' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => shiftMonth(-1)} className="w-7 h-7 rounded-full hover:bg-paper text-muted flex items-center justify-center">
              <ChevronLeft className="w-4 h-4" strokeWidth={1.8} />
            </button>
            <span className="font-serif-sc text-sm font-semibold">{viewY}年 {MONTH_NAMES[viewM - 1]}</span>
            <button type="button" onClick={() => shiftMonth(1)} className="w-7 h-7 rounded-full hover:bg-paper text-muted flex items-center justify-center">
              <ChevronRight className="w-4 h-4" strokeWidth={1.8} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DOW.map((d) => (
              <div key={d} className="text-center text-[10px] text-muted">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (d === null) return <div key={i} />
              const iso = toISO(viewY, viewM, d)
              const isSelected = iso === value
              const disabled = (!!min && iso < min) || (!!max && iso > max)
              return (
                <button
                  type="button"
                  key={i}
                  disabled={disabled}
                  onClick={() => { onChange(iso); setOpen(false) }}
                  className={`aspect-square rounded-lg text-[12.5px] tabular ${
                    disabled
                      ? 'text-muted/40 cursor-not-allowed'
                      : isSelected ? 'bg-plan text-card font-semibold' : 'text-ink hover:bg-paper'
                  }`}
                >
                  {d}
                </button>
              )
            })}
          </div>
          <div className="flex justify-between mt-2 pt-2 border-t border-line">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false) }}
              className="text-muted"
              title="清除"
            >
              <X className="w-[15px] h-[15px]" strokeWidth={1.8} />
            </button>
            {(() => {
              const t = new Date()
              const todayISO = toISO(t.getFullYear(), t.getMonth() + 1, t.getDate())
              if ((!!min && todayISO < min) || (!!max && todayISO > max)) return null
              return (
                <button
                  type="button"
                  onClick={() => { onChange(todayISO); setOpen(false) }}
                  className="text-[11.5px] text-plan"
                >
                  今天
                </button>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
