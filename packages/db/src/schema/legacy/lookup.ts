// @generated
// Source: packages/db/contract/schema.json (2026-11-11).
// Do not edit by hand. Run `pnpm db:generate:schema` after updating the contract.
// Domain: lookup

import { integer, pgTable, serial, smallserial, text, varchar } from 'drizzle-orm/pg-core'


/**
 * customer_quote_payterms — Customer quote payment-terms lookup.
 * Rows observed: 2. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCustomerQuotePayterms = pgTable(
  'customer_quote_payterms',
  {
    id: smallserial('id').primaryKey(),
    name: varchar('name', { length: 25 }).notNull(),
  },
)

/**
 * customer_quote_status — Customer quote status lookup (In Progress / Waiting for Approval / Approved / Cancelled).
 * Rows observed: 4. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCustomerQuoteStatus = pgTable(
  'customer_quote_status',
  {
    id: smallserial('id').primaryKey(),
    name: varchar('name', { length: 25 }).notNull(),
  },
)

/**
 * message_setup — Message template/policy settings.
 * Rows observed: 2. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyMessageSetup = pgTable(
  'message_setup',
  {
    id: serial('id').primaryKey(),
    userid: integer('userid').notNull(),
  },
)

/**
 * parts_group — Part group lookup (with a `is_winner` flag for TJX/Winners reporting).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPartsGroup = pgTable(
  'parts_group',
  {
    id: serial('id').primaryKey(),
    name: text('name'),
    sortId: integer('sort_id'),
    isWinner: integer('is_winner'),
  },
)

/**
 * permission_type — Permission-name lookup (empty in this snapshot).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPermissionType = pgTable(
  'permission_type',
  {
    id: serial('id').primaryKey(),
    permissionName: varchar('permission_name', { length: 50 }),
    permissionHeading: varchar('permission_heading', { length: 50 }),
    sortorder: integer('sortorder'),
  },
)

/**
 * po_preorder_status — Pre-order status lookup (Active / Complete).
 * Rows observed: 2. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoPreorderStatus = pgTable(
  'po_preorder_status',
  {
    id: smallserial('id').primaryKey(),
    name: varchar('name', { length: 25 }).notNull(),
  },
)

/**
 * po_priority — Purchase order priority lookup.
 * Rows observed: 5. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoPriority = pgTable(
  'po_priority',
  {
    id: smallserial('id').primaryKey(),
    name: varchar('name', { length: 40 }).notNull(),
  },
)

/**
 * po_quote_request_status — RFQ status lookup (Draft / Waiting for Quote / Quote Received / Complete / Cancelled).
 * Rows observed: 5. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoQuoteRequestStatus = pgTable(
  'po_quote_request_status',
  {
    id: smallserial('id').primaryKey(),
    name: varchar('name', { length: 25 }).notNull(),
  },
)

/**
 * po_quote_submitted_status — Supplier quote status lookup (Submitted / Approved / Cancelled).
 * Rows observed: 3. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoQuoteSubmittedStatus = pgTable(
  'po_quote_submitted_status',
  {
    id: smallserial('id').primaryKey(),
    name: varchar('name', { length: 25 }).notNull(),
  },
)

/**
 * po_status — Purchase order status lookup (11 values, with display sort order).
 * Rows observed: 11. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoStatus = pgTable(
  'po_status',
  {
    id: smallserial('id').primaryKey(),
    name: varchar('name', { length: 25 }).notNull(),
    sortingOrder: integer('sorting_order'),
  },
)

/**
 * rga_status — RGA status lookup (7 values).
 * Rows observed: 7. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyRgaStatus = pgTable(
  'rga_status',
  {
    id: smallserial('id').primaryKey(),
    name: varchar('name', { length: 25 }).notNull(),
    sortingOrder: integer('sorting_order'),
  },
)

/**
 * standalone_quote_status — Standalone quote status lookup.
 * Rows observed: 5. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyStandaloneQuoteStatus = pgTable(
  'standalone_quote_status',
  {
    id: smallserial('id').primaryKey(),
    name: varchar('name', { length: 25 }).notNull(),
  },
)

/**
 * tjx_quote_grid_types — TJX ceiling grid type lookup (A/B/C/Highbay).
 * Rows observed: 4. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxQuoteGridTypes = pgTable(
  'tjx_quote_grid_types',
  {
    id: smallserial('id').primaryKey(),
    name: varchar('name', { length: 25 }).notNull(),
  },
)

/**
 * tjx_quote_payterms — TJX payment-terms lookup.
 * Rows observed: 4. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxQuotePayterms = pgTable(
  'tjx_quote_payterms',
  {
    id: smallserial('id').primaryKey(),
    name: varchar('name', { length: 25 }).notNull(),
  },
)

/**
 * tjx_quote_status — TJX quote status lookup.
 * Rows observed: 4. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyTjxQuoteStatus = pgTable(
  'tjx_quote_status',
  {
    id: smallserial('id').primaryKey(),
    name: varchar('name', { length: 25 }).notNull(),
  },
)

/**
 * wo_categories — Work-order category lookup: PM, FOP, ESA, Disposal/Waste, Checkpoint, LP, Emergency Lighting.
 * Rows observed: 7. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyWoCategories = pgTable(
  'wo_categories',
  {
    id: smallserial('id').primaryKey(),
    code: varchar('code', { length: 25 }),
    name: varchar('name', { length: 25 }).notNull(),
  },
)

/**
 * wo_priority — Work-order priority lookup (5 values).
 * Rows observed: 5. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyWoPriority = pgTable(
  'wo_priority',
  {
    id: smallserial('id').primaryKey(),
    name: varchar('name', { length: 40 }).notNull(),
  },
)

/**
 * wo_servtype — Service type lookup: Interior, Exterior, Maintenance, Request for Proposal.
 * Rows observed: 4. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyWoServtype = pgTable(
  'wo_servtype',
  {
    id: smallserial('id').primaryKey(),
    name: varchar('name', { length: 20 }).notNull(),
  },
)

/**
 * wo_status — Work-order status lookup (12 values; see DOMAIN-MODEL).
 * Rows observed: 12. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyWoStatus = pgTable(
  'wo_status',
  {
    id: smallserial('id').primaryKey(),
    name: varchar('name', { length: 25 }).notNull(),
  },
)
