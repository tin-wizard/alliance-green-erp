/**
 * Inventory stock posting for purchasing receipts.
 *
 * SERVER ONLY. The full Inventory module owns counters and reporting; this
 * slice records the append-only ledger row that a purchase receipt produces.
 * The idempotency key makes a retried receipt a no-op.
 */
import type { Tx } from '@cls/db'
import { inventoryMovements } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'

export interface PurchaseReceiptStockLine {
  receiptLineId: number
  partNo: string
  qty: string
}

export async function postPurchaseReceipt(
  tx: Tx,
  input: {
    poId: number
    receiptId: number
    lines: PurchaseReceiptStockLine[]
    session: AuthSessionView
  },
): Promise<number> {
  if (input.lines.length === 0) return 0
  const rows = await tx
    .insert(inventoryMovements)
    .values(
      input.lines.map((line) => ({
        partNo: line.partNo,
        qty: line.qty,
        movementType: 'purchase_receipt',
        referenceType: 'purchase_order_receipt',
        referenceId: String(input.receiptId),
        poId: input.poId,
        receiptId: input.receiptId,
        receiptLineId: line.receiptLineId,
        idempotencyKey: `purchase-receipt:${input.receiptId}:${line.receiptLineId}`,
        createdBy: input.session.user.id,
      })),
    )
    .onConflictDoNothing({ target: inventoryMovements.idempotencyKey })
    .returning({ id: inventoryMovements.id })
  return rows.length
}
