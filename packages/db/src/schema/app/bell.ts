/**
 * Bell program — rooms, fixture masters and room-by-room quotes.
 *
 * Bell and TJX share one shape (rooms, fixtures with parts, quantities, price
 * snapshots, two total triplets), so this file mirrors `tjx.ts` and the same
 * rules hold:
 *
 *  - A quote copies its rooms, fixtures, fixture parts and part prices at the
 *    moment they are selected. A later master edit never changes a quote.
 *  - Two total triplets are stored: with markup and without markup. Both are
 *    server-calculated snapshots, never posted by the client.
 *  - Work orders are linked by id, never duplicated.
 *  - Raw legacy codes are kept: quote status 1/3/4/5, grid type 1-4, payment
 *    terms 1/3/4/5. Labels live in the module's lifecycle file, not in a table.
 *
 * What is Bell-only: foot-candle readings per quote, the quote's attachment
 * folder and downloads, the legacy work-order number text, and the LED/Legacy
 * quote type. Bell has no subcontractor invoice, so there is no equivalent of
 * `tjx_sub_invoices`.
 *
 * Legacy data notes (2026-11 dump): `bell_quote_fixtures` holds one row per
 * form slot, and 886 of 1,212 rows are empty slots (fixture 0, no quantity).
 * Only the 326 real fixture lines become `bell_quote_fixtures`. A fixture id
 * above the master range (for example "CMH Extra") is a quote-only fixture,
 * stored with a null `fixture_id` and its snapshot name.
 */
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
import { sites } from './masterdata'
import { workOrders } from './workorder'

const money = (name: string) => numeric(name, { precision: 14, scale: 2 })
const price = (name: string) => numeric(name, { precision: 12, scale: 2 })
const quantity = (name: string) => numeric(name, { precision: 12, scale: 3 })
const factor = (name: string) => numeric(name, { precision: 12, scale: 4 })
const taxRate = (name: string) => numeric(name, { precision: 9, scale: 5 })

/* ------------------------------- room masters ------------------------------ */

export const bellRooms = app.table(
  'bell_rooms',
  {
    id: serial('id').primaryKey(),
    /** Legacy `bell_room.id`; null for a room created in the new system. */
    legacyId: integer('legacy_id'),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('bell_rooms_name_unique').on(sql`lower(${table.name})`),
    uniqueIndex('bell_rooms_legacy_unique').on(table.legacyId),
    index('bell_rooms_active_idx').on(table.isActive, table.sortOrder),
  ],
)

export const bellRoomTemplates = app.table(
  'bell_room_templates',
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
    uniqueIndex('bell_room_templates_name_unique').on(sql`lower(${table.name})`),
    uniqueIndex('bell_room_templates_default_unique')
      .on(table.isDefault)
      .where(sql`${table.isDefault}`),
  ],
)

