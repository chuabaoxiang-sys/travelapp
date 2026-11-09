import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { X, Coins, CreditCard, ChevronRight, Plus } from 'lucide-react'
import { db } from '../../db/dexie'
import { BottomSheet } from '../../components/BottomSheet'
import { formatMoney } from '../../lib/money'
import { expenseCashbackForCard, listTripCashbacks } from '../../domain/cashback'
import { cardUsageForTrip, getPaymentCards, type CardTripUsage } from '../../domain/paymentCards'
import { useBackDismiss } from '../../hooks/useBackDismiss'
import { CashbackSheet } from './CashbackSheet'

// 「这趟返现」（2026-11-09）：黑卡展开后点「− Cashback」打开。列出这趟刷过的卡
// （和记过返现的卡），每张卡写整张卡返现、每笔返现合计；点卡打开汇率簿里同一个
// 卡返现页面（CashbackSheet），关掉回到这里。汇率簿 › 卡 的入口照旧
export function TripCashbackSheet({
  tripId,
  currentMemberId,
  onClose,
}: {
  tripId: string
  currentMemberId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const cards = useLiveQuery(() => getPaymentCards()) ?? []
  const usage = useLiveQuery(() => cardUsageForTrip(tripId), [tripId]) ?? new Map<string, CardTripUsage>()
  const records = useLiveQuery(() => listTripCashbacks(tripId), [tripId]) ?? []
  const expenses = (useLiveQuery(() => db.expenses.where('tripId').equals(tripId).toArray(), [tripId]) ?? []).filter((e) => !e.deletedAt)
  const members = useLiveQuery(() => db.members.toArray()) ?? []
  const nameOf = (id: string) => members.find((m) => m.id === id)?.displayName ?? '?'

  const [cardId, setCardId] = useState<string | null>(null)
  useBackDismiss(!!cardId, () => setCardId(null))

  const shownIds = new Set([...usage.keys(), ...records.map((r) => r.paymentCardId)])
  const rows = cards
    .filter((c) => shownIds.has(c.id))
    .map((c) => {
      const mine = records.filter((r) => r.paymentCardId === c.id)
      const cardLevel = mine.reduce((s, r) => s + r.amount, 0)
      const perExpense = expenseCashbackForCard(expenses, c.id)
      const owners = [...new Set(mine.map((r) => r.memberId))].map(nameOf)
      return { card: c, cardLevel, owners, perExpense, total: cardLevel + perExpense.total }
    })
  const total = rows.reduce((s, r) => s + r.total, 0)
  const selected = cardId ? cards.find((c) => c.id === cardId) : undefined

  return (
    <>
      <BottomSheet onClose={onClose} cardClassName="px-5 pt-3.5 pb-5 max-h-[90%] flex flex-col">
        <div className="w-[38px] h-1 rounded-full bg-handle mx-auto mb-2 flex-shrink-0" />
        <div className="flex items-center gap-2 flex-shrink-0">
          <Coins className="w-4 h-4 text-positive flex-shrink-0" strokeWidth={1.8} />
          <h2 className="font-serif-sc text-[15px] font-semibold flex-1 truncate">{t('tripCashback.title')}</h2>
          <span className="text-[15px] font-semibold text-positive tabular">{formatMoney(total)}</span>
          <button onClick={onClose} className="w-8 h-8 -mr-1.5 flex items-center justify-center text-muted" title={t('activity.close')} aria-label={t('activity.close')}>
            <X className="w-[18px] h-[18px]" strokeWidth={1.8} />
          </button>
        </div>
        <p className="text-[11px] text-muted mt-0.5 flex-shrink-0">{t('tripCashback.hint')}</p>

        <div className="overflow-y-auto no-scrollbar flex-1 min-h-0 flex flex-col gap-2 mt-3">
          {rows.length === 0 && <p className="text-[12.5px] text-muted py-4 text-center">{t('tripCashback.empty')}</p>}
          {rows.map(({ card, cardLevel, owners, perExpense, total: cardTotal }) => (
            <button
              key={card.id}
              type="button"
              onClick={() => setCardId(card.id)}
              className="flex items-center gap-2.5 bg-card border border-line rounded-2xl px-3 py-2.5 text-left"
            >
              <CreditCard className="w-4 h-4 text-soft flex-shrink-0" strokeWidth={1.8} />
              <span className="flex-1 min-w-0">
                <span className="block text-[13.5px] font-medium truncate">{card.name}</span>
                {cardTotal > 0 ? (
                  <span className="block text-[11px] text-muted leading-[1.5]">
                    {cardLevel > 0 && (
                      <span className="block">{t('tripCashback.cardLevel', { amount: formatMoney(cardLevel), names: owners.join('、') })}</span>
                    )}
                    {perExpense.count > 0 && (
                      <span className="block">{t('tripCashback.perExpense', { amount: formatMoney(perExpense.total), count: perExpense.count })}</span>
                    )}
                  </span>
                ) : (
                  <span className="block text-[11px] text-muted">{t('tripCashback.none')}</span>
                )}
              </span>
              {cardTotal > 0 ? (
                <>
                  <span className="text-[14px] font-semibold text-positive tabular">{formatMoney(cardTotal)}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-muted flex-shrink-0" strokeWidth={2} />
                </>
              ) : (
                <span className="flex items-center gap-1 text-[12px] text-plan flex-shrink-0">
                  <Plus className="w-3.5 h-3.5" strokeWidth={1.8} />
                  {t('tripCashback.add')}
                </span>
              )}
            </button>
          ))}
        </div>
      </BottomSheet>

      {selected && (
        <CashbackSheet tripId={tripId} card={selected} currentMemberId={currentMemberId} onClose={() => setCardId(null)} />
      )}
    </>
  )
}
