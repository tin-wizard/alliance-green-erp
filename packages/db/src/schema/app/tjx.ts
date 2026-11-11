/**
 * TJX fixture program — rooms, fixture masters, quotes and subcontractor invoices.
 *
 * This is the forward model for the retail-account flow. Everything the legacy
 * system derived from hidden form fields is a stored snapshot here:
 *
 *  - A quote copies its rooms, fixtures, fixture parts and part prices at the
 *    moment they are selected. A later master edit never changes a quote.
 *  - Two total triplets are stored: with markup and without markup. Both are
 *    server-calculated snapshots, never posted by the client.
 *  - Work orders are linked by id, never duplicated. There is no `tjx_wo_parts`
 *    table; work-order parts stay in the Work Orders module.
 *  - A TJX subcontractor invoice is a field-progress document that hands its
 *    financial document to Invoicing. The three checklist flags gate submit.
 *
 * Raw legacy codes are kept: quote status 1/3/4/5, grid type 1-4, payment terms
 * 1/3/4/5. Labels live in the module's `lifecycle.ts`, not in the table.
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
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
import { subcontractorInvoices } from './invoicing'
import { sites, subcontractors } from './masterdata'
import { workOrderDocuments, workOrders } from './workorder'

const money = (name: string) => numeric(name, { precision: 14, scale: 2 })
const price = (name: string) => numeric(name, { precision: 12, scale: 2 })
const quantity = (name: string) => numeric(name, { precision: 12, scale: 3 })
const factor = (name: string) => numeric(name, { precision: 12, scale: 4 })
const taxRate = (name: string) => numeric(name, { precision: 9, scale: 5 })

/* ------------------------------- room masters ------------------------------ */

export const tjxRooms = app.table(
  'tjx_rooms',
  {
    id: serial('id').primaryKey(),
    /** Legacy `tjx_room.id`; null for a room created in the new system. */
    legacyId: integer('legacy_id'),
    name: text('name').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tjx_rooms_name_unique').on(sql`lower(${table.name})`),
    uniqueIndex('tjx_rooms_legacy_unique').on(table.legacyId),
    index('tjx_rooms_active_idx').on(table.isActive, table.sortOrder),
  ],
)

export const tjxRoomTemplates = app.table(
  'tjx_room_templates',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tjx_room_templates_name_unique').on(sql`lower(${table.name})`),
    uniqueIndex('tjx_room_templates_default_unique')
      .on(table.isDefault)
      .where(sql`${table.isDefault}`),
  ],
)

