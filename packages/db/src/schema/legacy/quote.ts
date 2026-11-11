// @generated
// Source: packages/db/contract/schema.json (2026-11-11).
// Do not edit by hand. Run `pnpm db:generate:schema` after updating the contract.
// Domain: quote

import { date, doublePrecision, index, integer, numeric, pgTable, serial, smallint, text, timestamp, varchar } from 'drizzle-orm/pg-core'


/**
 * calcquote_hours — Calculator staging: labour lines while a quote is being priced.
 * Rows observed: 5784. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCalcquoteHours = pgTable(
  'calcquote_hours',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    hours: numeric('hours', { precision: 7, scale: 2 }).notNull(),
    rate: numeric('rate', { precision: 7, scale: 2 }).notNull(),
    enteredRate: varchar('entered_rate', { length: 15 }),
    numtechs: integer('numtechs'),
    date: date('date', { mode: 'string' }),
  },
)

/**
 * calcquote_hours_incurred — Calculator staging: incurred labour.
 * Rows observed: 3967. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCalcquoteHoursIncurred = pgTable(
  'calcquote_hours_incurred',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    hours: numeric('hours', { precision: 7, scale: 2 }).notNull(),
    rate: numeric('rate', { precision: 7, scale: 2 }).notNull(),
    enteredRate: varchar('entered_rate', { length: 15 }),
    date: date('date', { mode: 'string' }),
    numtechs: integer('numtechs'),
  },
)

/**
 * calcquote_incurred — Calculator staging: incurred cost totals.
 * Rows observed: 1912. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCalcquoteIncurred = pgTable(
  'calcquote_incurred',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    name: varchar('name', { length: 100 }),
    incurredCost: numeric('incurred_cost', { precision: 7, scale: 2 }),
  },
)

/**
 * calcquote_parts — Calculator staging: parts lines.
 * Rows observed: 10528. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCalcquoteParts = pgTable(
  'calcquote_parts',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    partno: varchar('partno', { length: 20 }).notNull(),
    qty: integer('qty').notNull(),
    price: numeric('price', { precision: 11, scale: 2 }).notNull(),
    enteredPrice: varchar('entered_price', { length: 15 }),
    isUnderWarranty: integer('is_under_warranty'),
  },
)

/**
 * calcquote_parts_incurred — Calculator staging: incurred parts.
 * Rows observed: 6431. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCalcquotePartsIncurred = pgTable(
  'calcquote_parts_incurred',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    partno: varchar('partno', { length: 20 }).notNull(),
    qty: integer('qty').notNull(),
    price: numeric('price', { precision: 11, scale: 2 }).notNull(),
    enteredPrice: varchar('entered_price', { length: 15 }),
    isUnderWarranty: integer('is_under_warranty'),
  },
)

/**
 * calcquote_report — Calculator staging: report text.
 * Rows observed: 5711. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCalcquoteReport = pgTable(
  'calcquote_report',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    report: text('report').notNull(),
    incurredReport: text('incurred_report'),
    status: varchar('status', { length: 20 }).notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    tax: numeric('tax', { precision: 7, scale: 2 }).notNull(),
    incurred: numeric('incurred', { precision: 7, scale: 2 }),
    isSubQuote: smallint('is_sub_quote'),
    taxcode: varchar('taxcode', { length: 15 }),
    addProvinceTaxcode: varchar('add_province_taxcode', { length: 30 }),
    isCalculated: integer('is_calculated'),
    isAfterTwoCent: integer('is_after_two_cent'),
  },
  (table) => [
    index('legacy_calcquote_report_woid').on(table.woid),
  ],
)

/**
 * calcquote_soparts — Calculator staging: special-order part lines.
 * Rows observed: 4829. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCalcquoteSoparts = pgTable(
  'calcquote_soparts',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    name: varchar('name', { length: 250 }).notNull(),
    qty: integer('qty').notNull(),
    price: numeric('price', { precision: 12, scale: 2 }).notNull(),
    enteredPrice: varchar('entered_price', { length: 15 }),
    isEmergencyLighting: integer('is_emergency_lighting'),
  },
)

/**
 * calcquote_soparts_incurred — Calculator staging: incurred special-order parts.
 * Rows observed: 418. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCalcquoteSopartsIncurred = pgTable(
  'calcquote_soparts_incurred',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    name: varchar('name', { length: 250 }).notNull(),
    qty: integer('qty').notNull(),
    price: numeric('price', { precision: 10, scale: 2 }).notNull(),
    enteredPrice: varchar('entered_price', { length: 15 }),
    isEmergencyLighting: integer('is_emergency_lighting'),
  },
)

/**
 * customer_qo_packing_parts — Packing slip parts lines.
 * Rows observed: 1042. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCustomerQoPackingParts = pgTable(
  'customer_qo_packing_parts',
  {
    id: serial('id').primaryKey(),
    custQoid: integer('cust_qoid'),
    packingSlipId: integer('packing_slip_id').notNull(),
    partno: varchar('partno', { length: 20 }).notNull(),
    actualQty: integer('actual_qty'),
    backorderQty: integer('backorder_qty').notNull(),
    shippedQty: integer('shipped_qty'),
    sortorder: integer('sortorder'),
  },
)

/**
 * customer_qo_packing_slip — Packing slip header generated from a customer quote.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCustomerQoPackingSlip = pgTable(
  'customer_qo_packing_slip',
  {
    id: serial('id').primaryKey(),
    custQoid: integer('cust_qoid').notNull(),
    dateCreated: date('date_created', { mode: 'string' }),
    shipDate: date('ship_date', { mode: 'string' }),
    packingSlipLevel: integer('packing_slip_level'),
  },
)

/**
 * customer_qo_packing_soparts — Packing slip special-order part lines.
 * Rows observed: 76. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCustomerQoPackingSoparts = pgTable(
  'customer_qo_packing_soparts',
  {
    id: serial('id').primaryKey(),
    custQoid: integer('cust_qoid'),
    packingSlipId: integer('packing_slip_id').notNull(),
    qoSopartId: integer('qo_sopart_id'),
    name: varchar('name', { length: 150 }).notNull(),
    actualQty: integer('actual_qty'),
    backorderQty: integer('backorder_qty').notNull(),
    shippedQty: integer('shipped_qty'),
    sortorder: integer('sortorder'),
  },
)

/**
 * customer_quote — Customer quote header (status, payment terms, ship-to, tax, revision chain).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCustomerQuote = pgTable(
  'customer_quote',
  {
    id: serial('id').primaryKey(),
    workordernumber: integer('workordernumber'),
    site: integer('site'),
    shipCntc: text('ShipCntc'),
    shipStrt1: text('ShipStrt1'),
    shipStrt2: text('ShipStrt2'),
    shipCity: text('ShipCity'),
    shipPrvSt: text('ShipPrvSt'),
    shipPstZp: text('ShipPstZp'),
    isAddressUpdated: integer('is_address_updated'),
    report: text('report'),
    status: integer('status'),
    paymentTerms: integer('payment_terms'),
    notes: text('notes'),
    appliedtaxrate: varchar('appliedtaxrate', { length: 12 }),
    taxCode: varchar('tax_code', { length: 50 }),
    taxAmount: varchar('tax_amount', { length: 50 }),
    createdby: integer('createdby'),
    dueDate: date('due_date', { mode: 'string' }),
    isDueDateTbd: integer('is_due_date_tbd'),
    dateApproved: date('date_approved', { mode: 'string' }),
    dateCreated: date('date_created', { mode: 'string' }),
    isRevision: integer('is_revision'),
    revisionQuoteId: integer('revision_quote_id'),
    revisionId: doublePrecision('revision_id'),
  },
)

/**
 * customer_quote_hours — Customer quote labour lines.
 * Rows observed: 22. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCustomerQuoteHours = pgTable(
  'customer_quote_hours',
  {
    id: serial('id').primaryKey(),
    custQoid: integer('cust_qoid').notNull(),
    hours: numeric('hours', { precision: 7, scale: 2 }).notNull(),
    rate: numeric('rate', { precision: 7, scale: 2 }).notNull(),
    date: date('date', { mode: 'string' }),
  },
)

/**
 * customer_quote_parts — Customer quote parts lines.
 * Rows observed: 1677. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCustomerQuoteParts = pgTable(
  'customer_quote_parts',
  {
    id: serial('id').primaryKey(),
    custQoid: integer('cust_qoid').notNull(),
    partno: varchar('partno', { length: 20 }).notNull(),
    qty: integer('qty').notNull(),
    price: numeric('price', { precision: 11, scale: 2 }),
  },
)

/**
 * customer_quote_soparts — Customer quote special-order part lines.
 * Rows observed: 154. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCustomerQuoteSoparts = pgTable(
  'customer_quote_soparts',
  {
    id: serial('id').primaryKey(),
    custQoid: integer('cust_qoid').notNull(),
    name: varchar('name', { length: 150 }).notNull(),
    qty: integer('qty').notNull(),
    price: numeric('price', { precision: 11, scale: 2 }),
  },
)

/**
 * quote_hours — Quote-form labour lines.
 * Rows observed: 2762. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyQuoteHours = pgTable(
  'quote_hours',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    rate: integer('rate').notNull(),
    hours: numeric('hours', { precision: 7, scale: 2 }).notNull(),
    hourlyRate: numeric('hourly_rate', { precision: 7, scale: 2 }),
    date: date('date', { mode: 'string' }),
  },
)

/**
 * quote_hours_incurred — Incurred-cost counterpart of `quote_hours`.
 * Rows observed: 2192. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyQuoteHoursIncurred = pgTable(
  'quote_hours_incurred',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    rate: integer('rate').notNull(),
    hours: numeric('hours', { precision: 7, scale: 2 }).notNull(),
    hourlyRate: numeric('hourly_rate', { precision: 7, scale: 2 }),
    date: date('date', { mode: 'string' }),
  },
)

/**
 * quote_parts — Quote-form parts lines (shared quote editor).
 * Rows observed: 891. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyQuoteParts = pgTable(
  'quote_parts',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    partno: varchar('partno', { length: 20 }).notNull(),
    qty: integer('qty').notNull(),
    price: numeric('price', { precision: 11, scale: 2 }).notNull(),
  },
)

/**
 * quote_parts_incurred — Incurred-cost counterpart of `quote_parts` (cost basis for margin).
 * Rows observed: 532. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyQuotePartsIncurred = pgTable(
  'quote_parts_incurred',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    partno: varchar('partno', { length: 20 }).notNull(),
    qty: integer('qty').notNull(),
    price: numeric('price', { precision: 7, scale: 2 }).notNull(),
  },
)

/**
 * quote_report — Quote-form report/notes text.
 * Rows observed: 2463. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyQuoteReport = pgTable(
  'quote_report',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    report: text('report').notNull(),
    date: timestamp('date', { mode: 'string', withTimezone: false }),
    tax: numeric('tax', { precision: 7, scale: 2 }),
    taxCode: varchar('tax_code', { length: 10 }),
  },
)

/**
 * quote_soparts — Quote-form special-order part lines.
 * Rows observed: 3696. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyQuoteSoparts = pgTable(
  'quote_soparts',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    name: varchar('name', { length: 50 }).notNull(),
    qty: integer('qty').notNull(),
    price: numeric('price', { precision: 11, scale: 2 }).notNull(),
    isEmergencyLighting: integer('is_emergency_lighting'),
  },
)

/**
 * quote_soparts_incurred — Incurred-cost counterpart of `quote_soparts`.
 * Rows observed: 876. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyQuoteSopartsIncurred = pgTable(
  'quote_soparts_incurred',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    name: varchar('name', { length: 50 }).notNull(),
    qty: integer('qty').notNull(),
    price: numeric('price', { precision: 7, scale: 2 }).notNull(),
    isEmergencyLighting: integer('is_emergency_lighting'),
  },
)

/**
 * standalone_quote — Standalone (no work order) quote header; supports revisions and soft delete.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyStandaloneQuote = pgTable(
  'standalone_quote',
  {
    id: serial('id').primaryKey(),
    workordernumber: integer('workordernumber'),
    site: integer('site'),
    shipCntc: text('ShipCntc'),
    shipStrt1: text('ShipStrt1'),
    shipStrt2: text('ShipStrt2'),
    shipCity: text('ShipCity'),
    shipPrvSt: text('ShipPrvSt'),
    shipPstZp: text('ShipPstZp'),
    isAddressUpdated: integer('is_address_updated'),
    pdfNotes: text('pdf_notes'),
    status: integer('status'),
    referenceWoNumber: varchar('reference_wo_number', { length: 25 }),
    notes: text('notes'),
    appliedtaxrate: varchar('appliedtaxrate', { length: 12 }),
    taxCode: varchar('tax_code', { length: 50 }),
    taxAmount: varchar('tax_amount', { length: 50 }),
    createdby: integer('createdby'),
    dateApproved: date('date_approved', { mode: 'string' }),
    dateCreated: date('date_created', { mode: 'string' }),
    isRevision: integer('is_revision'),
    revisionQuoteId: integer('revision_quote_id'),
    revisionId: doublePrecision('revision_id'),
    createdFromLocal: integer('created_from_local'),
    isDeleted: integer('is_deleted'),
  },
)

/**
 * standalone_quote_hours — Standalone quote labour lines.
 * Rows observed: 184. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyStandaloneQuoteHours = pgTable(
  'standalone_quote_hours',
  {
    id: serial('id').primaryKey(),
    salQoid: integer('sal_qoid').notNull(),
    hours: numeric('hours', { precision: 7, scale: 2 }).notNull(),
    numtechs: integer('numtechs'),
    rate: numeric('rate', { precision: 7, scale: 2 }).notNull(),
    date: date('date', { mode: 'string' }),
  },
)

/**
 * standalone_quote_parts — Standalone quote parts lines.
 * Rows observed: 663. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyStandaloneQuoteParts = pgTable(
  'standalone_quote_parts',
  {
    id: serial('id').primaryKey(),
    salQoid: integer('sal_qoid').notNull(),
    partno: varchar('partno', { length: 20 }).notNull(),
    qty: integer('qty').notNull(),
    enteredPrice: varchar('entered_price', { length: 30 }),
    price: numeric('price', { precision: 10, scale: 2 }),
    isUnderWarranty: integer('is_under_warranty'),
  },
)

/**
 * standalone_quote_soparts — Standalone quote special-order part lines.
 * Rows observed: 45. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyStandaloneQuoteSoparts = pgTable(
  'standalone_quote_soparts',
  {
    id: serial('id').primaryKey(),
    salQoid: integer('sal_qoid').notNull(),
    name: varchar('name', { length: 150 }).notNull(),
    qty: integer('qty').notNull(),
    enteredPrice: varchar('entered_price', { length: 30 }),
    price: numeric('price', { precision: 10, scale: 2 }),
  },
)
