// @generated
// Source: packages/db/contract/schema.json (2026-11-11).
// Do not edit by hand. Run `pnpm db:generate:schema` after updating the contract.
// Domain: tjx

import { index, integer, numeric, pgEnum, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'
export const legacyEnumTjxFixturePartsParttype = pgEnum('legacy_tjx_fixture_parts_parttype', ["Ballast", "Lamp", ""])
export const legacyEnumTjxFixturePartsPerQuoteParttype = pgEnum('legacy_tjx_fixture_parts_per_quote_parttype', ["Ballast", "Lamp", ""])

/**
 * tjx_fixture — Fixture master (name, sort order).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxFixture = pgTable(
  'tjx_fixture',
  {
    id: serial('id').primaryKey(),
    fixturename: varchar('fixturename', { length: 80 }),
    sortorder: integer('sortorder'),
  },
)

/**
 * tjx_room — Room master (name, sort order) used by TJX quotes.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxRoom = pgTable(
  'tjx_room',
  {
    id: serial('id').primaryKey(),
    roomname: varchar('roomname', { length: 80 }),
    sortorder: integer('sortorder'),
  },
)

/**
 * tjx_fixture_parts — Parts that make up a fixture, with per-part markup and ratio per fixture.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxFixtureParts = pgTable(
  'tjx_fixture_parts',
  {
    id: serial('id').primaryKey(),
    partno: varchar('partno', { length: 30 }),
    fixtureid: integer('fixtureid'),
    markup: varchar('markup', { length: 10 }),
    parttype: legacyEnumTjxFixturePartsParttype('parttype'),
    partRatioPerfixture: varchar('part_ratio_perfixture', { length: 20 }),
  },
)

/**
 * tjx_fixture_parts_per_quote — Fixture parts instantiated on a quote.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxFixturePartsPerQuote = pgTable(
  'tjx_fixture_parts_per_quote',
  {
    id: serial('id').primaryKey(),
    partno: varchar('partno', { length: 30 }),
    quoteid: integer('quoteid').notNull(),
    fixtureid: integer('fixtureid'),
    markup: varchar('markup', { length: 10 }),
    parttype: legacyEnumTjxFixturePartsPerQuoteParttype('parttype'),
    partRatioPerfixture: varchar('part_ratio_perfixture', { length: 20 }),
  },
)

/**
 * tjx_fixture_per_quote — Fixtures instantiated on a quote.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxFixturePerQuote = pgTable(
  'tjx_fixture_per_quote',
  {
    id: serial('id').primaryKey(),
    fixtureid: integer('fixtureid'),
    quoteid: integer('quoteid'),
    fixturename: varchar('fixturename', { length: 80 }),
    sortorder: integer('sortorder'),
  },
)

/**
 * tjx_prices_per_quote — Per-quote price overrides for TJX parts.
 * Rows observed: 6964. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxPricesPerQuote = pgTable(
  'tjx_prices_per_quote',
  {
    id: serial('id').primaryKey(),
    quoteid: integer('quoteid').notNull(),
    partno: varchar('partno', { length: 20 }).notNull(),
    price: varchar('price', { length: 25 }),
    lastPrice: varchar('last_price', { length: 25 }),
  },
)

/**
 * tjx_quote — TJX fixture quote header. Carries totals twice: with markup and `withoutmarkup_*`.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxQuote = pgTable(
  'tjx_quote',
  {
    id: serial('id').primaryKey(),
    status: integer('status'),
    pdfNotes: text('pdf_notes'),
    notes: text('notes'),
    dueDate: varchar('due_date', { length: 15 }),
    paymentTerms: integer('payment_terms'),
    ceilingGridType: integer('ceiling_grid_type'),
    shipAddressContactname: text('ship_address_contactname'),
    shipAddressCompany: text('ship_address_company'),
    shipAddressStreet1: text('ship_address_street1'),
    shipAddressStreet2: text('ship_address_street2'),
    shipAddressCity: text('ship_address_city'),
    shipAddressProvince: text('ship_address_province'),
    shipAddressPostalcode: text('ship_address_postalcode'),
    shipAddressPhone: text('ship_address_phone'),
    shippingAddress: text('shipping_address'),
    createdby: integer('createdby'),
    dateCreated: timestamp('date_created', { mode: 'string', withTimezone: false }),
    tjxquoteFolderAttachPath: varchar('tjxquote_folder_attach_path', { length: 200 }),
    revisionNo: integer('revision_no'),
    isSubmitted: integer('is_submitted'),
    shipToType: varchar('ship_to_type', { length: 15 }),
    site: integer('site'),
    workordernumber: varchar('workordernumber', { length: 20 }),
    taxCode: varchar('tax_code', { length: 12 }),
    taxAmount: varchar('tax_amount', { length: 15 }),
    subtotalAmount: varchar('subtotal_amount', { length: 15 }),
    totalAmount: varchar('total_amount', { length: 15 }),
    withoutmarkupTaxAmount: varchar('withoutmarkup_tax_amount', { length: 15 }),
    withoutmarkupSubtotalAmount: varchar('withoutmarkup_subtotal_amount', { length: 15 }),
    withoutmarkupTotalAmount: varchar('withoutmarkup_total_amount', { length: 15 }),
    // cost-side total; must reconcile with total_amount through the recorded markup
    revisionNotes: text('revision_notes'),
    quoteType: varchar('quote_type', { length: 15 }),
    appliedtaxrate: varchar('appliedtaxrate', { length: 12 }),
    isTypeMaintenance: integer('is_type_maintenance'),
  },
)

/**
 * tjx_quote_downloads — Generated TJX quote PDF download records.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxQuoteDownloads = pgTable(
  'tjx_quote_downloads',
  {
    id: serial('id').primaryKey(),
    quoteid: integer('quoteid'),
    filename: varchar('filename', { length: 50 }),
    downloadbyname: varchar('downloadbyname', { length: 30 }),
    foldername: varchar('foldername', { length: 20 }),
    datecreated: timestamp('datecreated', { mode: 'string', withTimezone: false }),
    downloadRevisionNotes: text('download_revision_notes'),
  },
)

/**
 * tjx_quote_extra_workorders — Additional work orders attached to a TJX quote.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxQuoteExtraWorkorders = pgTable(
  'tjx_quote_extra_workorders',
  {
    id: serial('id').primaryKey(),
    quoteid: integer('quoteid'),
    woid: integer('woid'),
    isProjectWorkorder: integer('is_project_workorder'),
    sortorder: integer('sortorder'),
  },
)

/**
 * tjx_quote_fixtures — Fixtures selected per room on a TJX quote.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxQuoteFixtures = pgTable(
  'tjx_quote_fixtures',
  {
    id: serial('id').primaryKey(),
    roomid: integer('roomid'),
    fixtureid: integer('fixtureid'),
    totalfixtures: varchar('totalfixtures', { length: 12 }),
    quoteid: integer('quoteid'),
    sortorder: integer('sortorder'),
  },
)

/**
 * tjx_quote_lastused_sharedpart — Last-used shared part per TJX quote (UI helper).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxQuoteLastusedSharedpart = pgTable(
  'tjx_quote_lastused_sharedpart',
  {
    quoteid: integer('quoteid').notNull(),
    usedPartcode: varchar('used_partcode', { length: 15 }).notNull(),
    mainPartcode: varchar('main_partcode', { length: 15 }).notNull(),
  },
  (table) => [
    index('legacy_tjx_quote_lastused_sharedpart_quoteid').on(table.quoteid),
  ],
)

/**
 * tjx_quote_parts — TJX quote parts lines (qty plus `without_markup_qty`).
 * Rows observed: 1712. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxQuoteParts = pgTable(
  'tjx_quote_parts',
  {
    id: serial('id').primaryKey(),
    quoteid: integer('quoteid').notNull(),
    partno: varchar('partno', { length: 30 }).notNull(),
    fixturedPartno: varchar('fixtured_partno', { length: 30 }),
    qty: integer('qty').notNull(),
    withoutMarkupQty: integer('without_markup_qty'),
    price: numeric('price', { precision: 7, scale: 2 }),
    sortorder: integer('sortorder'),
  },
)

/**
 * tjx_quote_revisions — Full revision snapshot of a TJX quote (quote/fixtures/parts/soparts).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxQuoteRevisions = pgTable(
  'tjx_quote_revisions',
  {
    revisionId: serial('revision_id').primaryKey(),
    quoteid: integer('quoteid'),
    createdTime: timestamp('created_time', { mode: 'string', withTimezone: false }),
    revisedByUser: integer('revised_by_user'),
    revisionType: varchar('revision_type', { length: 45 }),
    dataQuote: text('data_quote'),
    dataFixtures: text('data_fixtures'),
    dataParts: text('data_parts'),
    dataSoparts: text('data_soparts'),
  },
)

/**
 * tjx_quote_soparts — TJX quote special-order lines.
 * Rows observed: 97. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxQuoteSoparts = pgTable(
  'tjx_quote_soparts',
  {
    id: serial('id').primaryKey(),
    quoteid: integer('quoteid').notNull(),
    name: varchar('name', { length: 150 }),
    qty: integer('qty'),
    price: numeric('price', { precision: 7, scale: 2 }),
    sortorder: integer('sortorder'),
  },
)

/**
 * tjx_rooms_template — Saved room templates.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxRoomsTemplate = pgTable(
  'tjx_rooms_template',
  {
    roomid: integer('roomid'),
    sortorder: integer('sortorder'),
  },
)

/**
 * tjx_sub_invoice — TJX subcontractor invoice header (checklist flags, rejected count).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxSubInvoice = pgTable(
  'tjx_sub_invoice',
  {
    id: serial('id').primaryKey(),
    quoteid: integer('quoteid'),
    notes: text('notes'),
    subNotes: text('sub_notes'),
    invoiceDate: varchar('invoice_date', { length: 15 }),
    createdby: integer('createdby'),
    dateCreated: timestamp('date_created', { mode: 'string', withTimezone: false }),
    isSubmitted: integer('is_submitted'),
    invoiceNumber: varchar('invoice_number', { length: 30 }),
    workordernumber: varchar('workordernumber', { length: 20 }),
    taxCode: varchar('tax_code', { length: 12 }),
    taxTotal: varchar('tax_total', { length: 15 }),
    taxGst: varchar('tax_gst', { length: 15 }),
    taxPst: varchar('tax_pst', { length: 15 }),
    taxAmount: varchar('tax_amount', { length: 15 }),
    subtotalAmount: varchar('subtotal_amount', { length: 15 }),
    totalAmount: varchar('total_amount', { length: 15 }),
    chkProjectReading: integer('chk_project_reading'),
    chkProjectPhotos: integer('chk_project_photos'),
    chkProjectSignoff: integer('chk_project_signoff'),
    rejectedCount: integer('rejected_count'),
  },
)

/**
 * tjx_sub_invoice_fixtures — Fixtures on a TJX subcontractor invoice.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxSubInvoiceFixtures = pgTable(
  'tjx_sub_invoice_fixtures',
  {
    id: serial('id').primaryKey(),
    invoiceid: integer('invoiceid'),
    roomid: integer('roomid'),
    otherroom: varchar('otherroom', { length: 100 }),
    fixtureid: integer('fixtureid'),
    totalfixtures: varchar('totalfixtures', { length: 30 }),
    installedqtyTotalfixtures: varchar('installedqty_totalfixtures', { length: 30 }),
    quotedRoomid: integer('quoted_roomid'),
    quotedFixtureid: integer('quoted_fixtureid'),
    discrepancyNotes: text('discrepancy_notes'),
    tjxQuoteFixtureRowid: integer('tjx_quote_fixture_rowid'),
    quoteid: integer('quoteid'),
    woid: varchar('woid', { length: 15 }),
    sortorder: integer('sortorder'),
  },
)

/**
 * tjx_sub_invoice_revisions — TJX subcontractor invoice revisions.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxSubInvoiceRevisions = pgTable(
  'tjx_sub_invoice_revisions',
  {
    revisionId: serial('revision_id').primaryKey(),
    invoiceid: integer('invoiceid'),
    workordernumber: varchar('workordernumber', { length: 30 }),
    createdTime: timestamp('created_time', { mode: 'string', withTimezone: false }),
    revisedByUser: integer('revised_by_user'),
    revisionType: varchar('revision_type', { length: 45 }),
    dataInvoice: text('data_invoice'),
    dataFixtures: text('data_fixtures'),
    dataParts: text('data_parts'),
    dataSoparts: text('data_soparts'),
  },
)

/**
 * tjx_subcontractor_rates — TJX-specific subcontractor rates.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxSubcontractorRates = pgTable(
  'tjx_subcontractor_rates',
  {
    id: serial('id').primaryKey(),
    partno: varchar('partno', { length: 25 }).notNull(),
    subid: integer('subid').notNull(),
    installcostperunit: varchar('installcostperunit', { length: 15 }),
  },
  (table) => [
    index('legacy_tjx_subcontractor_rates_partno').on(table.partno),
    index('legacy_tjx_subcontractor_rates_subid').on(table.subid),
  ],
)

/**
 * tjx_wo_parts — Parts on TJX-generated work orders.
 * Rows observed: 477. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxWoParts = pgTable(
  'tjx_wo_parts',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    partno: varchar('partno', { length: 50 }).notNull(),
    partnoUsedInfixutre: varchar('partno_used_infixutre', { length: 50 }),
    qty: numeric('qty', { precision: 7, scale: 2 }).notNull(),
    price: numeric('price', { precision: 7, scale: 2 }),
    sortorder: integer('sortorder'),
  },
)

/**
 * tjx_wo_soparts — Special-order parts on TJX-generated work orders.
 * Rows observed: 32. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxWoSoparts = pgTable(
  'tjx_wo_soparts',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    qty: numeric('qty', { precision: 7, scale: 2 }).notNull(),
    price: numeric('price', { precision: 7, scale: 2 }).notNull(),
    sortorder: integer('sortorder'),
  },
)
