import { sql } from 'drizzle-orm'
import {
  bigserial,
  check,
  index,
  integer,
  numeric,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { app } from './base'

/**
 * Inventory — the movement ledger only.
 *
 * The full Inventory module (counters, price management, reporting) is out of
 * scope here. Purchasing receipts need an append-only stock posting, so this
 * slice owns the ledger row and the idempotency key. No counter is derived or
 * stored here; `parts.current_quantity` remains owned by Inventory.
 */
export const inventoryMovements = app.table(
  'inventory_movements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    partNo: text('part_no').notNull(),
    qty: numeric('qty', { precision: 12, scale: 2 }).notNull(),
    movementType: text('movement_type').notNull(),
    referenceType: text('reference_type').notNull(),
    referenceId: text('reference_id').notNull(),
    poId: integer('po_id'),
    receiptId: integer('receipt_id'),
    receiptLineId: integer('receipt_line_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    note: text('note'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('inventory_movements_idempotency_unique').on(table.idempotencyKey),
    index('inventory_movements_part_idx').on(table.partNo),
    index('inventory_movements_receipt_idx').on(table.receiptId),
    check(
      'inventory_movements_type_check',
      sql`${table.movementType} in ('purchase_receipt','transfer_out','transfer_in')`,
    ),
  ],
)