export const bellRoomTemplateRooms = app.table(
  'bell_room_template_rooms',
  {
    id: serial('id').primaryKey(),
    templateId: integer('template_id')
      .notNull()
      .references(() => bellRoomTemplates.id, { onDelete: 'cascade' }),
    roomId: integer('room_id')
      .notNull()
      .references(() => bellRooms.id, { onDelete: 'restrict' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    // The legacy template lists a room more than once (21 rows, 13 rooms), so
    // the order, not the room, is what is unique.
    uniqueIndex('bell_room_template_rooms_order_unique').on(table.templateId, table.sortOrder),
    index('bell_room_template_rooms_room_idx').on(table.roomId),
  ],
)

/* ----------------------------- fixture masters ----------------------------- */

export const bellFixtures = app.table(
  'bell_fixtures',
  {
    id: serial('id').primaryKey(),
    /** Legacy `bell_fixture.id` (102-119 in the 2026-11 dump). */
    legacyId: integer('legacy_id'),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('bell_fixtures_name_unique').on(sql`lower(${table.name})`),
    uniqueIndex('bell_fixtures_legacy_unique').on(table.legacyId),
    index('bell_fixtures_active_idx').on(table.isActive, table.sortOrder),
  ],
)

export const bellFixtureParts = app.table(
  'bell_fixture_parts',
  {
    id: serial('id').primaryKey(),
    /** Legacy `bell_fixture_parts.id`. */
    legacyId: integer('legacy_id'),
    fixtureId: integer('fixture_id')
      .notNull()
      .references(() => bellFixtures.id, { onDelete: 'cascade' }),
    /** Canonical uppercase part number; validated against `app.parts` at save. */
    partNo: text('part_no').notNull(),
    /** Legacy `parttype`: Ballast, Lamp or empty. */
    partType: text('part_type').notNull().default(''),
    markup: factor('markup').notNull().default('1'),
    ratioPerFixture: factor('ratio_per_fixture').notNull().default('1'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    uniqueIndex('bell_fixture_parts_fixture_part_unique').on(table.fixtureId, table.partNo),
    index('bell_fixture_parts_fixture_idx').on(table.fixtureId, table.sortOrder),
    index('bell_fixture_parts_part_idx').on(table.partNo),
    check(
      'bell_fixture_parts_part_type_check',
      sql`${table.partType} in ('Ballast','Lamp','')`,
    ),
    check('bell_fixture_parts_markup_check', sql`${table.markup} > 0`),
    check('bell_fixture_parts_ratio_check', sql`${table.ratioPerFixture} >= 0`),
  ],
)

/* --------------------------------- quotes ---------------------------------- */

export const bellQuotes = app.table(
  'bell_quotes',
  {
    id: serial('id').primaryKey(),
    /** Legacy `bell_quote.id`; preserved because it is the quote number (5001+). */
    legacyId: integer('legacy_id'),
    siteId: integer('site_id').references(() => sites.id, { onDelete: 'set null' }),
    /** Derived from the site for display and search; never a billing FK. */
    customerId: integer('customer_id'),
    /** Raw status: 1 In Progress, 3 Waiting for Approval, 4 Approved, 5 Cancelled. */
    status: smallint('status').notNull().default(1),
    version: integer('version').notNull().default(1),
    /** LED or Legacy: which fixture family the quote prices. */
    quoteType: text('quote_type').notNull().default('LED'),
    /** Raw `ceiling_grid_type`: 1 A, 2 B, 3 C, 4 D. */
    ceilingGridType: smallint('ceiling_grid_type'),
    isTypeMaintenance: boolean('is_type_maintenance').notNull().default(false),
    /** Raw `bell_quote_payterms` code: 1, 3, 4 or 5. */
    paymentTermsCode: smallint('payment_terms_code'),
    dueDate: date('due_date'),
    /** Legacy free-text `workordernumber`; the linked rows below are authoritative. */
    workOrderNumber: text('work_order_number'),
    /** Legacy `bellquote_folder_attach_path`: where the quote's files live. */
    attachFolderPath: text('attach_folder_path'),
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
    uniqueIndex('bell_quotes_legacy_unique').on(table.legacyId),
    index('bell_quotes_status_updated_idx').on(table.status, table.updatedAt),
    index('bell_quotes_site_idx').on(table.siteId),
    index('bell_quotes_customer_idx').on(table.customerId),
    check('bell_quotes_status_check', sql`${table.status} in (1,3,4,5)`),
    check('bell_quotes_type_check', sql`${table.quoteType} in ('LED','Legacy')`),
    check(
      'bell_quotes_grid_check',
      sql`${table.ceilingGridType} is null or ${table.ceilingGridType} in (1,2,3,4)`,
    ),
    check(
      'bell_quotes_payterms_check',
      sql`${table.paymentTermsCode} is null or ${table.paymentTermsCode} in (1,3,4,5)`,
    ),
    check(
      'bell_quotes_tax_rate_check',
      sql`${table.appliedTaxRate} is null or (${table.appliedTaxRate} >= 0 and ${table.appliedTaxRate} <= 1)`,
    ),
    check(
      'bell_quotes_totals_check',
      sql`${table.subtotalAmount} >= 0 and ${table.taxAmount} >= 0 and ${table.totalAmount} >= 0 and ${table.withoutMarkupSubtotalAmount} >= 0 and ${table.withoutMarkupTaxAmount} >= 0 and ${table.withoutMarkupTotalAmount} >= 0`,
    ),
  ],
)

export const bellQuoteRooms = app.table(
  'bell_quote_rooms',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => bellQuotes.id, { onDelete: 'cascade' }),
    roomId: integer('room_id').references(() => bellRooms.id, { onDelete: 'set null' }),
    roomName: text('room_name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    uniqueIndex('bell_quote_rooms_order_unique').on(table.quoteId, table.sortOrder),
    index('bell_quote_rooms_quote_idx').on(table.quoteId),
  ],
)

export const bellQuoteFixtures = app.table(
  'bell_quote_fixtures',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => bellQuotes.id, { onDelete: 'cascade' }),
    quoteRoomId: integer('quote_room_id')
      .notNull()
      .references(() => bellQuoteRooms.id, { onDelete: 'cascade' }),
    /** Null for a quote-only fixture that has no master row. */
    fixtureId: integer('fixture_id').references(() => bellFixtures.id, { onDelete: 'set null' }),
    fixtureName: text('fixture_name').notNull(),
    quantity: quantity('quantity').notNull(),
    /** Legacy `fix_gallery_folder_name`: the photo folder for this fixture line. */
    galleryFolderName: text('gallery_folder_name'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    uniqueIndex('bell_quote_fixtures_order_unique').on(table.quoteRoomId, table.sortOrder),
    index('bell_quote_fixtures_quote_idx').on(table.quoteId),
    check('bell_quote_fixtures_qty_check', sql`${table.quantity} > 0`),
  ],
)

export const bellQuoteFixtureParts = app.table(
  'bell_quote_fixture_parts',
  {
    id: serial('id').primaryKey(),
    quoteFixtureId: integer('quote_fixture_id')
      .notNull()
      .references(() => bellQuoteFixtures.id, { onDelete: 'cascade' }),
    fixturePartId: integer('fixture_part_id').references(() => bellFixtureParts.id, {
      onDelete: 'set null',
    }),
    partNo: text('part_no').notNull(),
    partType: text('part_type').notNull().default(''),
    markup: factor('markup').notNull(),
    ratioPerFixture: factor('ratio_per_fixture').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    uniqueIndex('bell_quote_fixture_parts_unique').on(table.quoteFixtureId, table.partNo),
    index('bell_quote_fixture_parts_fixture_idx').on(table.quoteFixtureId),
    check('bell_quote_fixture_parts_markup_check', sql`${table.markup} > 0`),
    check('bell_quote_fixture_parts_ratio_check', sql`${table.ratioPerFixture} >= 0`),
  ],
)

export const bellQuotePrices = app.table(
  'bell_quote_prices',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => bellQuotes.id, { onDelete: 'cascade' }),
    partNo: text('part_no').notNull(),
    price: price('price').notNull(),
    previousPrice: price('previous_price'),
    /** snapshot | override | imported */
    source: text('source').notNull().default('snapshot'),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('bell_quote_prices_quote_part_unique').on(table.quoteId, table.partNo),
    check('bell_quote_prices_price_check', sql`${table.price} >= 0`),
    check(
      'bell_quote_prices_source_check',
      sql`${table.source} in ('snapshot','override','imported')`,
    ),
  ],
)

