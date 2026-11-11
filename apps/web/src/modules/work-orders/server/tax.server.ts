/**
 * Working tax recalculation after a capture or edit.
 *
 * SERVER ONLY. Totals are computed by the shared `@cls/pricing` calculator —
 * never by the browser and never by a second implementation. The result is a
 * preview stored on `work_order_tax`; the invoice snapshot recomputes from the
 * same lines when the Invoicing module asks.
 */
import { eq } from 'drizzle-orm'
import {
  workOrderHours,
  workOrderParts,
  workOrderSpecialParts,
  workOrderTax,
  workOrders,
} from '@cls/db/schema'
import type { Tx } from '@cls/db'
import {
  calculateSalesInvoice,
  type SalesInvoiceTotals,
} from '@cls/pricing'
import { resolveLocalTaxProvince } from '@cls/pricing'

export async function recalculateWorkOrderTax(
  tx: Tx,
  workOrderId: number,
): Promise<SalesInvoiceTotals | null> {
  const [workOrder] = await tx.select().from(workOrders).where(eq(workOrders.id, workOrderId))
  if (!workOrder) return null

  const [hours, parts, specialParts, taxRows] = await Promise.all([
    tx.select().from(workOrderHours).where(eq(workOrderHours.workOrderId, workOrderId)),
    tx.select().from(workOrderParts).where(eq(workOrderParts.workOrderId, workOrderId)),
    tx
      .select()
      .from(workOrderSpecialParts)
      .where(eq(workOrderSpecialParts.workOrderId, workOrderId)),
    tx.select().from(workOrderTax).where(eq(workOrderTax.workOrderId, workOrderId)).limit(1),
  ])

  const tax = taxRows[0]
  if (!tax) return null
  // Labour is mandatory (A7). Nothing to total until at least one line exists.
  if (hours.length === 0) return null

  const province =
    workOrder.isLocal && !workOrder.isProject
      ? resolveLocalTaxProvince('local', tax.taxProvince)
      : tax.taxProvince

  const totals = calculateSalesInvoice({
    taxProvince: province,
    appliedTaxRate: tax.appliedTaxRate,
    workOrderId,
    labour: hours.map((line) => ({
      date: line.lineDate,
      hours: line.hours,
      rate: line.hourlyRate,
    })),
    parts: parts.map((line) => ({
      partNo: line.partNo,
      qty: line.qty,
      price: line.price,
    })),
    specialParts: specialParts.map((line) => ({
      name: line.name,
      qty: line.qty,
      price: line.price,
    })),
    manualTaxAmount: tax.manualTaxAmount,
    manualSubtotalAmount: tax.manualSubtotalAmount,
  })

  await tx
    .update(workOrderTax)
    .set({
      taxProvince: province,
      subtotalAmount: totals.subtotal,
      taxTotal: totals.tax,
      totalAmount: totals.total,
      computedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(workOrderTax.workOrderId, workOrderId))

  return totals
}
