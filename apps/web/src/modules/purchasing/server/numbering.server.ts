/**
 * Purchase-order numbering (BUSINESS-RULES D1–D3).
 *
 * The PO id is the number. Credit POs share the space, so the next id is
 * `MAX(ABS(id)) + 1`, not `MAX(id) + 1`. A transaction-scoped advisory lock
 * serialises concurrent allocations. Transfer POs get `<source>-T<n>` as a
 * display number and still consume an integer id.
 */
import { sql } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import type { Tx } from '@cls/db'
import { purchaseOrders } from '@cls/db/schema'

const LOCK_KEY = 'cls.purchase_order_numbers'

export interface PurchaseOrderNumber {
  id: number
  displayNumber: string
}

export async function allocatePurchaseOrderNumber(
  tx: Tx,
  options: { transferFromPoId?: number | null } = {},
): Promise<PurchaseOrderNumber> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`)

  const rows = await tx
    .select({ maxId: sql<number>`coalesce(max(abs(${purchaseOrders.id})), 0)` })
    .from(purchaseOrders)
  const id = Number(rows[0]?.maxId ?? 0) + 1
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError('The purchase-order number could not be allocated.')
  }

  let displayNumber = String(id)
  if (options.transferFromPoId) {
    const prefix = `${options.transferFromPoId}-T`
    const existing = await tx
      .select({ displayNumber: purchaseOrders.displayNumber })
      .from(purchaseOrders)
      .where(sql`${purchaseOrders.displayNumber} like ${`${prefix}%`}`)
    const highest = existing.reduce((max, row) => {
      const suffix = Number(row.displayNumber?.slice(prefix.length) ?? 0)
      return Number.isInteger(suffix) && suffix > max ? suffix : max
    }, 0)
    displayNumber = `${prefix}${highest + 1}`
  }

  return { id, displayNumber }
}

export function displayNumberFor(id: number, displayNumber: string | null): string {
  return displayNumber && displayNumber !== String(id) ? displayNumber : String(id)
}
