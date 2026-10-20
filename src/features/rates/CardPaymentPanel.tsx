import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Check, X, CheckCircle2, Info } from 'lucide-react'
import { TwoRowChips } from './TwoRowChips'
import { formatCardRate } from '../../domain/paymentCards'
import type { PaymentCard } from '../../types'

// 记一笔里选了「刷卡」之后的那一块：选卡（「＋」当场建一张新卡）+「实际扣了 RM」。
// 只管显示和输入，算汇率/估算/保存都在 AddExpensePage 里——跟 RateChipRow 的分工一样
export function CardPaymentPanel({
  cards,
  selectedId,
  onSelect,
  onCreate,
  charged,
  onChargedChange,
  homeCurrency,
  derivedRate,
  estimateRate,
  estimateHome,
}: {
  cards: PaymentCard[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: (name: string) => Promise<void>
  charged: string
  onChargedChange: (v: string) => void
  homeCurrency: string
  // 填了实际扣款时算出来的这笔汇率
  derivedRate: number | null
  // 没填时用来估的汇率，和按它估出来的本位币金额
  estimateRate: number | null
  estimateHome: number
}) {
  const { t } = useTranslation()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const homePrefix = homeCurrency === 'MYR' ? 'RM' : homeCurrency

  async function confirmCreate() {
    if (!newName.trim()) return
    await onCreate(newName)
    setNewName('')
    setCreating(false)
  }

  return (
    <div>
      <TwoRowChips>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          title={t('card.add')}
          className={`rounded-full px-2.5 py-1.5 border flex items-center ${
            creating ? 'bg-plan/10 border-plan text-plan font-semibold' : 'border-plan text-plan'
          }`}
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
        {cards.map((c) => (
          <button
            type="button"
            key={c.id}
            data-selected={c.id === selectedId}
            onClick={() => { setCreating(false); onSelect(c.id) }}
            className={`rounded-full px-2.5 py-1.5 text-[11.5px] border ${
              c.id === selectedId ? 'bg-plan/10 border-plan text-plan font-semibold' : 'bg-card border-line text-soft'
            }`}
          >
            {c.name}
          </button>
        ))}
      </TwoRowChips>

      {creating && (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmCreate() } }}
            placeholder={t('card.namePlaceholder')}
            className="flex-1 min-w-0 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-plan"
          />
          <button type="button" onClick={() => setCreating(false)} className="text-muted px-1.5 py-1" title={t('rateBook.cancel')}>
            <X className="w-4 h-4" strokeWidth={1.8} />
          </button>
          <button type="button" onClick={confirmCreate} className="bg-plan text-card rounded-md px-2.5 py-1.5" title={t('rateBook.save')}>
            <Check className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>
      )}

      {selectedId && (
        <>
          <label className="mt-2.5 flex items-center gap-2 rounded-lg border border-line bg-paper px-2.5 py-1.5 focus-within:border-plan">
            <span className="text-[12px] text-soft whitespace-nowrap">{t('card.chargedLabel', { prefix: homePrefix })}</span>
            <input
              value={charged}
              onChange={(e) => onChargedChange(e.target.value)}
              inputMode="decimal"
              placeholder={t('card.chargedPlaceholder')}
              className="flex-1 min-w-0 bg-transparent text-right text-[15px] font-semibold tabular outline-none placeholder:text-faint placeholder:font-normal placeholder:text-[13px]"
            />
          </label>
          {derivedRate != null ? (
            <div className="text-[11px] text-positive mt-1.5 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 flex-shrink-0" strokeWidth={2.2} />
              {t('card.derivedRate', { rate: formatCardRate(derivedRate) })}
            </div>
          ) : estimateRate != null ? (
            <div className="text-[11px] text-muted mt-1.5 flex items-start gap-1">
              <Info className="w-3 h-3 flex-shrink-0 mt-[2px]" strokeWidth={2.2} />
              <span>{t('card.estimateHint', { rate: formatCardRate(estimateRate), prefix: homePrefix, amount: estimateHome.toFixed(2) })}</span>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
