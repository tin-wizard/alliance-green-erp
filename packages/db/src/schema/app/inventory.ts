import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
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
 * Inventory — stock counters, the append-only movement ledger, adjustments,
 * sub-contractor stock messages and the single global price-editor lock.
 *
 * E4: `parts.current_quantity` is authoritative and counter-maintained. It is
 * never derived from `inventory_movements`; the ledger may disagree because of
 * deleted rows, excluded entries or manual adjustments. Reports expose the
 * disagreement instead of correcting it.
 *
 * E2: a sale writes the work-order id into `woid_poid`, `invoice_number` and
 * `invoice_id`. The forward `document_type`/`document_id` columns answer the
 * same question without relying on the duplication.
 */
export const inventoryMovements = app.table(
  'inventory_movements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    partNo: text('part_no').notNull(),
    partId: integer('part_id'),
    qty: numeric('qty', { precision: 12, scale: 2 }).notNull(),
    price: numeric('price', { precision: 12, scale: 2 }),
    /** Granular origin: purchase_receipt, sale, adjustment, transfer_*. */
    movementType: text('movement_type').notNull(),
    /** Legacy ledger vocabulary: Sale, Purchase, Adjustment. */
    transactionType: text('transaction_type').notNull().default('Purchase'),
    referenceType: text('reference_type').notNull(),
    referenceId: text('reference_id').notNull(),
    documentType: text('document_type'),
    documentId: text('document_id'),
    /** E2 duplication, preserved until a tested replacement exists. */
    woidPoid: integer('woid_poid'),
    invoiceNumber: text('invoice_number'),
    invoiceId: integer('invoice_id'),
    poId: integer('po_id'),
    receiptId: integer('receipt_id'),
    receiptLineId: integer('receipt_line_id'),
    adjustmentType: text('adjustment_type'),
    onFieldCountedQty: text('on_field_counted_qty'),
    adjSubcontractor: integer('adj_subcontractor'),
    adjSite: integer('adj_site'),
    isLogDeleted: boolean('is_log_deleted').notNull().default(false),
    isIncludedInStockManagement: boolean('is_included_in_stock_management').notNull().default(true),
    idempotencyKey: text('idempotency_key').notNull(),
    note: text('note'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('inventory_movements_idempotency_unique').on(table.idempotencyKey),
    index('inventory_movements_part_idx').on(table.partNo),
    index('inventory_movements_part_created_idx').on(table.partNo, table.createdAt),
    index('inventory_movements_receipt_idx').on(table.receiptId),
    index('inventory_movements_type_idx').on(table.transactionType, table.createdAt),
    check(
      'inventory_movements_type_check',
      sql`${table.movementType} in ('purchase_receipt','sale','adjustment','transfer_out','transfer_in')`,
    ),
    check(
      'inventory_movements_transaction_check',
      sql`${table.transactionType} in ('Sale','Purchase','Adjustment')`,
    ),
  ],
)

/** `parts_inventory_adjustment` — manual counts and corrections with attribution. */
export const partStockAdjustments = app.table(
  'part_stock_adjustments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    partNo: text('part_no').notNull(),
    partId: integer('part_id'),
    qty: numeric('qty', { precision: 12, scale: 2 }).notNull(),
    price: numeric('price', { precision: 12, scale: 2 }),
    adjustmentType: text('adjustment_type').notNull().default('global'),
    notes: text('notes'),
    isLogDeleted: boolean('is_log_deleted').notNull().default(false),
    workOrderNumber: integer('work_order_number'),
    siteId: integer('site_id'),
    subcontractorId: integer('subcontractor_id'),
    massAdjustmentNumber: integer('mass_adjustment_number'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('part_stock_adjustments_idempotency_unique').on(table.idempotencyKey),
    index('part_stock_adjustments_part_idx').on(table.partNo, table.createdAt),
    check(
      'part_stock_adjustments_type_check',
      sql`${table.adjustmentType} in ('global','alliance','subcontractor','customer','contractor')`,
    ),
  ],
)

/**
 * The single global price-editor lock (id = 1).
 *
 * It is a mutex over the editor, not a per-part price freeze. TTL is explicit
 * and visible; an expired lock is surfaced, never silently cleared. Taking over
 * requires the `takeOver` flag and leaves an audit trail.
 */
export const partPriceLocks = app.table(
  'part_price_locks',
  {
    id: integer('id').primaryKey().default(1),
    isLocked: boolean('is_locked').notNull().default(false),
    lockedBy: uuid('locked_by'),
    lockedByName: text('locked_by_name'),
    lockTime: timestamp('lock_time', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    version: integer('version').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('part_price_locks_single_row_check', sql`${table.id} = 1`)],
)

/** `sub_stock_notification` — a subcontractor's low-stock subscription. */
export const subStockNotifications = app.table(
  'sub_stock_notifications',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    subcontractorId: integer('subcontractor_id').notNull(),
    userId: uuid('user_id'),
    containStock: boolean('contain_stock').notNull().default(true),
    notificationCode: text('notification_code').notNull(),
    isResponded: boolean('is_responded').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sub_stock_notifications_code_unique').on(table.notificationCode),
    index('sub_stock_notifications_sub_idx').on(table.subcontractorId),
  ],
)

/** `sub_stock_messages` — messages shown in the subcontractor stock portal. */
export const subStockMessages = app.table(
  'sub_stock_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    notificationId: integer('notification_id'),
    subcontractorId: integer('subcontractor_id').notNull(),
    userId: uuid('user_id'),
    userType: text('user_type').notNull().default('sub'),
    username: text('username'),
    subject: text('subject'),
    message: text('message').notNull(),
    isRead: boolean('is_read').notNull().default(false),
    readBy: uuid('read_by'),
    confirmationKey: text('confirmation_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sub_stock_messages_sub_idx').on(table.subcontractorId, table.createdAt),
    index('sub_stock_messages_unread_idx').on(table.subcontractorId, table.isRead),
  ],
)

export type InventoryMovement = typeof inventoryMovements.$inferSelect
export type PartStockAdjustment = typeof partStockAdjustments.$inferSelect
export type PartPriceLock = typeof partPriceLocks.$inferSelect
export type SubStockMessage = typeof subStockMessages.$inferSelect