export const tjxRoomTemplateRooms = app.table(
  'tjx_room_template_rooms',
  {
    id: serial('id').primaryKey(),
    templateId: integer('template_id')
      .notNull()
      .references(() => tjxRoomTemplates.id, { onDelete: 'cascade' }),
    roomId: integer('room_id')
      .notNull()
      .references(() => tjxRooms.id, { onDelete: 'restrict' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    uniqueIndex('tjx_room_template_rooms_unique').on(table.templateId, table.roomId),
    uniqueIndex('tjx_room_template_rooms_order_unique').on(table.templateId, table.sortOrder),
    index('tjx_room_template_rooms_room_idx').on(table.roomId),
  ],
)

/* ----------------------------- fixture masters ----------------------------- */

export const tjxFixtures = app.table(
  'tjx_fixtures',
  {
    id: serial('id').primaryKey(),
    /** Legacy `tjx_fixture.id`. */
    legacyId: integer('legacy_id'),
    name: text('name').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tjx_fixtures_name_unique').on(sql`lower(${table.name})`),
    uniqueIndex('tjx_fixtures_legacy_unique').on(table.legacyId),
    index('tjx_fixtures_active_idx').on(table.isActive, table.sortOrder),
  ],
)

export const tjxFixtureParts = app.table(
  'tjx_fixture_parts',
  {
    id: serial('id').primaryKey(),
    /** Legacy `tjx_fixture_parts.id`. */
    legacyId: integer('legacy_id'),
    fixtureId: integer('fixture_id')
      .notNull()
      .references(() => tjxFixtures.id, { onDelete: 'cascade' }),
    /** Canonical uppercase part number; validated against `app.parts` at save. */
    partNo: text('part_no').notNull(),
    /** Legacy `parttype`: Ballast, Lamp or empty. */
    partType: text('part_type').notNull().default(''),
    markup: factor('markup').notNull().default('1'),
    ratioPerFixture: factor('ratio_per_fixture').notNull().default('1'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    uniqueIndex('tjx_fixture_parts_fixture_part_unique').on(table.fixtureId, table.partNo),
    index('tjx_fixture_parts_fixture_idx').on(table.fixtureId, table.sortOrder),
    index('tjx_fixture_parts_part_idx').on(table.partNo),
    check(
      'tjx_fixture_parts_part_type_check',
      sql`${table.partType} in ('Ballast','Lamp','')`,
    ),
    check('tjx_fixture_parts_markup_check', sql`${table.markup} > 0`),
    check('tjx_fixture_parts_ratio_check', sql`${table.ratioPerFixture} >= 0`),
  ],
)

export const tjxSubcontractorRates = app.table(
  'tjx_subcontractor_rates',
  {
    id: serial('id').primaryKey(),
    /** Legacy `tjx_subcontractor_rates.id`. */
    legacyId: integer('legacy_id'),
    subcontractorId: integer('subcontractor_id')
      .notNull()
      .references(() => subcontractors.id, { onDelete: 'cascade' }),
    partNo: text('part_no').notNull(),
    installCostPerUnit: price('install_cost_per_unit').notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tjx_rates_sub_part_unique').on(table.subcontractorId, table.partNo),
    uniqueIndex('tjx_rates_legacy_unique').on(table.legacyId),
    index('tjx_rates_sub_idx').on(table.subcontractorId),
    index('tjx_rates_part_idx').on(table.partNo),
    check('tjx_rates_cost_check', sql`${table.installCostPerUnit} >= 0`),
  ],
)

/* --------------------------------- quotes ---------------------------------- */

export const tjxQuotes = app.table(
  'tjx_quotes',
  {
    id: serial('id').primaryKey(),
    /** Legacy `tjx_quote.id`; preserved because it is the quote number. */
    legacyId: integer('legacy_id'),
    siteId: integer('site_id').references(() => sites.id, { onDelete: 'set null' }),
    /** Derived from the site for display and search; never a billing FK. */
    customerId: integer('customer_id'),
    /** Raw status: 1 In Progress, 3 Waiting for Approval, 4 Approved, 5 Cancelled. */
    status: smallint('status').notNull().default(1),
    version: integer('version').notNull().default(1),
    quoteType: text('quote_type').notNull().default('Gen 1'),
    /** Raw `ceiling_grid_type`: 1 A, 2 B, 3 C, 4 Highbay. */
    ceilingGridType: smallint('ceiling_grid_type'),
    isTypeMaintenance: boolean('is_type_maintenance').notNull().default(false),
    /** Raw `tjx_quote_payterms` code: 1, 3, 4 or 5. */
    paymentTermsCode: smallint('payment_terms_code'),
    dueDate: date('due_date'),
    shipToType: text('ship_to_type'),
    shipContactName: text('ship_contact_name'),
    shipCompany: text('ship_company'),
    shipStreet1: text('ship_street_1'),
    shipStreet2: text('ship_street_2'),
    shipCity: text('ship_city'),
    shipProvince: text('ship_province'),
    shipPostalCode: text('ship_postal_code'),
    shipPhone: text('ship_phone'),
    /** Legacy free-text override; the structured fields are authoritative. */
    shippingAddress: text('shipping_address'),
    taxCode: text('tax_code'),
    taxProvince: text('tax_province'),
    appliedTaxRate: taxRate('applied_tax_rate'),
    subtotalAmount: money('subtotal_amount').notNull().default('0'),
    taxAmount: money('tax_amount').notNull().default('0'),
    totalAmount: money('total_amount').notNull().default('0'),
    withoutMarkupSubtotalAmount: money('without_markup_subtotal_amount').notNull().default('0'),
    withoutMarkupTaxAmount: money('without_markup_tax_amount').notNull().default('0'),
    withoutMarkupTotalAmount: money('without_markup_total_amount').notNull().default('0'),
    notes: text('notes'),
    pdfNotes: text('pdf_notes'),
    revisionNotes: text('revision_notes'),
    revisionNo: integer('revision_no').notNull().default(0),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    importedAt: timestamp('imported_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tjx_quotes_legacy_unique').on(table.legacyId),
    index('tjx_quotes_status_updated_idx').on(table.status, table.updatedAt),
    index('tjx_quotes_site_idx').on(table.siteId),
    index('tjx_quotes_customer_idx').on(table.customerId),
    check('tjx_quotes_status_check', sql`${table.status} in (1,3,4,5)`),
    check(
      'tjx_quotes_grid_check',
      sql`${table.ceilingGridType} is null or ${table.ceilingGridType} in (1,2,3,4)`,
    ),
    check(
      'tjx_quotes_payterms_check',
      sql`${table.paymentTermsCode} is null or ${table.paymentTermsCode} in (1,3,4,5)`,
    ),
    check(
      'tjx_quotes_tax_rate_check',
      sql`${table.appliedTaxRate} is null or (${table.appliedTaxRate} >= 0 and ${table.appliedTaxRate} <= 1)`,
    ),
    check(
      'tjx_quotes_totals_check',
      sql`${table.subtotalAmount} >= 0 and ${table.taxAmount} >= 0 and ${table.totalAmount} >= 0 and ${table.withoutMarkupSubtotalAmount} >= 0 and ${table.withoutMarkupTaxAmount} >= 0 and ${table.withoutMarkupTotalAmount} >= 0`,
    ),
  ],
)

export const tjxQuoteRooms = app.table(
  'tjx_quote_rooms',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => tjxQuotes.id, { onDelete: 'cascade' }),
    roomId: integer('room_id').references(() => tjxRooms.id, { onDelete: 'set null' }),
    roomName: text('room_name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    uniqueIndex('tjx_quote_rooms_order_unique').on(table.quoteId, table.sortOrder),
    index('tjx_quote_rooms_quote_idx').on(table.quoteId),
  ],
)

export const tjxQuoteFixtures = app.table(
  'tjx_quote_fixtures',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => tjxQuotes.id, { onDelete: 'cascade' }),
    quoteRoomId: integer('quote_room_id')
      .notNull()
      .references(() => tjxQuoteRooms.id, { onDelete: 'cascade' }),
    fixtureId: integer('fixture_id').references(() => tjxFixtures.id, { onDelete: 'set null' }),
    fixtureName: text('fixture_name').notNull(),
    quantity: quantity('quantity').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    uniqueIndex('tjx_quote_fixtures_order_unique').on(table.quoteRoomId, table.sortOrder),
    index('tjx_quote_fixtures_quote_idx').on(table.quoteId),
    check('tjx_quote_fixtures_qty_check', sql`${table.quantity} > 0`),
  ],
)

