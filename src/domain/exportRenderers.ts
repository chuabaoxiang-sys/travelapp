import * as XLSX from 'xlsx'
import type { ExportBundle } from './export'

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

export function buildExcelFile(bundle: ExportBundle): File {
  const wb = XLSX.utils.book_new()

  const detailData = bundle.rows.map((r) => ({
    日期: r.date,
    类型: r.type,
    标题: r.title,
    地点: r.location ?? '',
    分类: r.categoryName ?? '',
    金额: r.amount ?? '',
    币种: r.currency ?? '',
    [`折算(${bundle.homeCurrency})`]: r.homeAmount ?? '',
    付款人: r.payerName ?? '',
    备注: r.note ?? '',
  }))
  const detailSheet = XLSX.utils.json_to_sheet(detailData)
  XLSX.utils.book_append_sheet(wb, detailSheet, '明细')

  const summaryRows: (string | number)[][] = [
    ['按天汇总'],
    ['日期', `金额(${bundle.homeCurrency})`],
    ...bundle.daySummary.map((d) => [d.date, d.total]),
    [],
    ['按分类汇总'],
    ['分类', `金额(${bundle.homeCurrency})`],
    ...bundle.categorySummary.map((c) => [c.categoryName, c.total]),
    [],
    ['按人汇总'],
    ['姓名', '垫付', '应分摊', '净额（正=应收，负=应付）'],
    ...bundle.personSummary.map((p) => [p.memberName, p.paid, p.owed, p.net]),
  ]
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows)
  XLSX.utils.book_append_sheet(wb, summarySheet, '汇总')

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new File([wbout], `${safeFileName(bundle.trip.name)}-旅记导出.xlsx`, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function buildJsonFile(bundle: ExportBundle): File {
  const payload = {
    trip: {
      name: bundle.trip.name,
      homeCurrency: bundle.homeCurrency,
      startDate: bundle.trip.startDate,
      endDate: bundle.trip.endDate,
    },
    items: bundle.rows,
    summary: {
      byDay: bundle.daySummary,
      byCategory: bundle.categorySummary,
      byPerson: bundle.personSummary,
    },
  }
  const text = JSON.stringify(payload, null, 2)
  return new File([text], `${safeFileName(bundle.trip.name)}-旅记导出.json`, { type: 'application/json' })
}

function csvEscape(v: unknown) {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildCsvFile(bundle: ExportBundle): File {
  const headers = ['日期', '类型', '标题', '地点', '分类', '金额', '币种', `折算(${bundle.homeCurrency})`, '付款人', '备注']
  const lines = [headers.join(',')]
  for (const r of bundle.rows) {
    lines.push(
      [r.date, r.type, r.title, r.location ?? '', r.categoryName ?? '', r.amount ?? '', r.currency ?? '', r.homeAmount ?? '', r.payerName ?? '', r.note ?? '']
        .map(csvEscape)
        .join(','),
    )
  }
  // 开头加 BOM，不然中文在 Excel 里打开 CSV 会乱码
  const text = '﻿' + lines.join('\n')
  return new File([text], `${safeFileName(bundle.trip.name)}-旅记导出.csv`, { type: 'text/csv;charset=utf-8' })
}
