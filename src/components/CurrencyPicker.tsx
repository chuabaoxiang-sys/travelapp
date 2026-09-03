import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { searchCurrencies } from '../lib/currencies'
import { useEscapeKey } from '../hooks/useEscapeKey'

// 跟 CountryPicker 是同一套交互（搜索输入+下拉候选+可移除的胶囊），故意保持
// 一致——用户已经在"目的地国家"那里学过这套操作，换个字段不用重新学一遍。
// homeCurrency 固定显示成一枚不可移除的胶囊：它是Trip自己的字段，不属于这里
// 管理的"额外会用到的货币"列表，放在这里只是让用户看清楚"本位币已经算进去了，
// 不用重复选"
export function CurrencyPicker({
  homeCurrency,
  value,
  onChange,
}: {
  homeCurrency: string
  value: string[]
  onChange: (codes: string[]) => void
}) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEscapeKey(open, () => setOpen(false))

  const results = searchCurrencies(query).filter((c) => c.code !== homeCurrency && !value.includes(c.code))

  function add(code: string) {
    onChange([...value, code])
    setQuery('')
    setOpen(false)
  }
  function remove(code: string) {
    onChange(value.filter((c) => c !== code))
  }

  return (
    <div>
      <div className="text-[10.5px] tracking-widest uppercase text-muted mb-1.5">{t('currencyPicker.label')}</div>
      <div className="relative" ref={wrapRef}>
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          <span className="inline-flex items-center rounded-full bg-segment text-soft text-[11.5px] px-2.5 py-1">
            {t('currencyPicker.homeCurrencySuffix', { code: homeCurrency })}
          </span>
          {value.map((code) => (
            <span key={code} className="inline-flex items-center gap-1 rounded-full bg-plan/10 text-plan text-[11.5px] px-2.5 py-1">
              {code}
              <button type="button" onClick={() => remove(code)} className="text-plan/60 hover:text-plan" title={t('currencyPicker.remove')}>
                <X className="w-2.5 h-2.5" strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={t('currencyPicker.searchPlaceholder')}
          className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-plan"
        />
        <div className="text-[10.5px] text-muted mt-1">{t('currencyPicker.hint')}</div>
        {open && results.length > 0 && (
          <div className="absolute z-40 mt-1 w-full rounded-xl border border-line bg-card shadow-lg overflow-hidden max-h-[180px] overflow-y-auto no-scrollbar">
            {results.map((c) => (
              <button
                type="button"
                key={c.code}
                onClick={() => add(c.code)}
                className="w-full text-left px-3 py-2 text-[12.5px] text-ink hover:bg-paper border-b border-line last:border-0"
              >
                {i18n.language === 'en' ? c.nameEn : c.nameZh} <span className="text-muted text-[10.5px]">{c.code}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
