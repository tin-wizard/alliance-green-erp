/**
 * Work-order number uniqueness, post-D18.
 *
 * The legacy allocator checked `tcustr.sSource` and `tProject.sName` because it
 * was writing into Sage 50 and had to avoid colliding with Sage's own numbers.
 * In Sage Accounting the invoice number belongs to the ledger, our reference is
 * ours, and no Sage field constrains a work-order number. So the honest check is
 * against **our** tables:
 *
 * - `app.work_orders.id` — the WO number is the primary key;
 * - `app.quotes.work_order_number` — reserved through the same allocator;
 * - `app.sales_invoices.invoice_number` — the invoice series shares the space.
 *
 * `null` means "cannot verify" (database unavailable), which preserves the
 * allocator's existing unverifiable behaviour. It never means "free".
 */
import { eq } from 'drizzle-orm'
import { getDb } from '@cls/db'
import { quotes, salesInvoices, workOrders } from '@cls/db/schema'
import { logger } from '@cls/core/logger'

export async function numberInUse(id: number): Promise<boolean | null> {
  if (!Number.isInteger(id) || id <= 0) return false
  try {
    const db = getDb()
    const [workOrder, quote, invoice] = await Promise.all([
      db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.id, id)).limit(1),
      db
        .select({ id: quotes.id })
        .from(quotes)
        .where(eq(quotes.workOrderNumber, id))
        .limit(1),
      db
        .select({ id: salesInvoices.id })
        .from(salesInvoices)
        .where(eq(salesInvoices.invoiceNumber, String(id)))
        .limit(1),
    ])
    return workOrder.length > 0 || quote.length > 0 || invoice.length > 0
  } catch (error) {
    logger.warn(
      `Work-order number check could not run: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

export function describeNumberSource(): string {
  return 'app numbering (work orders, quotes, invoices); Sage numbers belong to the ledger'
}