export const tjxQuoteFixtureParts = app.table(
  'tjx_quote_fixture_parts',
  {
    id: serial('id').primaryKey(),
    quoteFixtureId: integer('quote_fixture_id')
      .notNull()
      .references(() => tjxQuoteFixtures.id, { onDelete: 'cascade' }),
    fixturePartId: integer('fixture_part_id').references(() => tjxFixtureParts.id, {
      onDelete: 'set null',
    }),
    partNo: text('part_no').notNull(),
    partType: text('part_type').notNull().default(''),
    markup: factor('markup').notNull(),
    ratioPerFixture: factor('ratio_per_fixture').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    uniqueIndex('tjx_quote_fixture_parts_unique').on(table.quoteFixtureId, table.partNo),
    index('tjx_quote_fixture_parts_fixture_idx').on(table.quoteFixtureId),
    check('tjx_quote_fixture_parts_markup_check', sql`${table.markup} > 0`),
    check('tjx_quote_fixture_parts_ratio_check', sql`${table.ratioPerFixture} >= 0`),
  ],
)

export const tjxQuotePrices = app.table(
  'tjx_quote_prices',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => tjxQuotes.id, { onDelete: 'cascade' }),
    partNo: text('part_no').notNull(),
    price: price('price').notNull(),
    previousPrice: price('previous_price'),
    /** snapshot | override | imported */
    source: text('source').notNull().default('snapshot'),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tjx_quote_prices_quote_part_unique').on(table.quoteId, table.partNo),
    check('tjx_quote_prices_price_check', sql`${table.price} >= 0`),
    check(
      'tjx_quote_prices_source_check',
      sql`${table.source} in ('snapshot','override','imported')`,
    ),
  ],
)

