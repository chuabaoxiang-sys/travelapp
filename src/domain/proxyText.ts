import type { TFunction } from 'i18next'
import { formatMoney } from '../lib/money'
import type { ProxyGroup, ProxyItem } from './proxies'

// 代购明细（2026-11-08）：三组（还没还 / 已还 / 送的）每个人都能展开看每一笔、
// 一键复制一段能直接发给对方的文字。合计一行写外币合计、本位币合计和平均汇率
// （每张收据刷卡汇率略有不同，所以是 本位币合计 ÷ 外币合计）；跨几种外币时不写汇率

export type ProxyGroupKind = 'unpaid' | 'repaid' | 'gifted'

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function md(date: string) {
  return date.slice(5).replace('-', '/')
}

// 每一笔在这一组里算多少本位币：送的算成本（大家实际出的钱），其余算该还的
export function proxyItemHome(it: ProxyItem, kind: ProxyGroupKind): number {
  return kind === 'gifted' ? it.costAmount : it.shareAmount
}

export interface ProxyGroupTotals {
  foreign: { currency: string; amount: number }[] // 按出现顺序，不含本位币
  home: number
  avgRate: number | null // 只有一种外币时才有
}

export function proxyGroupTotals(items: ProxyItem[], kind: ProxyGroupKind, homeCurrency: string): ProxyGroupTotals {
  const foreign = new Map<string, number>()
  let home = 0
  let foreignHome = 0 // 外币那几笔折成的本位币，用来算平均汇率
  for (const it of items) {
    const h = proxyItemHome(it, kind)
    home += h
    if (it.currency !== homeCurrency) {
      foreign.set(it.currency, round2((foreign.get(it.currency) ?? 0) + it.amount))
      foreignHome += h
    }
  }
  const list = [...foreign.entries()].map(([currency, amount]) => ({ currency, amount }))
  const onlyForeign = list.length === 1 && list[0].amount > 0 && items.every((it) => it.currency !== homeCurrency)
  return {
    foreign: list,
    home: round2(home),
    avgRate: onlyForeign ? Number((foreignHome / list[0].amount).toPrecision(4)) : null,
  }
}

export function formatForeignTotals(totals: ProxyGroupTotals): string {
  return totals.foreign.map((f) => `${f.currency} ${f.amount.toLocaleString()}`).join(' + ')
}

// 名字两边是拉丁字母时补个空格（「帮 Chi Hui 代购」），中文名不补（「帮妈妈代购」）
function spaced(name: string) {
  return `${/^[A-Za-z0-9]/.test(name) ? ' ' : ''}${name}${/[A-Za-z0-9]$/.test(name) ? ' ' : ''}`
}

export interface ProxyCopyInput {
  group: ProxyGroup
  kind: ProxyGroupKind
  tripName: string
  homeCurrency: string
  payerName: string // 钱还给谁
  giftNames: string // 送的那组：谁一起送的
}

export function buildProxyCopyText(input: ProxyCopyInput, t: TFunction): string {
  const { group, kind, tripName, homeCurrency, payerName, giftNames } = input
  const homePrefix = homeCurrency === 'MYR' ? 'RM' : homeCurrency
  const money = (n: number) => formatMoney(n, homePrefix)
  const lines = [t('split.proxy.copyText.title', { name: group.name, nameSpaced: spaced(group.name), trip: tripName })]

  for (const it of group.items) {
    const base = `${md(it.expenseDate)} ${it.description || t('split.untitledExpense')}`
    if (it.currency === homeCurrency) {
      lines.push(kind === 'gifted' ? `${base} · ${money(it.amount)}` : `${base} · ${money(proxyItemHome(it, kind))}`)
    } else {
      const foreign = `${it.currency} ${it.amount.toLocaleString()}`
      lines.push(kind === 'gifted' ? `${base} · ${foreign}` : `${base} · ${foreign} → ${money(proxyItemHome(it, kind))}`)
    }
  }

  const totals = proxyGroupTotals(group.items, kind, homeCurrency)
  const foreignText = formatForeignTotals(totals)
  if (kind === 'gifted') {
    lines.push(t('split.proxy.copyText.totalGift', { foreign: foreignText || money(totals.home) }))
    lines.push(t('split.proxy.copyText.statusGift', { names: giftNames }))
  } else {
    if (!foreignText) lines.push(t('split.proxy.copyText.totalHome', { home: money(totals.home) }))
    else if (totals.avgRate != null) lines.push(t('split.proxy.copyText.totalWithRate', { foreign: foreignText, home: money(totals.home), rate: totals.avgRate }))
    else lines.push(t('split.proxy.copyText.total', { foreign: foreignText, home: money(totals.home) }))
    if (kind === 'unpaid') {
      lines.push(t('split.proxy.copyText.statusUnpaid', { name: payerName }))
    } else {
      const date = group.repaidAt ? md(new Date(group.repaidAt).toLocaleDateString('sv-SE')) : ''
      lines.push(t('split.proxy.copyText.statusRepaid', { date, amount: money(round2(group.total)) }))
    }
  }
  return lines.join('\n')
}