export const bellQuoteParts = app.table(
  'bell_quote_parts',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => bellQuotes.id, { onDelete: 'cascade' }),
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
    uniqueIndex('bell_quote_parts_quote_part_unique').on(table.quoteId, table.partNo),
    index('bell_quote_parts_quote_idx').on(table.quoteId, table.sortOrder),
    index('bell_quote_parts_part_idx').on(table.partNo),
    check(
      'bell_quote_parts_qty_check',
      sql`${table.qtyWithMarkup} >= 0 and ${table.qtyWithoutMarkup} >= 0`,
    ),
    check('bell_quote_parts_origin_check', sql`${table.origin} in ('calculated','legacy')`),
  ],
)

export const bellQuoteSpecialParts = app.table(
  'bell_quote_special_parts',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => bellQuotes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    quantity: quantity('quantity').notNull(),
    unitPrice: price('unit_price').notNull(),
    lineSubtotal: money('line_subtotal').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    index('bell_quote_special_parts_quote_idx').on(table.quoteId, table.sortOrder),
    check('bell_quote_special_parts_qty_check', sql`${table.quantity} > 0`),
  ],
)

export const bellQuoteWorkOrders = app.table(
  'bell_quote_work_orders',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => bellQuotes.id, { onDelete: 'cascade' }),
    workOrderId: integer('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'restrict' }),
    isPrimary: boolean('is_primary').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    linkedBy: uuid('linked_by'),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('bell_quote_wos_quote_wo_unique').on(table.quoteId, table.workOrderId),
    uniqueIndex('bell_quote_wos_primary_unique')
      .on(table.quoteId)
      .where(sql`${table.isPrimary}`),
    index('bell_quote_wos_wo_idx').on(table.workOrderId),
  ],
)

export const bellQuoteRevisions = app.table(
  'bell_quote_revisions',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => bellQuotes.id, { onDelete: 'cascade' }),
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
    uniqueIndex('bell_quote_revisions_quote_seq_unique').on(table.quoteId, table.saveSeq),
    index('bell_quote_revisions_quote_idx').on(table.quoteId, table.createdAt),
    check(
      'bell_quote_revisions_type_check',
      sql`${table.revisionType} in ('insert','update','submit','approve','cancel','refresh_prices','email','import')`,
    ),
  ],
)

/* ----------------------- Bell-only: files and readings ---------------------- */

export const bellQuoteDownloads = app.table(
  'bell_quote_downloads',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => bellQuotes.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    folderName: text('folder_name'),
    /** Legacy `downloadbyname`: a display name, not a user id. */
    downloadedByName: text('downloaded_by_name'),
    revisionNotes: text('revision_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('bell_quote_downloads_quote_idx').on(table.quoteId, table.createdAt)],
)

/**
 * Foot-candle readings taken in a room before the retrofit. The legacy columns
 * are a 3x3 grid (front/centre/back by right/centre/left) plus two feature
 * readings; their abbreviations are kept because the PDF prints them that way.
 */
export const bellFootCandleReadings = app.table(
  'bell_foot_candle_readings',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => bellQuotes.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    frReading: text('fr_reading'),
    fcReading: text('fc_reading'),
    flReading: text('fl_reading'),
    crReading: text('cr_reading'),
    cReading: text('c_reading'),
    clReading: text('cl_reading'),
    brReading: text('br_reading'),
    bcReading: text('bc_reading'),
    blReading: text('bl_reading'),
    ftrReading: text('ftr_reading'),
    ftrStallReading: text('ftr_stall_reading'),
  },
  (table) => [index('bell_foot_candle_readings_quote_idx').on(table.quoteId, table.sortOrder)],
)