export const tjxQuoteParts = app.table(
  'tjx_quote_parts',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => tjxQuotes.id, { onDelete: 'cascade' }),
    partNo: text('part_no').notNull(),
    description: text('description'),
    qtyWithMarkup: quantity('qty_with_markup').notNull(),
    qtyWithoutMarkup: quantity('qty_without_markup').notNull(),
    unitPrice: price('unit_price').notNull(),
    lineSubtotal: money('line_subtotal').notNull(),
    lineSubtotalWithoutMarkup: money('line_subtotal_without_markup').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    /** calculated | legacy */
    origin: text('origin').notNull().default('calculated'),
  },
  (table) => [
    uniqueIndex('tjx_quote_parts_quote_part_unique').on(table.quoteId, table.partNo),
    index('tjx_quote_parts_quote_idx').on(table.quoteId, table.sortOrder),
    index('tjx_quote_parts_part_idx').on(table.partNo),
    check(
      'tjx_quote_parts_qty_check',
      sql`${table.qtyWithMarkup} >= 0 and ${table.qtyWithoutMarkup} >= 0`,
    ),
    check('tjx_quote_parts_origin_check', sql`${table.origin} in ('calculated','legacy')`),
  ],
)

export const tjxQuoteSpecialParts = app.table(
  'tjx_quote_special_parts',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => tjxQuotes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    quantity: quantity('quantity').notNull(),
    unitPrice: price('unit_price').notNull(),
    lineSubtotal: money('line_subtotal').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    index('tjx_quote_special_parts_quote_idx').on(table.quoteId, table.sortOrder),
    check('tjx_quote_special_parts_qty_check', sql`${table.quantity} > 0`),
  ],
)

export const tjxQuoteWorkOrders = app.table(
  'tjx_quote_work_orders',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => tjxQuotes.id, { onDelete: 'cascade' }),
    workOrderId: integer('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'restrict' }),
    isPrimary: boolean('is_primary').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    linkedBy: uuid('linked_by'),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tjx_quote_wos_quote_wo_unique').on(table.quoteId, table.workOrderId),
    uniqueIndex('tjx_quote_wos_primary_unique')
      .on(table.quoteId)
      .where(sql`${table.isPrimary}`),
    index('tjx_quote_wos_wo_idx').on(table.workOrderId),
  ],
)

export const tjxQuoteRevisions = app.table(
  'tjx_quote_revisions',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => tjxQuotes.id, { onDelete: 'cascade' }),
    saveSeq: integer('save_seq').notNull(),
    revisionNo: integer('revision_no').notNull().default(0),
    /** insert | update | submit | approve | cancel | refresh_prices | email | import */
    revisionType: text('revision_type').notNull(),
    revisedBy: uuid('revised_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    dataQuote: jsonb('data_quote').$type<Record<string, unknown>>().notNull(),
    dataRooms: jsonb('data_rooms').$type<Record<string, unknown>[]>().notNull(),
    dataFixtures: jsonb('data_fixtures').$type<Record<string, unknown>[]>().notNull(),
    dataParts: jsonb('data_parts').$type<Record<string, unknown>[]>().notNull(),
    dataSpecialParts: jsonb('data_special_parts').$type<Record<string, unknown>[]>().notNull(),
    notes: text('notes'),
  },
  (table) => [
    uniqueIndex('tjx_quote_revisions_quote_seq_unique').on(table.quoteId, table.saveSeq),
    index('tjx_quote_revisions_quote_idx').on(table.quoteId, table.createdAt),
    check(
      'tjx_quote_revisions_type_check',
      sql`${table.revisionType} in ('insert','update','submit','approve','cancel','refresh_prices','email','import')`,
    ),
  ],
)

/* -------------------------- subcontractor invoices ------------------------- */

