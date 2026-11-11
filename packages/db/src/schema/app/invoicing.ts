import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { app } from './base'
import { workOrders } from './workorder'

/**
 * Invoicing — customer sales invoices and subcontractor purchase invoices.
 *
 * A sales invoice is built from the Work Orders invoice-ready snapshot. Its
 * lines are replaced wholesale on every save (BUSINESS-RULES B1), never edited
 * row by row, and the operator-posted totals are stored as posted (A5).
 *
 * Posting is an outbox, not a flag: `sage_postings` records the queued external
 * document, `sage_links` records the one result, and `invoice_stock_postings`
 * records the stock side when it happens. The immutability guard reads those
 * records plus the Work Orders legacy flags (B3).
 */
export const salesInvoices = app.table(
  'sales_invoices',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workOrderId: integer('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    /** Stable operator-facing number; one invoice per work order. */
    invoiceNumber: text('invoice_number').notNull(),
    workOrderNumber: integer('work_order_number').notNull(),
    customerId: integer('customer_id'),
    siteId: integer('site_id').notNull(),
    calcType: text('calc_type').notNull(),
    /** draft | issued | rejected | partially_paid | paid | cancelled */
    status: text('status').notNull().default('draft'),
    invoiceDate: date('invoice_date').notNull().default(sql`current_date`),
    dueDate: date('due_date'),
    issuedOn: date('issued_on'),
    taxProvince: text('tax_province').notNull().default('ON'),
    appliedTaxRate: numeric('applied_tax_rate', { precision: 9, scale: 5 }),
    appliedTaxRatePst: numeric('applied_tax_rate_pst', { precision: 9, scale: 5 }),
    labourAmount: numeric('labour_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    materialAmount: numeric('material_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    subtotalAmount: numeric('subtotal_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    taxAmount: numeric('tax_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    manualTaxAmount: numeric('manual_tax_amount', { precision: 12, scale: 2 }),
    manualSubtotalAmount: numeric('manual_subtotal_amount', { precision: 12, scale: 2 }),
    legacyCentCorrectionApplied: boolean('legacy_cent_correction_applied')
      .notNull()
      .default(false),
    notes: text('notes'),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    lastRejectedAt: timestamp('last_rejected_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sales_invoices_work_order_unique').on(table.workOrderId),
    uniqueIndex('sales_invoices_number_unique').on(table.invoiceNumber),
    index('sales_invoices_status_idx').on(table.status, table.invoiceDate),
    index('sales_invoices_customer_idx').on(table.customerId),
    check(
      'sales_invoices_status_check',
      sql`${table.status} in ('draft','issued','rejected','partially_paid','paid','cancelled')`,
    ),
  ],
)

const lineColumns = {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  invoiceId: bigint('invoice_id', { mode: 'number' })
    .notNull()
    .references(() => salesInvoices.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(1),
  description: text('description'),
  qty: numeric('qty', { precision: 9, scale: 2 }).notNull(),
  price: numeric('price', { precision: 12, scale: 2 }).notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
}

export const invoiceLabourLines = app.table(
  'invoice_labour_lines',
  {
    ...lineColumns,
    lineDate: date('line_date').notNull(),
    hours: numeric('hours', { precision: 7, scale: 2 }).notNull(),
    rateCode: smallint('rate_code').notNull().default(1),
    hourlyRate: numeric('hourly_rate', { precision: 9, scale: 2 }).notNull(),
  },
  (table) => [index('invoice_labour_lines_invoice_idx').on(table.invoiceId, table.position)],
)

export const invoicePartLines = app.table(
  'invoice_part_lines',
  {
    ...lineColumns,
    partNo: text('part_no').notNull(),
    isLocalPart: boolean('is_local_part').notNull().default(false),
    appliedWorkOrderId: text('applied_work_order_id'),
  },
  (table) => [index('invoice_part_lines_invoice_idx').on(table.invoiceId, table.position)],
)

export const invoiceSpecialPartLines = app.table(
  'invoice_special_part_lines',
  {
    ...lineColumns,
    name: text('name').notNull(),
    isEmergencyLighting: boolean('is_emergency_lighting').notNull().default(false),
    isLocalPart: boolean('is_local_part').notNull().default(false),
    warrantyYears: text('warranty_years'),
    laborWarrantyYears: text('labor_warranty_years'),
    appliedWorkOrderId: text('applied_work_order_id'),
  },
  (table) => [
    index('invoice_special_part_lines_invoice_idx').on(table.invoiceId, table.position),
  ],
)

/**
 * Generic Sage outbox (SAGE-CLOUD §3). One row per document, external_ref unique
 * and attempt-independent. The invoice is issued before this is processed.
 */
export const sagePostings = app.table(
  'sage_postings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    docType: text('doc_type').notNull(),
    docId: integer('doc_id').notNull(),
    externalRef: text('external_ref').notNull(),
    /** queued | processing | sent | unknown | failed | cancelled */
    status: text('status').notNull().default('queued'),
    attempt: integer('attempt').notNull().default(0),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    response: jsonb('response').$type<Record<string, unknown> | null>(),
    lastError: text('last_error'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sage_postings_external_ref_unique').on(table.externalRef),
    uniqueIndex('sage_postings_document_unique').on(table.docType, table.docId),
    index('sage_postings_status_idx').on(table.status, table.requestedAt),
    check(
      'sage_postings_status_check',
      sql`${table.status} in ('queued','processing','sent','unknown','failed','cancelled')`,
    ),
  ],
)

export const sageLinks = app.table(
  'sage_links',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    docType: text('doc_type').notNull(),
    docId: integer('doc_id').notNull(),
    externalRef: text('external_ref').notNull(),
    externalId: text('external_id').notNull(),
    payloadHash: text('payload_hash'),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sage_links_external_ref_unique').on(table.externalRef),
    uniqueIndex('sage_links_document_unique').on(table.docType, table.docId),
  ],
)

/** Record that the invoice's stock side was posted or reversed. */
export const invoiceStockPostings = app.table(
  'invoice_stock_postings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    invoiceId: bigint('invoice_id', { mode: 'number' })
      .notNull()
      .references(() => salesInvoices.id, { onDelete: 'cascade' }),
    /** posted | reversed */
    status: text('status').notNull().default('posted'),
    reference: text('reference').notNull(),
    movementCount: integer('movement_count').notNull().default(0),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => [
    uniqueIndex('invoice_stock_postings_invoice_unique').on(table.invoiceId),
    check('invoice_stock_postings_status_check', sql`${table.status} in ('posted','reversed')`),
  ],
)

export const rejectedInvoices = app.table(
  'rejected_invoices',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    invoiceId: bigint('invoice_id', { mode: 'number' })
      .notNull()
      .references(() => salesInvoices.id, { onDelete: 'cascade' }),
    invoiceNumber: text('invoice_number').notNull(),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }).notNull().defaultNow(),
    reason: text('reason').notNull(),
    rejectedByDetail: text('rejected_by_detail'),
    invoiceContent: jsonb('invoice_content').notNull().$type<Record<string, unknown>>(),
    resubmittedAt: timestamp('resubmitted_at', { withTimezone: true }),
  },
  (table) => [index('rejected_invoices_invoice_idx').on(table.invoiceId, table.rejectedAt)],
)

