import { describe, it, expect, afterEach } from 'vitest'
import * as XLSX from 'xlsx'
import { buildExcelFile, buildJsonFile, buildCsvFile } from './exportRenderers'
import type { ExportBundle } from './export'
import type { Trip } from '../types'
import i18n from '../lib/i18n'

const t = i18n.t.bind(i18n)

afterEach(() => {
  void i18n.changeLanguage('zh')
})

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  const now = Date.now()
  return {
    id: 't1', householdId: 'h1', name: '京都·大阪 家庭行', homeCurrency: 'MYR', startDate: '2026-09-02', endDate: '2026-09-06',
    status: 'active', publicShareScope: 'none', publicShareToken: null, publicShareTemplate: null, createdAt: now, updatedAt: now,
    ...overrides,
  }
}

function makeBundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  return {
    trip: makeTrip(),
    homeCurrency: 'MYR',
    rows: [
      { date: '2026-09-02', type: 'itinerary', title: '抵达关西机场', location: null, categoryName: null, amount: null, currency: null, homeAmount: null, payerName: null, note: null },
      { date: '2026-09-02', type: 'expense', title: '餐饮', location: null, categoryName: '餐饮', amount: 300, currency: 'MYR', homeAmount: 300, payerName: '爸爸', note: null },
    ],
    daySummary: [{ date: '2026-09-02', total: 300 }],
    categorySummary: [{ categoryName: '餐饮', total: 300 }],
    personSummary: [{ memberName: '爸爸', paid: 300, owed: 100, net: 200 }],
    ...overrides,
  }
}

describe('buildJsonFile', () => {
  it('导出内容字段完整，且金额与传入数据一致', async () => {
    const file = buildJsonFile(makeBundle(), t)
    expect(file.type).toBe('application/json')
    expect(file.name).toContain('京都·大阪 家庭行')

    const parsed = JSON.parse(await file.text())
    expect(parsed.trip.name).toBe('京都·大阪 家庭行')
    expect(parsed.items).toHaveLength(2)
    expect(parsed.summary.byPerson[0].net).toBe(200)
  })

  it('English模式下type字段也翻译成英文', async () => {
    await i18n.changeLanguage('en')
    const file = buildJsonFile(makeBundle(), t)
    const parsed = JSON.parse(await file.text())
    expect(parsed.items[0].type).toBe('Itinerary')
    expect(parsed.items[1].type).toBe('Expense')
  })
})

describe('buildCsvFile', () => {
  it('带BOM且表头与数据行数正确', async () => {
    const file = buildCsvFile(makeBundle(), t)
    // BOM检查要看原始字节——file.text()内部用TextDecoder解码，会按规范自动吞掉开头的UTF-8
    // BOM，所以只能从arrayBuffer里查前3个字节，不能指望.text()还留着它
    const bytes = new Uint8Array(await file.arrayBuffer())
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])

    const lines = (await file.text()).split('\n')
    expect(lines[0]).toBe('日期,类型,标题,地点,分类,金额,币种,折算(MYR),付款人,备注')
    expect(lines).toHaveLength(3) // 表头 + 2条数据
  })

  it('字段里带逗号时正确加引号转义', async () => {
    const bundle = makeBundle({
      rows: [
        { date: '2026-09-02', type: 'expense', title: '餐饮, 含小费', location: null, categoryName: '餐饮', amount: 50, currency: 'MYR', homeAmount: 50, payerName: '爸爸', note: null },
      ],
    })
    const file = buildCsvFile(bundle, t)
    const text = await file.text()
    expect(text).toContain('"餐饮, 含小费"')
  })

  it('English模式下表头翻译成英文，文件名后缀也跟着变', async () => {
    await i18n.changeLanguage('en')
    const file = buildCsvFile(makeBundle(), t)
    expect(file.name).toContain('TripJournal-export')
    const lines = (await file.text()).split('\n')
    expect(lines[0]).toBe('Date,Type,Title,Location,Category,Amount,Currency,Converted (MYR),Paid by,Note')
  })
})

describe('buildExcelFile', () => {
  it('生成的workbook含明细和汇总两个sheet，行数与数据一致', async () => {
    const file = buildExcelFile(makeBundle(), t)
    expect(file.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    expect(wb.SheetNames).toEqual(['明细', '汇总'])

    const detailRows = XLSX.utils.sheet_to_json(wb.Sheets['明细'])
    expect(detailRows).toHaveLength(2)

    const summaryRows = XLSX.utils.sheet_to_json(wb.Sheets['汇总'], { header: 1 })
    expect(summaryRows.flat()).toContain('按天汇总')
    expect(summaryRows.flat()).toContain('按分类汇总')
    expect(summaryRows.flat()).toContain('按人汇总')
  })

  it('English模式下sheet名字和汇总小标题都翻译成英文', async () => {
    await i18n.changeLanguage('en')
    const file = buildExcelFile(makeBundle(), t)
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    expect(wb.SheetNames).toEqual(['Details', 'Summary'])

    const summaryRows = XLSX.utils.sheet_to_json(wb.Sheets['Summary'], { header: 1 })
    expect(summaryRows.flat()).toContain('By day')
    expect(summaryRows.flat()).toContain('By category')
    expect(summaryRows.flat()).toContain('By person')
  })
})