export const tjxSubInvoices = app.table(
  'tjx_sub_invoices',
  {
    id: serial('id').primaryKey(),
    /** Legacy `tjx_sub_invoice.id`. */
    legacyId: integer('legacy_id'),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => tjxQuotes.id, { onDelete: 'restrict' }),
    workOrderId: integer('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'restrict' }),
    subcontractorId: integer('subcontractor_id')
      .notNull()
      .references(() => subcontractors.id, { onDelete: 'restrict' }),
    invoiceNumber: text('invoice_number').notNull(),
    invoiceDate: date('invoice_date').notNull(),
    taxCode: text('tax_code'),
    taxProvince: text('tax_province'),
    appliedTaxRate: taxRate('applied_tax_rate'),
    subtotalAmount: money('subtotal_amount').notNull().default('0'),
    taxAmount: money('tax_amount').notNull().default('0'),
    taxGst: money('tax_gst').notNull().default('0'),
    taxPst: money('tax_pst').notNull().default('0'),
    totalAmount: money('total_amount').notNull().default('0'),
    notes: text('notes'),
    subNotes: text('sub_notes'),
    chkProjectReading: boolean('chk_project_reading').notNull().default(false),
    chkProjectPhotos: boolean('chk_project_photos').notNull().default(false),
    chkProjectSignoff: boolean('chk_project_signoff').notNull().default(false),
    isSubmitted: boolean('is_submitted').notNull().default(false),
    rejectedCount: integer('rejected_count').notNull().default(0),
    subcontractorInvoiceId: bigint('subcontractor_invoice_id', { mode: 'number' }).references(
      () => subcontractorInvoices.id,
      { onDelete: 'set null' },
    ),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    importedAt: timestamp('imported_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tjx_sub_invoices_wo_number_unique').on(table.workOrderId, table.invoiceNumber),
    uniqueIndex('tjx_sub_invoices_legacy_unique').on(table.legacyId),
    index('tjx_sub_invoices_quote_idx').on(table.quoteId),
    index('tjx_sub_invoices_sub_idx').on(table.subcontractorId, table.createdAt),
    check(
      'tjx_sub_invoices_totals_check',
      sql`${table.subtotalAmount} >= 0 and ${table.taxAmount} >= 0 and ${table.taxGst} >= 0 and ${table.taxPst} >= 0 and ${table.totalAmount} >= 0`,
    ),
    check('tjx_sub_invoices_rejected_check', sql`${table.rejectedCount} >= 0`),
    check(
      'tjx_sub_invoices_tax_rate_check',
      sql`${table.appliedTaxRate} is null or (${table.appliedTaxRate} >= 0 and ${table.appliedTaxRate} <= 1)`,
    ),
  ],
)