export const invoicePayments = app.table(
  'invoice_payments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    invoiceId: bigint('invoice_id', { mode: 'number' })
      .notNull()
      .references(() => salesInvoices.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    paidOn: date('paid_on').notNull().default(sql`current_date`),
    method: text('method'),
    reference: text('reference'),
    notes: text('notes'),
    idempotencyKey: text('idempotency_key').notNull(),
    recordedBy: uuid('recorded_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invoice_payments_idempotency_unique').on(table.idempotencyKey),
    index('invoice_payments_invoice_idx').on(table.invoiceId, table.paidOn),
    check('invoice_payments_amount_check', sql`${table.amount} > 0`),
  ],
)

/* ------------------------- subcontractor invoices ------------------------- */

export const subcontractorInvoices = app.table(
  'subcontractor_invoices',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workOrderId: integer('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    subcontractorId: integer('subcontractor_id').notNull(),
    invoiceNumber: text('invoice_number').notNull(),
    invoiceDate: date('invoice_date').notNull(),
    /** submitted | approved | rejected | partially_paid | paid | cancelled */
    status: text('status').notNull().default('submitted'),
    taxProvince: text('tax_province').notNull().default('ON'),
    appliedTaxRate: numeric('applied_tax_rate', { precision: 9, scale: 5 }),
    appliedTaxRatePst: numeric('applied_tax_rate_pst', { precision: 9, scale: 5 }),
    labourAmount: numeric('labour_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    materialAmount: numeric('material_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    subtotalAmount: numeric('subtotal_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    taxAmount: numeric('tax_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
    rejectionReason: text('rejection_reason'),
    version: integer('version').notNull().default(1),
    submittedBy: uuid('submitted_by'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('subcontractor_invoices_number_unique').on(
      table.subcontractorId,
      table.invoiceNumber,
    ),
    index('subcontractor_invoices_status_idx').on(table.status, table.invoiceDate),
    index('subcontractor_invoices_sub_idx').on(table.subcontractorId, table.createdAt),
    index('subcontractor_invoices_wo_idx').on(table.workOrderId),
    check(
      'subcontractor_invoices_status_check',
      sql`${table.status} in ('submitted','approved','rejected','partially_paid','paid','cancelled')`,
    ),
  ],
)

export const subcontractorInvoiceLines = app.table(
  'subcontractor_invoice_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    invoiceId: bigint('invoice_id', { mode: 'number' })
      .notNull()
      .references(() => subcontractorInvoices.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    position: integer('position').notNull().default(1),
    description: text('description'),
    qty: numeric('qty', { precision: 9, scale: 2 }).notNull(),
    rate: numeric('rate', { precision: 12, scale: 2 }).notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    sourceLineId: integer('source_line_id'),
  },
  (table) => [
    index('subcontractor_invoice_lines_invoice_idx').on(table.invoiceId, table.position),
    check('subcontractor_invoice_lines_kind_check', sql`${table.kind} in ('labour','part','special')`),
  ],
)

export const subcontractorInvoicePayments = app.table(
  'subcontractor_invoice_payments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    invoiceId: bigint('invoice_id', { mode: 'number' })
      .notNull()
      .references(() => subcontractorInvoices.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    paidOn: date('paid_on').notNull().default(sql`current_date`),
    method: text('method'),
    reference: text('reference'),
    notes: text('notes'),
    idempotencyKey: text('idempotency_key').notNull(),
    recordedBy: uuid('recorded_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('subcontractor_invoice_payments_idempotency_unique').on(table.idempotencyKey),
    index('subcontractor_invoice_payments_invoice_idx').on(table.invoiceId, table.paidOn),
    check('subcontractor_invoice_payments_amount_check', sql`${table.amount} > 0`),
  ],
)

export type SalesInvoice = typeof salesInvoices.$inferSelect
export type InvoiceLabourLine = typeof invoiceLabourLines.$inferSelect
export type InvoicePartLine = typeof invoicePartLines.$inferSelect
export type InvoiceSpecialPartLine = typeof invoiceSpecialPartLines.$inferSelect
export type SagePosting = typeof sagePostings.$inferSelect
export type SageLink = typeof sageLinks.$inferSelect
export type InvoiceStockPosting = typeof invoiceStockPostings.$inferSelect
export type RejectedInvoice = typeof rejectedInvoices.$inferSelect
export type InvoicePayment = typeof invoicePayments.$inferSelect
export type SubcontractorInvoice = typeof subcontractorInvoices.$inferSelect
export type SubcontractorInvoiceLine = typeof subcontractorInvoiceLines.$inferSelect
export type SubcontractorInvoicePayment = typeof subcontractorInvoicePayments.$inferSelect
