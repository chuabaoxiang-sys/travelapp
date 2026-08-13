import { useEffect, useRef, useState } from 'react'
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
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const init = value ? parseISO(value) : { y: new Date().getFullYear(), m: new Date().getMonth() + 1, d: 1 }
  const [viewY, setViewY] = useState(init.y)
  const [viewM, setViewM] = useState(init.m)
  const ref = useRef<HTMLDivElement>(null)

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
        className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-left outline-none focus:border-plan flex items-center justify-between"
      >
        <span className={value ? 'text-ink tabular' : 'text-muted'}>{value ? formatDisplay(value) : placeholder}</span>
        <Calendar className="w-3.5 h-3.5 text-muted flex-shrink-0" strokeWidth={1.8} />
      </button>

      {open && (
        <div className="absolute z-40 mt-1.5 w-[280px] rounded-2xl border border-line bg-card shadow-lg p-3">
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
              return (
                <button
                  type="button"
                  key={i}
                  onClick={() => { onChange(iso); setOpen(false) }}
                  className={`aspect-square rounded-lg text-[12.5px] tabular ${
                    isSelected ? 'bg-plan text-card font-semibold' : 'text-ink hover:bg-paper'
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
            <button
              type="button"
              onClick={() => {
                const t = new Date()
                onChange(toISO(t.getFullYear(), t.getMonth() + 1, t.getDate()))
                setOpen(false)
              }}
              className="text-[11.5px] text-plan"
            >
              今天
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