export const tjxSubInvoiceFixtures = app.table(
  'tjx_sub_invoice_fixtures',
  {
    id: serial('id').primaryKey(),
    subInvoiceId: integer('sub_invoice_id')
      .notNull()
      .references(() => tjxSubInvoices.id, { onDelete: 'cascade' }),
    quoteFixtureId: integer('quote_fixture_id').references(() => tjxQuoteFixtures.id, {
      onDelete: 'set null',
    }),
    roomName: text('room_name').notNull(),
    fixtureName: text('fixture_name').notNull(),
    quotedQuantity: quantity('quoted_quantity').notNull(),
    installedQuantity: quantity('installed_quantity').notNull(),
    discrepancyNotes: text('discrepancy_notes'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    uniqueIndex('tjx_sub_invoice_fixtures_order_unique').on(table.subInvoiceId, table.sortOrder),
    index('tjx_sub_invoice_fixtures_invoice_idx').on(table.subInvoiceId),
    check(
      'tjx_sub_invoice_fixtures_qty_check',
      sql`${table.quotedQuantity} >= 0 and ${table.installedQuantity} >= 0`,
    ),
  ],
)

export const tjxSubInvoiceParts = app.table(
  'tjx_sub_invoice_parts',
  {
    id: serial('id').primaryKey(),
    subInvoiceId: integer('sub_invoice_id')
      .notNull()
      .references(() => tjxSubInvoices.id, { onDelete: 'cascade' }),
    quotePartId: integer('quote_part_id').references(() => tjxQuoteParts.id, {
      onDelete: 'set null',
    }),
    partNo: text('part_no').notNull(),
    description: text('description'),
    quantity: quantity('quantity').notNull(),
    unitRate: price('unit_rate').notNull(),
    lineSubtotal: money('line_subtotal').notNull(),
    /** quoted_part | fixture_part | imported */
    rateSource: text('rate_source').notNull().default('quoted_part'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    uniqueIndex('tjx_sub_invoice_parts_invoice_part_unique').on(
      table.subInvoiceId,
      table.partNo,
    ),
    index('tjx_sub_invoice_parts_invoice_idx').on(table.subInvoiceId, table.sortOrder),
    check('tjx_sub_invoice_parts_qty_check', sql`${table.quantity} >= 0`),
    check('tjx_sub_invoice_parts_rate_check', sql`${table.unitRate} >= 0`),
    check(
      'tjx_sub_invoice_parts_source_check',
      sql`${table.rateSource} in ('quoted_part','fixture_part','imported')`,
    ),
  ],
)

export const tjxSubInvoiceDocuments = app.table(
  'tjx_sub_invoice_documents',
  {
    id: serial('id').primaryKey(),
    subInvoiceId: integer('sub_invoice_id')
      .notNull()
      .references(() => tjxSubInvoices.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => workOrderDocuments.id, { onDelete: 'cascade' }),
    /** post_project_fc_reading | post_project_photos | signed_work_order */
    kind: text('kind').notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('tjx_sub_invoice_documents_unique').on(
      table.subInvoiceId,
      table.kind,
      table.documentId,
    ),
    index('tjx_sub_invoice_documents_invoice_idx').on(table.subInvoiceId, table.kind),
    check(
      'tjx_sub_invoice_documents_kind_check',
      sql`${table.kind} in ('post_project_fc_reading','post_project_photos','signed_work_order')`,
    ),
  ],
)

export const tjxSubInvoiceSubmissions = app.table(
  'tjx_sub_invoice_submissions',
  {
    id: serial('id').primaryKey(),
    subInvoiceId: integer('sub_invoice_id')
      .notNull()
      .references(() => tjxSubInvoices.id, { onDelete: 'cascade' }),
    revisionNo: integer('revision_no').notNull(),
    subcontractorInvoiceId: bigint('subcontractor_invoice_id', { mode: 'number' }).references(
      () => subcontractorInvoices.id,
      { onDelete: 'set null' },
    ),
    submittedBy: uuid('submitted_by'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    /** submitted | approved | rejected */
    outcome: text('outcome').notNull().default('submitted'),
    rejectionReason: text('rejection_reason'),
  },
  (table) => [
    uniqueIndex('tjx_sub_invoice_submissions_unique').on(table.subInvoiceId, table.revisionNo),
    index('tjx_sub_invoice_submissions_invoice_idx').on(table.subInvoiceId, table.submittedAt),
    check(
      'tjx_sub_invoice_submissions_outcome_check',
      sql`${table.outcome} in ('submitted','approved','rejected')`,
    ),
  ],
)

export const tjxSubInvoiceRevisions = app.table(
  'tjx_sub_invoice_revisions',
  {
    id: serial('id').primaryKey(),
    subInvoiceId: integer('sub_invoice_id')
      .notNull()
      .references(() => tjxSubInvoices.id, { onDelete: 'cascade' }),
    revisionNo: integer('revision_no').notNull().default(0),
    /** insert | update | submit | reject | approve | import */
    revisionType: text('revision_type').notNull(),
    revisedBy: uuid('revised_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    dataInvoice: jsonb('data_invoice').$type<Record<string, unknown>>().notNull(),
    dataFixtures: jsonb('data_fixtures').$type<Record<string, unknown>[]>().notNull(),
    dataParts: jsonb('data_parts').$type<Record<string, unknown>[]>().notNull(),
  },
  (table) => [
    index('tjx_sub_invoice_revisions_invoice_idx').on(table.subInvoiceId, table.createdAt),
    check(
      'tjx_sub_invoice_revisions_type_check',
      sql`${table.revisionType} in ('insert','update','submit','reject','approve','import')`,
    ),
  ],
)

/* ---------------------------------- types ---------------------------------- */

export type TjxRoom = typeof tjxRooms.$inferSelect
export type TjxRoomTemplate = typeof tjxRoomTemplates.$inferSelect
export type TjxRoomTemplateRoom = typeof tjxRoomTemplateRooms.$inferSelect
export type TjxFixture = typeof tjxFixtures.$inferSelect
export type TjxFixturePart = typeof tjxFixtureParts.$inferSelect
export type TjxSubcontractorRate = typeof tjxSubcontractorRates.$inferSelect
export type TjxQuote = typeof tjxQuotes.$inferSelect
export type TjxQuoteRoom = typeof tjxQuoteRooms.$inferSelect
export type TjxQuoteFixture = typeof tjxQuoteFixtures.$inferSelect
export type TjxQuoteFixturePart = typeof tjxQuoteFixtureParts.$inferSelect
export type TjxQuotePrice = typeof tjxQuotePrices.$inferSelect
export type TjxQuotePart = typeof tjxQuoteParts.$inferSelect
export type TjxQuoteSpecialPart = typeof tjxQuoteSpecialParts.$inferSelect
export type TjxQuoteWorkOrder = typeof tjxQuoteWorkOrders.$inferSelect
export type TjxQuoteRevision = typeof tjxQuoteRevisions.$inferSelect
export type TjxSubInvoice = typeof tjxSubInvoices.$inferSelect
export type TjxSubInvoiceFixture = typeof tjxSubInvoiceFixtures.$inferSelect
export type TjxSubInvoicePart = typeof tjxSubInvoiceParts.$inferSelect
export type TjxSubInvoiceDocument = typeof tjxSubInvoiceDocuments.$inferSelect
export type TjxSubInvoiceSubmission = typeof tjxSubInvoiceSubmissions.$inferSelect
export type TjxSubInvoiceRevision = typeof tjxSubInvoiceRevisions.$inferSelect
