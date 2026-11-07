import { useTranslation } from 'react-i18next'
import { X, ChevronRight } from 'lucide-react'
import { BottomSheet } from '../../components/BottomSheet'
import { formatMoney, round2 } from '../../lib/money'
import type { ProxyGainGroup } from '../../domain/proxies'

// 「代购多收」明细（2026-11-08）：「我的」黑卡上点「− 代购多收 RMxx」弹出来。
// 每笔账一张小卡，列出每个代购的人的 原价 / 要还 / 实际花 / 多收；点卡片打开那笔账，
// 方便发现"这笔其实是按折后价收的"然后去代购页改成「分给代购的人」
export function ProxyGainSheet({
  groups,
  currencyLabel,
  titleOf,
  onOpenExpense,
  onClose,
}: {
  groups: ProxyGainGroup[]
  currencyLabel: string
  titleOf: (expenseId: string) => string
  onOpenExpense: (expenseId: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const total = round2(groups.reduce((s, g) => s + g.total, 0))
  const receivable = round2(groups.reduce((s, g) => s + g.rows.reduce((a, r) => a + r.receivable, 0), 0))
  const cost = round2(groups.reduce((s, g) => s + g.rows.reduce((a, r) => a + r.cost, 0), 0))
  const num = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const foreign = (currency: string, n: number) => `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`

  return (
    <BottomSheet onClose={onClose} cardClassName="px-5 pt-3.5 pb-5 max-h-[90%] flex flex-col">
      <div className="w-[38px] h-1 rounded-full bg-handle mx-auto mb-2 flex-shrink-0" />
      <div className="flex items-center justify-between flex-shrink-0">
        <h2 className="font-serif-sc text-[15px] font-semibold">{t(total >= 0 ? 'proxyGain.title' : 'proxyGain.titleLoss', { amount: formatMoney(Math.abs(total), currencyLabel) })}</h2>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-muted" title={t('activity.close')} aria-label={t('activity.close')}>
          <X className="w-[18px] h-[18px]" strokeWidth={1.8} />
        </button>
      </div>
      <div className="text-[12px] text-soft leading-relaxed mt-1 flex-shrink-0">{t('proxyGain.intro')}</div>

      <div className="overflow-y-auto no-scrollbar flex-1 min-h-0 flex flex-col gap-2 mt-2.5">
        {groups.map((g) => (
          <button
            key={g.expenseId}
            type="button"
            onClick={() => onOpenExpense(g.expenseId)}
            className="bg-card border border-line rounded-2xl px-3 py-2.5 text-left flex flex-col gap-1.5"
          >
            <span className="flex items-baseline gap-1.5 w-full">
              <span className="text-[13px] font-semibold flex-1 min-w-0 truncate">{titleOf(g.expenseId)}</span>
              <span className="text-[11px] text-muted flex-shrink-0">{g.expenseDate.slice(5).replace('-', '/')}</span>
              <span className={`text-[13px] font-semibold tabular flex-shrink-0 ${g.total >= 0 ? 'text-positive' : 'text-negative'}`}>{g.total >= 0 ? '+' : '−'}{formatMoney(Math.abs(g.total), currencyLabel)}</span>
              <ChevronRight className="w-3.5 h-3.5 text-muted flex-shrink-0 self-center" strokeWidth={2} />
            </span>
            <span className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-2.5 gap-y-[3px] w-full text-[11.5px] tabular text-soft">
              <span className="text-[10.5px] text-muted">{t('proxyGain.colWho')}</span>
              <span className="text-[10.5px] text-muted text-right">{t('proxyGain.colOwes')}</span>
              <span className="text-[10.5px] text-muted text-right">{t('proxyGain.colCost')}</span>
              <span className="text-[10.5px] text-muted text-right">{t('proxyGain.colGain')}</span>
              {g.rows.map((r) => (
                <span key={r.name} className="contents">
                  <span className="truncate">{r.name} · {foreign(g.currency, r.amount)}</span>
                  <span className="text-right">{num(r.receivable)}</span>
                  <span className="text-right">{num(r.cost)}</span>
                  <span className={`text-right ${r.gain >= 0 ? 'text-positive' : 'text-negative'}`}>{r.gain >= 0 ? '' : '−'}{num(Math.abs(r.gain))}</span>
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>

      <div className="flex justify-between gap-2 border-t border-line pt-2.5 mt-2.5 text-[12.5px] tabular flex-shrink-0">
        <span className="text-muted">{t('proxyGain.footer', { owes: num(receivable), cost: num(cost) })}</span>
        <span className={`font-bold ${total >= 0 ? 'text-positive' : 'text-negative'}`}>= {total < 0 ? '−' : ''}{formatMoney(Math.abs(total), currencyLabel)}</span>
      </div>
      <div className="text-[11px] text-muted leading-relaxed mt-1.5 flex-shrink-0">{t('proxyGain.hint')}</div>
    </BottomSheet>
  )
}
