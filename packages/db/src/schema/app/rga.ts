/**
 * RGAs, returns and site warranties.
 *
 * Raw legacy status codes are stored (2 Active, 3 Saved, 7 In Transit,
 * 6 Received, 4 Completed, 10 Cancelled, 11 Invoiced). Display projection lives
 * in the module, never in the table. A credit is a separate `rga_credits`
 * document, not a negative purchase invoice; Sage receives it as a purchase
 * credit note through the shared posting queue.
 */
import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { app } from './base'
import { purchaseOrderParts, purchaseOrderSpecialParts, purchaseOrders } from './purchasing'
import { sites, subcontractors, suppliers } from './masterdata'
import { workOrders } from './workorder'

export const rgas = app.table(
  'rgas',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    supplierId: integer('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
    poId: integer('po_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),
    workOrderId: integer('work_order_id').references(() => workOrders.id, { onDelete: 'set null' }),
    siteId: integer('site_id').references(() => sites.id, { onDelete: 'set null' }),
    subcontractorId: integer('subcontractor_id').references(() => subcontractors.id, {
      onDelete: 'set null',
    }),
    /** rga | credit | replacement */
    rgaType: text('rga_type').notNull().default('rga'),
    /** supplier | subcontractor | customer | subcredit */
    replacementType: text('replacement_type'),
    /** Raw `rga_status` code. */
    status: smallint('status').notNull().default(2),
    /** Frozen legacy `status_on_july_21_2025`; never written again. */
    legacyStatus: smallint('legacy_status'),
    requestDate: date('request_date').notNull().default(sql`current_date`),
    rgaNotes: text('rga_notes'),
    internalNotes: text('internal_notes'),
    rgaInvoiceNumber: text('rga_invoice_number'),
    rgaInvoiceDate: date('rga_invoice_date'),
    shippingAddress: text('shipping_address'),
    isCritical: boolean('is_critical').notNull().default(false),
    isSubmitted: boolean('is_submitted').notNull().default(false),
    stockUpdated: boolean('stock_updated').notNull().default(false),
    revisionNo: integer('revision_no').notNull().default(0),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('rgas_type_check', sql`${table.rgaType} in ('rga','credit','replacement')`),
    check(
      'rgas_replacement_type_check',
      sql`${table.replacementType} is null or ${table.replacementType} in ('supplier','subcontractor','customer','subcredit')`,
    ),
    check('rgas_status_check', sql`${table.status} in (2,3,4,6,7,10,11)`),
    index('rgas_status_idx').on(table.status, table.requestDate),
    index('rgas_supplier_idx').on(table.supplierId),
    index('rgas_po_idx').on(table.poId),
    index('rgas_wo_idx').on(table.workOrderId),
    index('rgas_sub_idx').on(table.subcontractorId),
  ],
)

export const rgaParts = app.table(
  'rga_parts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    rgaId: integer('rga_id')
      .notNull()
      .references(() => rgas.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(1),
    partNo: text('part_no').notNull(),
    description: text('description'),
    qty: numeric('qty', { precision: 9, scale: 2 }).notNull(),
    returnQty: numeric('return_qty', { precision: 9, scale: 2 }).notNull(),
    price: numeric('price', { precision: 12, scale: 2 }).notNull().default('0'),
    reasonForReturn: text('reason_for_return'),
    underWarranty: boolean('under_warranty').notNull().default(false),
    purchaseType: text('purchase_type'),
    purchaseTypeNumber: text('purchase_type_number'),
    poNumber: text('po_number'),
    poPartId: integer('po_part_id').references(() => purchaseOrderParts.id, {
      onDelete: 'set null',
    }),
    modelNumber: text('model_number'),
    originalInvoiceNumber: text('original_invoice_number'),
    originalInvoiceDate: date('original_invoice_date'),
  },
  (table) => [index('rga_parts_rga_idx').on(table.rgaId, table.position)],
)

export const rgaSpecialParts = app.table(
  'rga_special_parts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    rgaId: integer('rga_id')
      .notNull()
      .references(() => rgas.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(1),
    name: text('name').notNull(),
    description: text('description'),
    qty: numeric('qty', { precision: 9, scale: 2 }).notNull(),
    returnQty: numeric('return_qty', { precision: 9, scale: 2 }).notNull(),
    price: numeric('price', { precision: 12, scale: 2 }).notNull().default('0'),
    reasonForReturn: text('reason_for_return'),
    purchaseType: text('purchase_type'),
    purchaseTypeNumber: text('purchase_type_number'),
    poNumber: text('po_number'),
    poSpecialPartId: integer('po_special_part_id').references(
      () => purchaseOrderSpecialParts.id,
      { onDelete: 'set null' },
    ),
    modelNumber: text('model_number'),
    originalInvoiceNumber: text('original_invoice_number'),
    originalInvoiceDate: date('original_invoice_date'),
  },
  (table) => [index('rga_special_parts_rga_idx').on(table.rgaId, table.position)],
)

export const rgaStatusHistory = app.table(
  'rga_status_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    rgaId: integer('rga_id')
      .notNull()
      .references(() => rgas.id, { onDelete: 'cascade' }),
    fromStatus: smallint('from_status'),
    toStatus: smallint('to_status').notNull(),
    action: text('action').notNull(),
    actorId: uuid('actor_id'),
    actorLabel: text('actor_label'),
    note: text('note'),
    rgaVersion: integer('rga_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('rga_status_history_rga_idx').on(table.rgaId, table.createdAt)],
)

/** Supplier credit note raised from an approved RGA. One per RGA. */
export const rgaCredits = app.table(
  'rga_credits',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    rgaId: integer('rga_id')
      .notNull()
      .references(() => rgas.id, { onDelete: 'cascade' }),
    supplierId: integer('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    /** Explicit source reference: the PO or RGA the credit corrects. */
    sourceType: text('source_type').notNull().default('rga'),
    sourceId: text('source_id'),
    creditNumber: text('credit_number').notNull(),
    creditDate: date('credit_date').notNull().default(sql`current_date`),
    taxProvince: text('tax_province').notNull().default('ON'),
    appliedTaxRate: numeric('applied_tax_rate', { precision: 9, scale: 5 }),
    subtotalAmount: numeric('subtotal_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    taxAmount: numeric('tax_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    /** draft | posted | void */
    status: text('status').notNull().default('draft'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('rga_credits_rga_unique').on(table.rgaId),
    uniqueIndex('rga_credits_number_unique').on(table.supplierId, table.creditNumber),
    check('rga_credits_status_check', sql`${table.status} in ('draft','posted','void')`),
  ],
)

export const rgaCreditLines = app.table(
  'rga_credit_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    creditId: integer('credit_id')
      .notNull()
      .references(() => rgaCredits.id, { onDelete: 'cascade' }),
    /** part | special */
    kind: text('kind').notNull(),
    position: integer('position').notNull().default(1),
    partNo: text('part_no'),
    description: text('description').notNull(),
    qty: numeric('qty', { precision: 9, scale: 2 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  },
  (table) => [
    check('rga_credit_lines_kind_check', sql`${table.kind} in ('part','special')`),
    index('rga_credit_lines_credit_idx').on(table.creditId, table.position),
  ],
)

/**
 * Durable notification outbox. The RGA reminder job only writes these rows;
 * delivery is a separate concern (ADR 0013).
 */
export const rgaNotifications = app.table(
  'rga_notifications',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    rgaId: integer('rga_id')
      .notNull()
      .references(() => rgas.id, { onDelete: 'cascade' }),
    notifyType: text('notify_type').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull().defaultNow(),
    /** pending | sent | skipped | failed */
    status: text('status').notNull().default('pending'),
    recipientUserId: uuid('recipient_user_id'),
    recipientEmail: text('recipient_email'),
    subject: text('subject'),
    body: text('body'),
    idempotencyKey: text('idempotency_key').notNull(),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('rga_notifications_idempotency_unique').on(table.idempotencyKey),
    index('rga_notifications_due_idx').on(table.status, table.dueAt),
    index('rga_notifications_rga_idx').on(table.rgaId, table.createdAt),
    check(
      'rga_notifications_status_check',
      sql`${table.status} in ('pending','sent','skipped','failed')`,
    ),
  ],
)

export type Rga = typeof rgas.$inferSelect
export type RgaPart = typeof rgaParts.$inferSelect
export type RgaSpecialPart = typeof rgaSpecialParts.$inferSelect
export type RgaStatusHistory = typeof rgaStatusHistory.$inferSelect
export type RgaCredit = typeof rgaCredits.$inferSelect
export type RgaCreditLine = typeof rgaCreditLines.$inferSelect
export type RgaNotification = typeof rgaNotifications.$inferSelect
