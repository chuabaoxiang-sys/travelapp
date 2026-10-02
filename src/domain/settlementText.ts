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

// 一键复制到群里的结算文案。"实际花费"=应分摊（owed），"垫付"=实际付出（paid），
// "还需付/应收回"用的是扣掉已结清之后的 net——跟结算页"结算建议"是同一份数字
export function buildSettlementText(input: SettlementTextInput, t: TFunction): string {
  const { tripName, currencySymbol, balances, transfers, settledCount, nameOf, appHost } = input
  const money = (n: number) => formatMoney(n, currencySymbol)
  const people = balances.filter((b) => b.paid > 0 || b.owed > 0).sort((a, b) => b.owed - a.owed)
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
    lines.push(t('split.copyText.personLine', { name: nameOf(b.memberId), owed: money(b.owed), paid: money(b.paid), status }))
  }

  lines.push('', t('split.copyText.footer', { host: appHost }))
  return lines.join('\n')
}
