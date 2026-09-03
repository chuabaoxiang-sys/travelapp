import * as XLSX from 'xlsx'
import type { TFunction } from 'i18next'
import type { ExportBundle } from './export'

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

function typeLabel(type: 'itinerary' | 'expense', t: TFunction) {
  return type === 'itinerary' ? t('export.typeItinerary') : t('export.typeExpense')
}

export function buildExcelFile(bundle: ExportBundle, t: TFunction): File {
  const wb = XLSX.utils.book_new()

  const detailData = bundle.rows.map((r) => ({
    [t('export.colDate')]: r.date,
    [t('export.colType')]: typeLabel(r.type, t),
    [t('export.colTitle')]: r.title,
    [t('export.colLocation')]: r.location ?? '',
    [t('export.colCategory')]: r.categoryName ?? '',
    [t('export.colAmount')]: r.amount ?? '',
    [t('export.colCurrency')]: r.currency ?? '',
    [t('export.colConverted', { currency: bundle.homeCurrency })]: r.homeAmount ?? '',
    [t('export.colPayer')]: r.payerName ?? '',
    [t('export.colNote')]: r.note ?? '',
  }))
  const detailSheet = XLSX.utils.json_to_sheet(detailData)
  XLSX.utils.book_append_sheet(wb, detailSheet, t('export.sheetDetail'))

  const summaryRows: (string | number)[][] = [
    [t('export.byDay')],
    [t('export.colDate'), t('export.colConverted', { currency: bundle.homeCurrency })],
    ...bundle.daySummary.map((d) => [d.date, d.total]),
    [],
    [t('export.byCategory')],
    [t('export.colCategory'), t('export.colConverted', { currency: bundle.homeCurrency })],
    ...bundle.categorySummary.map((c) => [c.categoryName, c.total]),
    [],
    [t('export.byPerson')],
    [t('export.colName'), t('export.colPaid'), t('export.colShare'), t('export.colNet')],
    ...bundle.personSummary.map((p) => [p.memberName, p.paid, p.owed, p.net]),
  ]
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows)
  XLSX.utils.book_append_sheet(wb, summarySheet, t('export.sheetSummary'))

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new File([wbout], `${safeFileName(bundle.trip.name)}-${t('export.fileNameSuffix')}.xlsx`, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function buildJsonFile(bundle: ExportBundle, t: TFunction): File {
  const payload = {
    trip: {
      name: bundle.trip.name,
      homeCurrency: bundle.homeCurrency,
      startDate: bundle.trip.startDate,
      endDate: bundle.trip.endDate,
    },
    items: bundle.rows.map((r) => ({ ...r, type: typeLabel(r.type, t) })),
    summary: {
      byDay: bundle.daySummary,
      byCategory: bundle.categorySummary,
      byPerson: bundle.personSummary,
    },
  }
  const text = JSON.stringify(payload, null, 2)
  return new File([text], `${safeFileName(bundle.trip.name)}-${t('export.fileNameSuffix')}.json`, { type: 'application/json' })
}

function csvEscape(v: unknown) {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildCsvFile(bundle: ExportBundle, t: TFunction): File {
  const headers = [
    t('export.colDate'), t('export.colType'), t('export.colTitle'), t('export.colLocation'), t('export.colCategory'),
    t('export.colAmount'), t('export.colCurrency'), t('export.colConverted', { currency: bundle.homeCurrency }),
    t('export.colPayer'), t('export.colNote'),
  ]
  const lines = [headers.join(',')]
  for (const r of bundle.rows) {
    lines.push(
      [r.date, typeLabel(r.type, t), r.title, r.location ?? '', r.categoryName ?? '', r.amount ?? '', r.currency ?? '', r.homeAmount ?? '', r.payerName ?? '', r.note ?? '']
        .map(csvEscape)
        .join(','),
    )
  }
  // 开头加 BOM，不然中文在 Excel 里打开 CSV 会乱码
  const text = '﻿' + lines.join('\n')
  return new File([text], `${safeFileName(bundle.trip.name)}-${t('export.fileNameSuffix')}.csv`, { type: 'text/csv;charset=utf-8' })
}
