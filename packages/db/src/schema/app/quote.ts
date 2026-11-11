import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { app } from './base'

/**
 * Quotes module — forward model.
 *
 * One header table for both in-scope kinds (`customer` and `standalone`), with
 * a `kind` discriminator. Legacy keeps two near-identical headers; the shared
 * fields and lifecycle rules are the same, and branching on kind is cheaper
 * than duplicating nine child tables.
 *
 * Parity decisions:
 *  - `id` is the quote number shown to the customer (legacy "Quote #").
 *  - `work_order_number` is authoritative for customer quotes (BUSINESS-RULES
 *    H4): the Work Orders allocator reserves it, this module never owns a
 *    second counter. Standalone quotes leave it null until conversion.
 *  - `revision_quote_id` points at the immediate predecessor, `root_quote_id`
 *    groups the chain and `is_last_revision` marks its end, matching the Work
 *    Orders revision chain contract.
 *  - `status`: 1 In progress, 2 Saved (standalone only), 3 Waiting for
 *    approval, 4 Approved, 5 Cancelled.
 *  - incurred cost columns sit beside sell columns for margin; they never
 *    enter the customer subtotal (the legacy PDF uses sell lines only).
 */
export const quoteKind = app.enum('quote_kind', ['customer', 'standalone'])

export const quotes = app.table(
  'quotes',
  {
    id: serial('id').primaryKey(),
    kind: quoteKind('kind').notNull(),
    /** Work-order number reserved through the Work Orders allocator (H4). */
    workOrderNumber: integer('work_order_number'),
    siteId: integer('site_id').notNull(),
    shipContact: text('ship_contact'),
    shipStreet1: text('ship_street_1'),
    shipStreet2: text('ship_street_2'),
    shipCity: text('ship_city'),
    shipProvince: text('ship_province'),
    shipPostalCode: text('ship_postal_code'),
    isAddressUpdated: boolean('is_address_updated').notNull().default(false),
    report: text('report'),
    notes: text('notes'),
    pdfNotes: text('pdf_notes'),
    status: smallint('status').notNull().default(1),
    paymentTermsId: smallint('payment_terms_id'),
    taxCode: text('tax_code'),
    appliedTaxRate: numeric('applied_tax_rate', { precision: 9, scale: 5 }),
    manualTaxAmount: numeric('manual_tax_amount', { precision: 12, scale: 2 }),
    dueDate: date('due_date'),
    isDueDateTbd: boolean('is_due_date_tbd').notNull().default(false),
    dateApproved: date('date_approved'),
    dateCreated: date('date_created').notNull().defaultNow(),
    isRevision: boolean('is_revision').notNull().default(false),
    revisionQuoteId: integer('revision_quote_id'),
    rootQuoteId: integer('root_quote_id'),
    /** Legacy float chain number (0, then 0.1, 0.2 …). */
    revisionId: numeric('revision_id', { precision: 6, scale: 1 }).notNull().default('0'),
    isLastRevision: boolean('is_last_revision').notNull().default(true),
    isDeleted: boolean('is_deleted').notNull().default(false),
    createdFromLocal: boolean('created_from_local').notNull().default(false),
    referenceWoNumber: text('reference_wo_number'),
    convertedWorkOrderId: integer('converted_work_order_id'),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('quotes_status_check', sql`${table.status} between 1 and 5`),
    check(
      'quotes_saved_kind_check',
      sql`${table.status} <> 2 or ${table.kind} = 'standalone'`,
    ),
    index('quotes_status_idx').on(table.kind, table.status),
    index('quotes_site_idx').on(table.siteId),
    index('quotes_work_order_number_idx').on(table.workOrderNumber),
    uniqueIndex('quotes_one_chain_end')
      .on(sql`coalesce(${table.rootQuoteId}, ${table.id})`)
      .where(sql`${table.isLastRevision}`),
  ],
)

export const quoteHours = app.table(
  'quote_hours',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    lineDate: date('line_date'),
    hours: numeric('hours', { precision: 7, scale: 2 }).notNull().default('0'),
    numTechs: integer('num_techs').notNull().default(1),
    rateCode: text('rate_code'),
    rate: numeric('rate', { precision: 9, scale: 2 }).notNull().default('0'),
    incurredHours: numeric('incurred_hours', { precision: 7, scale: 2 }),
    incurredRate: numeric('incurred_rate', { precision: 9, scale: 2 }),
    note: text('note'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [index('quote_hours_quote_idx').on(table.quoteId)],
)

export const quoteParts = app.table(
  'quote_parts',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    partNo: text('part_no').notNull(),
    description: text('description'),
    qty: integer('qty').notNull().default(0),
    price: numeric('price', { precision: 12, scale: 2 }).notNull().default('0'),
    costPrice: numeric('cost_price', { precision: 12, scale: 2 }),
    isUnderWarranty: boolean('is_under_warranty').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [index('quote_parts_quote_idx').on(table.quoteId)],
)

export const quoteSpecialParts = app.table(
  'quote_special_parts',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    qty: integer('qty').notNull().default(0),
    price: numeric('price', { precision: 12, scale: 2 }).notNull().default('0'),
    costPrice: numeric('cost_price', { precision: 12, scale: 2 }),
    isEmergencyLighting: boolean('is_emergency_lighting').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [index('quote_special_parts_quote_idx').on(table.quoteId)],
)

/** Legacy `rejected_quotes`: customer rejection plus the content they saw. */
export const quoteRejections = app.table(
  'quote_rejections',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    reason: text('reason'),
    quoteContent: jsonb('quote_content').$type<Record<string, unknown>>(),
    rejectedByDetail: text('rejected_by_detail'),
    rejectedBy: uuid('rejected_by'),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('quote_rejections_quote_idx').on(table.quoteId)],
)

export const quotePackingSlips = app.table(
  'quote_packing_slips',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    dateCreated: date('date_created').notNull().defaultNow(),
    shipDate: date('ship_date'),
    packingSlipLevel: smallint('packing_slip_level').notNull().default(1),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('quote_packing_slips_quote_idx').on(table.quoteId)],
)

export const quotePackingParts = app.table(
  'quote_packing_parts',
  {
    id: serial('id').primaryKey(),
    packingSlipId: integer('packing_slip_id')
      .notNull()
      .references(() => quotePackingSlips.id, { onDelete: 'cascade' }),
    quotePartId: integer('quote_part_id'),
    partNo: text('part_no').notNull(),
    actualQty: integer('actual_qty'),
    backorderQty: integer('backorder_qty').notNull().default(0),
    shippedQty: integer('shipped_qty'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [index('quote_packing_parts_slip_idx').on(table.packingSlipId)],
)

export const quotePackingSpecialParts = app.table(
  'quote_packing_special_parts',
  {
    id: serial('id').primaryKey(),
    packingSlipId: integer('packing_slip_id')
      .notNull()
      .references(() => quotePackingSlips.id, { onDelete: 'cascade' }),
    quoteSpecialPartId: integer('quote_special_part_id'),
    name: text('name').notNull(),
    actualQty: integer('actual_qty'),
    backorderQty: integer('backorder_qty').notNull().default(0),
    shippedQty: integer('shipped_qty'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [index('quote_packing_special_parts_slip_idx').on(table.packingSlipId)],
)

export type Quote = typeof quotes.$inferSelect
export type NewQuote = typeof quotes.$inferInsert
export type QuoteHour = typeof quoteHours.$inferSelect
export type QuotePart = typeof quoteParts.$inferSelect
export type QuoteSpecialPart = typeof quoteSpecialParts.$inferSelect
export type QuotePackingSlip = typeof quotePackingSlips.$inferSelect
