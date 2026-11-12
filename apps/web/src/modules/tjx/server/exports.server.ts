/**
 * Parts-on-approval workbook: a summary sheet plus one sheet per province.
 *
 * SERVER ONLY. The workbook is generated on demand and never persisted. Only
 * quotes in status 3 (Waiting for Approval) and the enumerated TJX part family
 * contribute rows.
 */
import { eq } from 'drizzle-orm'
import type { Row, Worksheet } from 'exceljs'
import type { Executor } from '@cls/db'
import { sites, tjxQuoteParts, tjxQuotes } from '@cls/db/schema'
import { add, format, parseDecimal, type Decimal } from '@cls/pricing'
import type { AuthSessionView } from '../../../server/auth.types'
import { assertTjxRead, auditTjx } from './access.server'
import { isTjxPartNo, normalizeTjxPartNo } from '../lib/part-family'

interface ExportRow {
  partNo: string
  quoteType: string
  quantity: Decimal
  quantityWithoutMarkup: Decimal
}

const ZERO = (): Decimal => ({ value: 0n, scale: 3 })

function addTo(map: Map<string, ExportRow>, row: ExportRow): void {
  const key = `${row.partNo}|${row.quoteType}`
  const existing = map.get(key)
  if (!existing) {
    map.set(key, { ...row })
    return
  }
  existing.quantity = add(existing.quantity, row.quantity)
  existing.quantityWithoutMarkup = add(existing.quantityWithoutMarkup, row.quantityWithoutMarkup)
}

function rowsFor(map: Map<string, ExportRow>): ExportRow[] {
  return [...map.values()].sort(
    (left, right) =>
      left.partNo.localeCompare(right.partNo) || left.quoteType.localeCompare(right.quoteType),
  )
}

function styleHeader(row: Row): void {
  row.font = { bold: true }
  row.commit()
}

function writeSheet(worksheet: Worksheet, rows: ExportRow[]): void {
  worksheet.columns = [
    { header: 'Part Number', key: 'partNo', width: 16 },
    { header: 'Quote Type', key: 'quoteType', width: 12 },
    { header: 'Quantity', key: 'quantity', width: 12 },
    { header: 'Quantity with No Markup', key: 'quantityWithoutMarkup', width: 24 },
  ]
  styleHeader(worksheet.getRow(1))
  for (const row of rows) {
    const added = worksheet.addRow({
      partNo: row.partNo,
      quoteType: row.quoteType,
      quantity: Number(format(row.quantity, 3)),
      quantityWithoutMarkup: Number(format(row.quantityWithoutMarkup, 3)),
    })
    added.getCell(1).numFmt = '@'
    added.getCell(2).numFmt = '@'
    added.getCell(3).numFmt = '0.000'
    added.getCell(4).numFmt = '0.000'
  }
  for (const column of worksheet.columns) {
    const values = column.values ?? []
    const longest = Math.max(
      ...values.map((value) => String(value ?? '').length),
      String(column.header ?? '').length,
    )
    column.width = Math.min(40, Math.max(12, longest + 2))
  }
}

export async function exportPartsOnApprovalCore(
  executor: Executor,
  session: AuthSessionView,
): Promise<{ filename: string; base64: string }> {
  assertTjxRead(session)
  const rows = await executor
    .select({
      partNo: tjxQuoteParts.partNo,
      quoteType: tjxQuotes.quoteType,
      withMarkup: tjxQuoteParts.qtyWithMarkup,
      withoutMarkup: tjxQuoteParts.qtyWithoutMarkup,
      shipProvince: tjxQuotes.shipProvince,
      taxProvince: tjxQuotes.taxProvince,
      siteProvince: sites.province,
    })
    .from(tjxQuoteParts)
    .innerJoin(tjxQuotes, eq(tjxQuoteParts.quoteId, tjxQuotes.id))
    .leftJoin(sites, eq(tjxQuotes.siteId, sites.id))
    .where(eq(tjxQuotes.status, 3))

  const summary = new Map<string, ExportRow>()
  const provinces = new Map<string, Map<string, ExportRow>>()
  const foundProvinces = new Set<string>()

  for (const row of rows) {
    const partNo = normalizeTjxPartNo(row.partNo)
    if (!isTjxPartNo(partNo)) continue
    const quantity = parseDecimal(row.withMarkup) ?? ZERO()
    const quantityWithoutMarkup = parseDecimal(row.withoutMarkup) ?? ZERO()
    if (quantity.value <= 0n && quantityWithoutMarkup.value <= 0n) continue
    const province =
      (row.shipProvince ?? row.taxProvince ?? row.siteProvince ?? 'ON').trim().toUpperCase() || 'ON'
    foundProvinces.add(province)
    const mapped = { partNo, quoteType: row.quoteType, quantity, quantityWithoutMarkup }
    addTo(summary, mapped)
    const sheet = provinces.get(province) ?? new Map<string, ExportRow>()
    addTo(sheet, mapped)
    provinces.set(province, sheet)
  }

  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'CLS Green System'
  workbook.created = new Date()
  writeSheet(workbook.addWorksheet('Waiting for Approval Parts'), rowsFor(summary))
  for (const province of [...foundProvinces].sort()) {
    writeSheet(
      workbook.addWorksheet(`Waiting for Approval Parts - ${province}`.slice(0, 31)),
      rowsFor(provinces.get(province) ?? new Map()),
    )
  }

  const filename = `tjx-parts-on-approval-status-3-${new Date().toISOString().slice(0, 10)}.xlsx`
  const buffer = await workbook.xlsx.writeBuffer()
  const base64 = Buffer.from(buffer).toString('base64')
  await auditTjx(executor, session, 'tjx.parts_on_approval.exported', 'tjx_export', filename, {
    summary: `Exported parts on approval (${summary.size} grouped lines, ${foundProvinces.size} provinces).`,
    after: { filename, groups: summary.size, provinces: [...foundProvinces].sort() },
  })
  return { filename, base64 }
}
