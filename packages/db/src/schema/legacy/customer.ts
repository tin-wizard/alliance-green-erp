// @generated
// Source: packages/db/contract/schema.json (2026-11-11).
// Do not edit by hand. Run `pnpm db:generate:schema` after updating the contract.
// Domain: customer

import { date, index, integer, numeric, pgTable, serial, smallint, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core'


/**
 * customer — Billing customer master, keyed by Sage `tcustomr.lId` (near-duplicate of `sites`).
 * Rows observed: 3760. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCustomer = pgTable(
  'customer',
  {
    id: serial('id').primaryKey(),
    // must equal Sage tcustomr.lId
    name: varchar('name', { length: 1000 }),
    street: varchar('street', { length: 200 }),
    city: varchar('city', { length: 50 }),
    province: varchar('province', { length: 25 }),
    postalcode: varchar('postalcode', { length: 20 }),
    cname: varchar('cname', { length: 250 }),
    cnumber: varchar('cnumber', { length: 25 }),
    cemail1: varchar('cemail1', { length: 50 }),
    salesp: varchar('salesp', { length: 50 }),
  },
  (table) => [
    uniqueIndex('legacy_customer_name').on(table.name),
  ],
)

/**
 * sites — Service site master. `id` **is** the Sage `tcustomr.lId`; `custid` is the Sage parent customer id.
 * Rows observed: 4844. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacySites = pgTable(
  'sites',
  {
    id: serial('id').primaryKey(),
    // must equal Sage tcustomr.lId
    custid: integer('custid').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    street: varchar('street', { length: 200 }).notNull(),
    street2: text('street_2'),
    city: varchar('city', { length: 50 }).notNull(),
    province: varchar('province', { length: 25 }).notNull(),
    postalcode: varchar('postalcode', { length: 25 }),
    cname: varchar('cname', { length: 200 }),
    cnumber: varchar('cnumber', { length: 25 }),
    warranty: smallint('warranty'),
    warrantyExp: date('warranty_exp', { mode: 'string' }),
    warrantyNotes: text('warranty_notes'),
    notes: text('notes'),
    dns: varchar('dns', { length: 10 }),
    lift: varchar('lift', { length: 10 }),
    mall: varchar('mall', { length: 100 }),
  },
  (table) => [
    index('legacy_sites_id').on(table.id),
  ],
)

/**
 * subcontractor — Subcontractor master (address, e-mail contacts, labour rates interior/exterior/other).
 * Rows observed: 888. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacySubcontractor = pgTable(
  'subcontractor',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 75 }).notNull(),
    street: varchar('street', { length: 200 }).notNull(),
    city: varchar('city', { length: 50 }).notNull(),
    province: varchar('province', { length: 25 }).notNull(),
    postalcode: varchar('postalcode', { length: 25 }).notNull(),
    cname: varchar('cname', { length: 250 }).notNull(),
    cnumber: varchar('cnumber', { length: 50 }).notNull(),
    cemail1: varchar('cemail1', { length: 50 }).notNull(),
    cemail2: varchar('cemail2', { length: 50 }),
    cemail3: varchar('cemail3', { length: 50 }),
    interior: numeric('interior', { precision: 7, scale: 2 }),
    exterior: numeric('exterior', { precision: 7, scale: 2 }),
    other: numeric('other', { precision: 7, scale: 2 }),
    stockNotificationAlertType: integer('stock_notification_alert_type'),
  },
)

/**
 * subcontractor_contact_info — Additional subcontractor contacts.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacySubcontractorContactInfo = pgTable(
  'subcontractor_contact_info',
  {
    id: serial('id').primaryKey(),
    subid: integer('subid'),
    contactName: varchar('contact_name', { length: 60 }),
    phone: varchar('phone', { length: 60 }),
    phoneExt: varchar('phone_ext', { length: 10 }),
  },
)

/**
 * suppliers — Supplier master, linked to Sage vendor by `sage_vendor_id`; `bypass_po_approval` flag.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacySuppliers = pgTable(
  'suppliers',
  {
    id: serial('id').primaryKey(),
    sageVendorId: integer('sage_vendor_id'),
    // Sage tvendor.lId
    name: varchar('name', { length: 50 }),
    address: varchar('address', { length: 100 }),
    city: varchar('city', { length: 80 }),
    province: varchar('province', { length: 80 }),
    postalcode: varchar('postalcode', { length: 80 }),
    additionalEmails: text('additional_emails'),
    additionalEmailsAccounting: text('additional_emails_accounting'),
    contactNumber: varchar('contact_number', { length: 50 }),
    contactPerson: varchar('contact_person', { length: 50 }),
    userId: integer('user_id'),
    isUnderCls: integer('is_under_cls'),
    isOnlineVendor: integer('is_online_vendor'),
    popnotes: text('popnotes'),
    bypassPoApproval: integer('bypass_po_approval'),
  },
)
