import type { TFunction } from 'i18next'
import type { PersonBalance, Transfer } from './splits'
import { formatMoney } from '../lib/money'

// 跟 simplifyDebts 用同一个阈值：差额不到0.5的算两清，不然文案里会出现"还需付 RM0.20"
// 这种结算建议里根本没有的转账
const EVEN_THRESHOLD = 0.5

export interface SettlementTextInput {
  tripName: string
  currencySymbol: string
  balances: PersonBalance[]
  transfers: Transfer[]
  settledCount: number
  nameOf: (memberId: string) => string
  appHost: string
}

// 一键复制到群里的结算文案。"旅伴花费"=大家应分摊的合计（已花 − 代购），每人一行
// "应分摊"（owed），下面一行写成加减得通的式子（2026-11-08 用户定的）：
//   垫付（另垫了代购）· 已付/已收（结算记录）· 代收退税 · 分到退税 → 应收回/还需付
// 即 paid − owed + 已付 − 已收 − 代收退税 + 分到退税 = net，没有的项不写。
// 不写各人自己的 Cashback / 代购多收（那是各人的事，不发到群里）
export function buildSettlementText(input: SettlementTextInput, t: TFunction): string {
  const { tripName, currencySymbol, balances, transfers, settledCount, nameOf, appHost } = input
  const money = (n: number) => formatMoney(n, currencySymbol)
  const people = balances
    .filter((b) => b.paid > 0 || b.owed > 0 || (b.refundShare ?? 0) > 0 || (b.refundHeld ?? 0) > 0)
    .sort((a, b) => b.owed - a.owed)
  const total = people.reduce((sum, b) => sum + b.owed, 0)

  const lines: string[] = [
    t('split.copyText.title', { trip: tripName }),
    t('split.copyText.summary', { total: money(total), count: people.length }),
    '',
  ]

  if (transfers.length > 0) {
    lines.push(t('split.copyText.transfersHeading'))
    for (const tr of transfers) {
      lines.push(t('split.copyText.transferLine', { from: nameOf(tr.from), to: nameOf(tr.to), amount: money(tr.amount) }))
    }
    lines.push(t('split.copyText.transfersFooter', { count: transfers.length }))
    if (settledCount > 0) lines.push(t('split.copyText.alreadySettled', { count: settledCount }))
  } else {
    lines.push(t('split.copyText.allSettled'))
  }

  lines.push('', t('split.copyText.detailsHeading'))
  for (const b of people) {
    const status =
      b.net > EVEN_THRESHOLD
        ? t('split.copyText.statusReceive', { amount: money(b.net) })
        : b.net < -EVEN_THRESHOLD
          ? t('split.copyText.statusPay', { amount: money(-b.net) })
          : t('split.copyText.statusEven')
    const parts = [
      t('split.copyText.partPaid', { amount: money(b.paid) }) +
        ((b.proxyFronted ?? 0) > 0 ? t('split.copyText.partProxy', { amount: money(b.proxyFronted!) }) : ''),
      b.settledOut > 0 ? t('split.copyText.partSettledOut', { amount: money(b.settledOut) }) : null,
      b.settledIn > 0 ? t('split.copyText.partSettledIn', { amount: money(b.settledIn) }) : null,
      (b.refundHeld ?? 0) > 0 ? t('split.copyText.partRefundHeld', { amount: money(b.refundHeld!) }) : null,
      (b.refundShare ?? 0) > 0 ? t('split.copyText.partRefundShare', { amount: money(b.refundShare!) }) : null,
    ].filter(Boolean)
    lines.push(t('split.copyText.personLine', { name: nameOf(b.memberId), owed: money(b.owed) }))
    lines.push(t('split.copyText.personDetail', { parts: parts.join(' · '), status }))
  }

  lines.push('', t('split.copyText.footer', { host: appHost }))
  return lines.join('\n')
}
