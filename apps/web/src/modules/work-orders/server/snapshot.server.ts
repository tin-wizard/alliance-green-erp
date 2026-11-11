/**
 * Invoice-ready snapshot.
 *
 * SERVER ONLY. This is the contract the Invoicing module consumes: line inputs,
 * tax inputs, `calc_type` and totals computed by the shared `@cls/pricing`
 * calculator. Work Orders does not issue an invoice and does not post to Sage.
 *
 * Money is withheld server-side — not merely hidden — unless the actor holds
 * `invoice.calculate`. The snapshot is read-only; the Invoicing module remains
 * the authority that creates an invoice from it.
 */
import { eq } from 'drizzle-orm'
import { getDb, type Db } from '@cls/db'
import {
  workOrderHours,
  workOrderParts,
  workOrderSpecialParts,
  workOrderTax,
} from '@cls/db/schema'
import {
  calculateSalesInvoice,
  format,
  multiply,
  parseDecimal,
  round,
  resolveLocalTaxProvince,
} from '@cls/pricing'
import type { AuthSessionView } from '../../../server/auth.types'
import type {
  InvoiceReadySnapshot,
  WorkOrderStatusCode,
} from '../types'
import { calcTypeFor, invoiceImmutable } from '../lib/rules'
import { getSite } from '../lib/lookups'
import { canCalculateInvoice, loadAccessibleWorkOrder } from './access.server'

function amount(left: string, right: string): string {
  const a = parseDecimal(left)
  const b = parseDecimal(right)
  if (!a || !b) return '0.00'
  return format(round(multiply(a, b), 2), 2)
}

export async function buildInvoiceReadySnapshot(
  session: AuthSessionView,
  workOrderId: number,
  executor?: Db,
): Promise<InvoiceReadySnapshot> {
  const row = await loadAccessibleWorkOrder(session, workOrderId, executor)
  const db = executor ?? getDb()

  const [hours, parts, specialParts, taxRows] = await Promise.all([
    db.select().from(workOrderHours).where(eq(workOrderHours.workOrderId, workOrderId)),
    db.select().from(workOrderParts).where(eq(workOrderParts.workOrderId, workOrderId)),
    db
      .select()
      .from(workOrderSpecialParts)
      .where(eq(workOrderSpecialParts.workOrderId, workOrderId)),
    db.select().from(workOrderTax).where(eq(workOrderTax.workOrderId, workOrderId)).limit(1),
  ])

  const tax = taxRows[0]
  const calcType = calcTypeFor({ isLocal: row.isLocal, isProject: row.isProject })
  const province =
    row.isLocal && !row.isProject
      ? resolveLocalTaxProvince('local', tax?.taxProvince ?? 'ON')
      : (tax?.taxProvince ?? 'ON')

  const labour = hours
    .sort((a, b) => (a.lineDate < b.lineDate ? -1 : a.lineDate > b.lineDate ? 1 : a.id - b.id))
    .map((line) => ({
      date: line.lineDate,
      hours: line.hours,
      rateCode: line.rateCode,
      hourlyRate: line.hourlyRate,
      amount: amount(line.hours, line.hourlyRate),
    }))
  const partLines = parts.map((line) => ({
    partNo: line.partNo,
    description: line.description,
    qty: line.qty,
    price: line.price,
    amount: amount(line.qty, line.price),
  }))
  const specialPartLines = specialParts.map((line) => ({
    name: line.name,
    qty: line.qty,
    price: line.price,
    amount: amount(line.qty, line.price),
  }))

  const allowed = canCalculateInvoice(session)
  let totals: InvoiceReadySnapshot['totals'] = null
  let calculationError: string | null = null
  let legacyCentCorrectionApplied = false

  if (allowed) {
    try {
      const result = calculateSalesInvoice({
        taxProvince: province,
        appliedTaxRate: tax?.appliedTaxRate,
        workOrderId,
        labour: labour.map((line) => ({ hours: line.hours, rate: line.hourlyRate })),
        parts: partLines.map((line) => ({ partNo: line.partNo, qty: line.qty, price: line.price })),
        specialParts: specialPartLines.map((line) => ({
          name: line.name,
          qty: line.qty,
          price: line.price,
        })),
        manualTaxAmount: tax?.manualTaxAmount,
        manualSubtotalAmount: tax?.manualSubtotalAmount,
      })
      totals = {
        labour: result.labour,
        material: result.material,
        subtotal: result.subtotal,
        tax: result.tax,
        total: result.total,
      }
      legacyCentCorrectionApplied = result.legacyCentCorrectionApplied
    } catch (error) {
      calculationError = error instanceof Error ? error.message : 'The invoice could not be calculated.'
    }
  }

  const site = await getSite(row.siteId, db)

  return {
    workOrderId: row.id,
    workOrderNumber: row.id,
    series: row.series === 2 ? 2 : 1,
    calcType,
    customerId: site?.customerId ?? null,
    siteId: row.siteId,
    customerPo: row.customerPo,
    workOrderDate: row.dateTaken,
    completionDate: row.completedAt ? row.completedAt.toISOString().slice(0, 10) : null,
    taxProvince: province,
    appliedTaxRate: tax?.appliedTaxRate ?? null,
    appliedTaxRatePst: tax?.appliedTaxRatePst ?? null,
    manualTaxAmount: tax?.manualTaxAmount ?? null,
    manualSubtotalAmount: tax?.manualSubtotalAmount ?? null,
    labour,
    parts: partLines,
    specialParts: specialPartLines,
    totals,
    totalsWithheldReason: allowed ? null : 'invoice.calculate',
    calculationError,
    legacyCentCorrectionApplied,
    immutable: invoiceImmutable(row),
    generatedAt: new Date().toISOString(),
  }
}

/** Exposed for the UI's "ready to invoice" badge; checked on the server. */
export function isInvoiceReadyStatus(status: WorkOrderStatusCode): boolean {
  return status === 2 || status === 4
}
