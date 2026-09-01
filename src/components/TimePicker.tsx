import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { useEscapeKey } from '../hooks/useEscapeKey'

const SLOTS: string[] = []
for (let h = 0; h < 24; h++) {
  for (const m of [0, 15, 30, 45]) {
    SLOTS.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }
}

export function TimePicker({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEscapeKey(open, () => setOpen(false))

  useEffect(() => {
    if (open && listRef.current) {
      // 还没选过时间的话，默认滚到早上08:00附近——行程活动一般从白天开始，
      // 从0点最上面拖起来找早上的时段很麻烦
      const idx = value ? SLOTS.indexOf(value) : SLOTS.indexOf('08:00')
      const el = listRef.current.querySelector(`[data-idx="${idx}"]`) as HTMLElement | null
      el?.scrollIntoView({ block: value ? 'center' : 'start' })
    }
  }, [open, value])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-[110px] rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-plan flex items-center justify-between tabular"
      >
        <span className={value ? 'text-ink' : 'text-muted'}>{value || (placeholder ?? t('timePicker.placeholder'))}</span>
        <Clock className="w-3 h-3 text-muted flex-shrink-0" strokeWidth={1.8} />
      </button>

      {open && (
        <div className="absolute z-40 mt-1.5 w-[110px] rounded-xl border border-line bg-card shadow-lg overflow-hidden">
          <div ref={listRef} className="max-h-[200px] overflow-y-auto py-1 no-scrollbar">
            {SLOTS.map((s, i) => (
              <button
                type="button"
                key={s}
                data-idx={i}
                onClick={() => { onChange(s); setOpen(false) }}
                className={`w-full text-center py-1.5 text-[13px] tabular ${
                  s === value ? 'bg-plan text-card font-semibold' : 'text-ink hover:bg-paper'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
