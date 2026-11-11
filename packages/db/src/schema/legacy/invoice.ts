// @generated
// Source: packages/db/contract/schema.json (2026-11-11).
// Do not edit by hand. Run `pnpm db:generate:schema` after updating the contract.
// Domain: invoice

import { date, index, integer, numeric, pgEnum, pgTable, serial, text, varchar } from 'drizzle-orm/pg-core'
export const legacyEnumInvTaxCalcType = pgEnum('legacy_inv_tax_calc_type', ["sub", "sub_project", "local", "local_project", ""])
export const legacyEnumScInvTaxCalcType = pgEnum('legacy_sc_inv_tax_calc_type', ["sub", "sub_project", "local", "local_project", ""])

/**
 * inv_hours — Invoice snapshot: labour.
 * Rows observed: 47547. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyInvHours = pgTable(
  'inv_hours',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    rate: numeric('rate', { precision: 7, scale: 2 }),
    enteredRate: varchar('entered_rate', { length: 12 }),
    date: date('date', { mode: 'string' }).notNull(),
    hours: numeric('hours', { precision: 7, scale: 2 }).notNull(),
  },
)

/**
 * inv_parts — Invoice snapshot: parts. Deleted and re-created by `calc_submit.php` on every recalculation.
 * Rows observed: 71087. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyInvParts = pgTable(
  'inv_parts',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    partno: varchar('partno', { length: 20 }).notNull(),
    qty: numeric('qty', { precision: 7, scale: 2 }).notNull(),
    price: numeric('price', { precision: 11, scale: 2 }).notNull(),
    enteredPrice: varchar('entered_price', { length: 12 }),
    linkedSopartCostPrice: varchar('linked_sopart_cost_price', { length: 30 }),
    linkedPartSopart: varchar('linked_part_sopart', { length: 20 }),
    isLocalPart: integer('is_local_part'),
    appliedWoid: varchar('applied_woid', { length: 20 }),
  },
  (table) => [
    index('legacy_inv_parts_is_local_part').on(table.isLocalPart),
    index('legacy_inv_parts_partno').on(table.partno),
    index('legacy_inv_parts_woid').on(table.woid),
  ],
)

/**
 * inv_project — Invoice → Sage project mapping.
 * Rows observed: 4146. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyInvProject = pgTable(
  'inv_project',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    sageProjectWorkorder: varchar('sage_project_workorder', { length: 100 }),
  },
)

/**
 * inv_soparts — Invoice snapshot: special-order parts.
 * Rows observed: 43045. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyInvSoparts = pgTable(
  'inv_soparts',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    name: text('name').notNull(),
    qty: numeric('qty', { precision: 7, scale: 2 }).notNull(),
    price: numeric('price', { precision: 11, scale: 2 }).notNull(),
    enteredPrice: varchar('entered_price', { length: 12 }),
    isLocalPart: integer('is_local_part'),
    isEmergencyLighting: integer('is_emergency_lighting'),
    isServiceReport: integer('is_service_report'),
    warrantyYears: varchar('warranty_years', { length: 25 }),
    laborWarrantyYears: varchar('labor_warranty_years', { length: 25 }),
    appliedWoid: varchar('applied_woid', { length: 25 }),
  },
)

/**
 * inv_tax — Invoice snapshot: tax/subtotal/total, posted from the calculator form (not recomputed server-side).
 * Rows observed: 27802. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 * Money columns are varchar in the legacy schema. Do not do arithmetic on them here.
 */
export const legacyInvTax = pgTable(
  'inv_tax',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    appliedtaxrate: varchar('appliedtaxrate', { length: 15 }),
    calcType: legacyEnumInvTaxCalcType('calc_type'),
    // enum('sub','sub_project','local','local_project','')
    taxAmount: varchar('tax_amount', { length: 30 }),
    subtotalAmount: varchar('subtotal_amount', { length: 30 }),
    totalAmount: varchar('total_amount', { length: 30 }),
    // varchar; POSTed by the calculator, may be blank on legacy rows
  },
)

/**
 * rejected_invoices — Invoices rejected by a customer (reason, content, who rejected).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyRejectedInvoices = pgTable(
  'rejected_invoices',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    invoiceNo: varchar('invoice_no', { length: 100 }).notNull(),
    dateRejected: integer('date_rejected').notNull(),
    rejectedReason: text('rejected_reason'),
    invoiceContent: text('invoice_content'),
    rejectedByDetail: varchar('rejected_by_detail', { length: 200 }),
  },
)

/**
 * sc_inv_hours — ServiceChannel invoice labour lines.
 * Rows observed: 0. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyScInvHours = pgTable(
  'sc_inv_hours',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    rate: numeric('rate', { precision: 7, scale: 2 }),
    enteredRate: varchar('entered_rate', { length: 12 }),
    date: date('date', { mode: 'string' }).notNull(),
    hours: numeric('hours', { precision: 7, scale: 2 }).notNull(),
  },
)

/**
 * sc_inv_parts — ServiceChannel invoice parts lines.
 * Rows observed: 0. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyScInvParts = pgTable(
  'sc_inv_parts',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    partno: varchar('partno', { length: 20 }).notNull(),
    qty: numeric('qty', { precision: 7, scale: 2 }).notNull(),
    price: numeric('price', { precision: 7, scale: 2 }).notNull(),
    enteredPrice: varchar('entered_price', { length: 12 }),
    linkedSopartCostPrice: varchar('linked_sopart_cost_price', { length: 30 }),
    linkedPartSopart: varchar('linked_part_sopart', { length: 20 }),
    isLocalPart: integer('is_local_part'),
    appliedWoid: varchar('applied_woid', { length: 20 }),
  },
  (table) => [
    index('legacy_sc_inv_parts_is_local_part').on(table.isLocalPart),
    index('legacy_sc_inv_parts_partno').on(table.partno),
    index('legacy_sc_inv_parts_woid').on(table.woid),
  ],
)

/**
 * sc_inv_soparts — ServiceChannel invoice special-order lines.
 * Rows observed: 0. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyScInvSoparts = pgTable(
  'sc_inv_soparts',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    name: text('name').notNull(),
    qty: numeric('qty', { precision: 7, scale: 2 }).notNull(),
    price: numeric('price', { precision: 7, scale: 2 }).notNull(),
    enteredPrice: varchar('entered_price', { length: 12 }),
    isLocalPart: integer('is_local_part'),
    isEmergencyLighting: integer('is_emergency_lighting'),
    isServiceReport: integer('is_service_report'),
    warrantyYears: varchar('warranty_years', { length: 25 }),
    laborWarrantyYears: varchar('labor_warranty_years', { length: 25 }),
    appliedWoid: varchar('applied_woid', { length: 25 }),
  },
)

/**
 * sc_inv_tax — ServiceChannel invoice tax lines.
 * Rows observed: 0. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyScInvTax = pgTable(
  'sc_inv_tax',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    appliedtaxrate: varchar('appliedtaxrate', { length: 15 }),
    calcType: legacyEnumScInvTaxCalcType('calc_type'),
    taxAmount: varchar('tax_amount', { length: 30 }),
    subtotalAmount: varchar('subtotal_amount', { length: 30 }),
    totalAmount: varchar('total_amount', { length: 30 }),
  },
)
