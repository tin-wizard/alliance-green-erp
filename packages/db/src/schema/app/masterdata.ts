import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
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

/**
 * Master Data — forward model.
 *
 * Natural ids are immovable for customers, sites, subcontractors, suppliers and
 * parts. They are Sage ids or legacy row ids that every historical work order
 * and invoice already uses; never generate, renumber or "clean" them.
 *
 *  - `customers.id` and `sites.id` are both Sage `tcustomr.lId`. They share one
 *    id space and are not parent/child mirrors. A work order points at a *site*.
 *  - `sites.customer_id` is nullable on purpose: 1,086 legacy sites have no
 *    imported parent. No inner join may hide them.
 *  - `parts.sell_price` and `parts.cost` are read by lookups. Price *mutation*
 *    belongs to the Inventory/Purchasing price-management screen, not here.
 *  - stock counters and movement ledgers are Inventory's tables, not these.
 */

export const customers = app.table(
  'customers',
  {
    /** Sage `tcustomr.lId`; immutable. */
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    street: text('street'),
    city: text('city'),
    province: text('province'),
    postalCode: text('postal_code'),
    contactName: text('contact_name'),
    contactNumber: text('contact_number'),
    contactEmail: text('contact_email'),
    salesperson: text('salesperson'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('customers_name_idx').on(sql`lower(${table.name})`),
    index('customers_city_idx').on(sql`lower(${table.city})`),
  ],
)

export const sites = app.table(
  'sites',
  {
    /** Sage `tcustomr.lId`; immutable, shares the id space with customers. */
    id: integer('id').primaryKey(),
    /**
     * Billing parent (`tcustshp.lCustId`). Nullable because parent customers
     * were never imported for 1,086 legacy rows. Never inner-join this.
     */
    customerId: integer('customer_id'),
    name: text('name').notNull(),
    street: text('street'),
    street2: text('street_2'),
    city: text('city'),
    province: text('province'),
    postalCode: text('postal_code'),
    contactName: text('contact_name'),
    contactNumber: text('contact_number'),
    warranty: boolean('warranty').notNull().default(false),
    warrantyExpiresOn: date('warranty_expires_on'),
    warrantyNotes: text('warranty_notes'),
    notes: text('notes'),
    /** Legacy free-text access/lift/mall labels, preserved verbatim. */
    dns: text('dns'),
    lift: text('lift'),
    mall: text('mall'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sites_customer_idx').on(table.customerId),
    index('sites_name_idx').on(sql`lower(${table.name})`),
    index('sites_city_idx').on(sql`lower(${table.city})`),
    index('sites_street_idx').on(sql`lower(${table.street})`),
  ],
)

export const siteWarranties = app.table(
  'site_warranties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: integer('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    description: text('description'),
    expiresOn: date('expires_on'),
    documentKey: text('document_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('site_warranties_site_idx').on(table.siteId)],
)

export const subcontractors = app.table(
  'subcontractors',
  {
    /** Legacy `subcontractor.id`; immutable because users/WOs reference it. */
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    street: text('street'),
    city: text('city'),
    province: text('province'),
    postalCode: text('postal_code'),
    contactName: text('contact_name'),
    contactNumber: text('contact_number'),
    contactEmail: text('contact_email'),
    email2: text('email_2'),
    email3: text('email_3'),
    rateInterior: numeric('rate_interior', { precision: 12, scale: 2 }),
    rateExterior: numeric('rate_exterior', { precision: 12, scale: 2 }),
    rateOther: numeric('rate_other', { precision: 12, scale: 2 }),
    stockNotificationAlertType: smallint('stock_notification_alert_type'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('subcontractors_name_idx').on(sql`lower(${table.name})`),
    index('subcontractors_city_idx').on(sql`lower(${table.city})`),
  ],
)

export const subcontractorContacts = app.table(
  'subcontractor_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subcontractorId: integer('subcontractor_id')
      .notNull()
      .references(() => subcontractors.id, { onDelete: 'cascade' }),
    contactName: text('contact_name'),
    phone: text('phone'),
    phoneExt: text('phone_ext'),
  },
  (table) => [index('subcontractor_contacts_sub_idx').on(table.subcontractorId)],
)

export const subcontractorDocumentKind = app.enum('subcontractor_document_kind', [
  'wsib',
  'insurance',
  'other',
])

export const subcontractorDocuments = app.table(
  'subcontractor_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subcontractorId: integer('subcontractor_id')
      .notNull()
      .references(() => subcontractors.id, { onDelete: 'cascade' }),
    kind: subcontractorDocumentKind('kind').notNull().default('wsib'),
    documentType: text('document_type'),
    documentName: text('document_name'),
    /** Object-storage key; never a local filesystem path. */
    storageKey: text('storage_key'),
    fileName: text('file_name'),
    expiresOn: date('expires_on'),
    /** Written at upload and re-evaluated by the expiry job. */
    isExpired: boolean('is_expired').notNull().default(false),
    reminderState: jsonb('reminder_state').$type<Record<string, unknown> | null>(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('subcontractor_documents_sub_idx').on(table.subcontractorId),
    index('subcontractor_documents_expiry_idx').on(table.expiresOn),
  ],
)

export const suppliers = app.table(
  'suppliers',
  {
    /** Legacy `suppliers.id`; immutable. */
    id: integer('id').primaryKey(),
    /** Sage `tvendor.lId`; unique when present. */
    sageVendorId: integer('sage_vendor_id'),
    name: text('name').notNull(),
    address: text('address'),
    city: text('city'),
    province: text('province'),
    postalCode: text('postal_code'),
    contactPerson: text('contact_person'),
    contactNumber: text('contact_number'),
    additionalEmails: text('additional_emails'),
    additionalEmailsAccounting: text('additional_emails_accounting'),
    /** Supplier portal identity; no FK to keep the identity slice independent. */
    userId: uuid('user_id'),
    isUnderCls: boolean('is_under_cls').notNull().default(false),
    isOnlineVendor: boolean('is_online_vendor').notNull().default(false),
    bypassPoApproval: boolean('bypass_po_approval').notNull().default(false),
    poNotes: text('po_notes'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('suppliers_sage_vendor_unique').on(table.sageVendorId),
    index('suppliers_name_idx').on(sql`lower(${table.name})`),
  ],
)

export const partGroups = app.table(
  'part_groups',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order'),
    isWinner: boolean('is_winner').notNull().default(false),
  },
)

export const parts = app.table(
  'parts',
  {
    /** Legacy `parts.id`; immutable. */
    id: integer('id').primaryKey(),
    /** Legacy `parts.number`; the identity every line and quote uses. */
    partNumber: text('part_number').notNull(),
    name: text('name'),
    partGroupId: integer('part_group_id'),
    /** Read-only here; price writes live in the price-management screen. */
    cost: numeric('cost', { precision: 12, scale: 2 }),
    sellPrice: numeric('sell_price', { precision: 12, scale: 2 }),
    sageItemId: integer('sage_item_id'),
    activeInSage: boolean('active_in_sage').notNull().default(true),
    /** Hidden from the subcontractor portal. */
    subignore: boolean('subignore').notNull().default(false),
    parentPartNumber: text('parent_part_number'),
    clsLinkedPartCode: text('cls_linked_part_code'),
    warranty: text('warranty'),
    labourWarranty: text('labour_warranty'),
    installCostPerUnit: numeric('install_cost_per_unit', { precision: 12, scale: 2 }),
    installProfitFormula: text('install_profit_formula'),
    recycleProfitFormula: text('recycle_profit_formula'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('parts_part_number_unique').on(table.partNumber),
    index('parts_name_idx').on(sql`lower(${table.name})`),
    index('parts_group_idx').on(table.partGroupId),
  ],
)

export const partSupplierRateLists = app.table('part_supplier_rate_lists', {
  id: integer('id').primaryKey(),
  supplierId: integer('supplier_id'),
  listHeading: text('list_heading'),
  listDate: date('list_date'),
  hasBuyRates: boolean('has_buy_rates').notNull().default(false),
})

export const partSellingRateLists = app.table('part_selling_rate_lists', {
  id: integer('id').primaryKey(),
  listHeading: text('list_heading'),
  listDate: date('list_date'),
  isWinner: boolean('is_winner').notNull().default(false),
})

export const partSubSuppliers = app.table('part_sub_suppliers', {
  id: integer('id').primaryKey(),
  supplierId: integer('supplier_id'),
  name: text('name'),
  location: text('location'),
  contactNumber: text('contact_number'),
  contactEmails: text('contact_emails'),
})

export const partSupplierRates = app.table(
  'part_supplier_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partId: integer('part_id')
      .notNull()
      .references(() => parts.id, { onDelete: 'cascade' }),
    supplierId: integer('supplier_id'),
    subSupplierId: integer('sub_supplier_id'),
    costPrice: numeric('cost_price', { precision: 12, scale: 2 }),
    lastCostPrice: numeric('last_cost_price', { precision: 12, scale: 2 }),
    sellPrice: numeric('sell_price', { precision: 12, scale: 2 }),
    lastSellPrice: numeric('last_sell_price', { precision: 12, scale: 2 }),
    installPrice: numeric('install_price', { precision: 12, scale: 2 }),
    recyclePrice: numeric('recycle_price', { precision: 12, scale: 2 }),
    markup: numeric('markup', { precision: 7, scale: 2 }),
    modelNumber1: text('model_number_1'),
    modelNumber2: text('model_number_2'),
    modelNumber3: text('model_number_3'),
    supplierWarranty: text('supplier_warranty'),
    defaultRate: boolean('default_rate').notNull().default(false),
    dateInserted: timestamp('date_inserted', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('part_supplier_rates_part_idx').on(table.partId),
    index('part_supplier_rates_supplier_idx').on(table.supplierId),
  ],
)

export const partSupplierModelRates = app.table(
  'part_supplier_model_rates',
  {
    id: integer('id').primaryKey(),
    partCode: text('part_code'),
    listId: integer('list_id'),
    supplierId: integer('supplier_id'),
    modelPrice: text('model_price'),
    defaultModel: boolean('default_model').notNull().default(false),
    modelNumber: text('model_number'),
  },
  (table) => [
    index('part_supplier_model_rates_part_idx').on(table.partCode),
    index('part_supplier_model_rates_supplier_idx').on(table.supplierId),
  ],
)

export const partSellingRates = app.table(
  'part_selling_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partId: integer('part_id')
      .notNull()
      .references(() => parts.id, { onDelete: 'cascade' }),
    listId: integer('list_id'),
    oldSellPrice: numeric('old_sell_price', { precision: 12, scale: 2 }),
    increasePercentage: integer('increase_percentage'),
    sellPrice: numeric('sell_price', { precision: 12, scale: 2 }),
    installPrice: numeric('install_price', { precision: 12, scale: 2 }),
    recyclePrice: numeric('recycle_price', { precision: 12, scale: 2 }),
    dateInserted: timestamp('date_inserted', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('part_selling_rates_part_idx').on(table.partId)],
)

export const partPriceHistory = app.table(
  'part_price_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    partId: integer('part_id')
      .notNull()
      .references(() => parts.id, { onDelete: 'cascade' }),
    fieldName: text('field_name').notNull(),
    lastValue: text('last_value'),
    newValue: text('new_value'),
    changedBy: uuid('changed_by'),
    sectionName: text('section_name'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('part_price_history_part_idx').on(table.partId, table.changedAt)],
)

export const sharedParts = app.table('shared_parts', {
  partCode: text('part_code').primaryKey(),
  mainPartCode: text('main_part_code').notNull(),
})

export type Customer = typeof customers.$inferSelect
export type Site = typeof sites.$inferSelect
export type Subcontractor = typeof subcontractors.$inferSelect
export type SubcontractorDocument = typeof subcontractorDocuments.$inferSelect
export type Supplier = typeof suppliers.$inferSelect
export type Part = typeof parts.$inferSelect
export type PartSupplierRate = typeof partSupplierRates.$inferSelect
export type PartSellingRate = typeof partSellingRates.$inferSelect
