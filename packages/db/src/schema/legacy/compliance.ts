// @generated
// Source: packages/db/contract/schema.json (2026-11-11).
// Do not edit by hand. Run `pnpm db:generate:schema` after updating the contract.
// Domain: compliance

import { bigserial, date, index, integer, pgEnum, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'
export const legacyEnumMaterialChecklistReturningCustomEnteriesReturningTo = pgEnum('legacy_material_checklist_returning_custom_enteries_r_62090c', ["alliance", "contractor", "customer site", ""])
export const legacyEnumMaterialChecklistReturningPartsReturningTo = pgEnum('legacy_material_checklist_returning_parts_returning_to', ["alliance", "contractor", "customer site", ""])
export const legacyEnumMaterialWarrantyWarrantyType = pgEnum('legacy_material_warranty_warranty_type', ["warranty", "labor"])

/**
 * material_checklist — Material checklist header (per WO).
 * Rows observed: 14. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyMaterialChecklist = pgTable(
  'material_checklist',
  {
    id: serial('id').primaryKey(),
    workordernumber: integer('workordernumber').notNull(),
    quoteid: varchar('quoteid', { length: 25 }),
    subNotes: text('sub_notes'),
    notes: text('notes'),
    chkAllReviewed: integer('chk_all_reviewed').notNull(),
    chkAllSkidsAttached: integer('chk_all_skids_attached'),
    chkBreifWalkConducted: integer('chk_breif_walk_conducted'),
    isSubmitted: integer('is_submitted'),
    dateCreated: timestamp('date_created', { mode: 'string', withTimezone: false }),
  },
)

/**
 * material_checklist_custom_entries — Free-text checklist entries.
 * Rows observed: 3. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyMaterialChecklistCustomEntries = pgTable(
  'material_checklist_custom_entries',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    name: text('name'),
    qty: varchar('qty', { length: 20 }),
    notes: text('notes'),
  },
)

/**
 * material_checklist_defective_parts — Defective parts recorded on a checklist.
 * Rows observed: 26. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyMaterialChecklistDefectiveParts = pgTable(
  'material_checklist_defective_parts',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    partno: varchar('partno', { length: 50 }).notNull(),
    partDescription: text('part_description'),
    qty: varchar('qty', { length: 20 }),
    defectiveByDefault: integer('defective_by_default'),
    defectReason: varchar('defect_reason', { length: 80 }),
    isSpecialPart: integer('is_special_part'),
  },
)

/**
 * material_checklist_notes — Checklist notes.
 * Rows observed: 179. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyMaterialChecklistNotes = pgTable(
  'material_checklist_notes',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    partno: varchar('partno', { length: 50 }).notNull(),
    notes: text('notes'),
    isSpecialPart: integer('is_special_part'),
  },
)

/**
 * material_checklist_parts — Checklist parts.
 * Rows observed: 169. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyMaterialChecklistParts = pgTable(
  'material_checklist_parts',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    partno: varchar('partno', { length: 50 }),
    partDescription: text('part_description'),
    qty: varchar('qty', { length: 20 }),
    colNumber: integer('col_number'),
    isSpecialPart: integer('is_special_part'),
  },
)

/**
 * material_checklist_returning_custom_enteries — Free-text returned-item entries.
 * Rows observed: 1. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyMaterialChecklistReturningCustomEnteries = pgTable(
  'material_checklist_returning_custom_enteries',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    description: text('description'),
    qty: varchar('qty', { length: 20 }),
    returningTo: legacyEnumMaterialChecklistReturningCustomEnteriesReturningTo('returning_to'),
  },
)

/**
 * material_checklist_returning_parts — Parts returned with a checklist.
 * Rows observed: 179. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyMaterialChecklistReturningParts = pgTable(
  'material_checklist_returning_parts',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    partno: varchar('partno', { length: 150 }),
    partDescription: text('part_description'),
    suppliedQty: varchar('supplied_qty', { length: 20 }),
    qty: varchar('qty', { length: 20 }),
    returningTo: legacyEnumMaterialChecklistReturningPartsReturningTo('returning_to'),
    isSpecialPart: integer('is_special_part'),
    isDefaultStock: integer('is_default_stock'),
    qtyToAlliance: varchar('qty_to_alliance', { length: 20 }),
    qtyToCustomer: varchar('qty_to_customer', { length: 20 }),
    qtyToContractor: varchar('qty_to_contractor', { length: 20 }),
    notes: text('notes'),
  },
)

/**
 * material_warranty — Material warranty per part/WO/site with expiration date.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyMaterialWarranty = pgTable(
  'material_warranty',
  {
    id: serial('id').primaryKey(),
    partno: varchar('partno', { length: 30 }),
    partdesc: text('partdesc'),
    woid: integer('woid'),
    siteId: integer('site_id'),
    warrantyType: legacyEnumMaterialWarrantyWarrantyType('warranty_type'),
    startDate: date('start_date', { mode: 'string' }),
    expirationDate: date('expiration_date', { mode: 'string' }),
  },
)

/**
 * site_activity_logs — Global activity log: row id + table + action + user + php file.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacySiteActivityLogs = pgTable(
  'site_activity_logs',
  {
    id: serial('id').primaryKey(),
    rowId: integer('row_id'),
    tableName: varchar('table_name', { length: 50 }),
    logType: varchar('log_type', { length: 80 }),
    userId: integer('user_id'),
    logDate: timestamp('log_date', { mode: 'string', withTimezone: false }),
    phpFilename: varchar('php_filename', { length: 100 }),
    section: varchar('section', { length: 50 }),
    notesComments: text('notes_comments'),
  },
)

/**
 * site_address_change_log — Audit of site address changes detected by cron.
 * Rows observed: 0. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacySiteAddressChangeLog = pgTable(
  'site_address_change_log',
  {
    id: serial('id').primaryKey(),
    siteId: integer('site_id'),
    sageAddress: text('sage_address'),
    portalAddress: text('portal_address'),
    keepWarranty: varchar('keep_warranty', { length: 10 }),
    logDate: date('log_date', { mode: 'string' }),
  },
)

/**
 * site_warranty — Site-level warranty notes and expiration.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacySiteWarranty = pgTable(
  'site_warranty',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    siteId: integer('site_id').notNull(),
    warrantyNotes: text('warranty_notes'),
    expirationTimespan: integer('expiration_timespan'),
    expirationDate: date('expiration_date', { mode: 'string' }),
  },
  (table) => [
    index('legacy_site_warranty_site_id').on(table.siteId),
  ],
)

/**
 * subcontractor_additional_documents — Other compliance documents attached to a subcontractor.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacySubcontractorAdditionalDocuments = pgTable(
  'subcontractor_additional_documents',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    subid: integer('subid').notNull(),
    documentName: text('document_name'),
    fileName: varchar('file_name', { length: 200 }),
    documentNotes: text('document_notes'),
    uploadedTimespan: integer('uploaded_timespan'),
  },
)

/**
 * subcontractor_wsib_insurance_documents — WSIB / insurance certificate documents with expiry and reminder state.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacySubcontractorWsibInsuranceDocuments = pgTable(
  'subcontractor_wsib_insurance_documents',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    subid: integer('subid').notNull(),
    documentType: varchar('document_type', { length: 20 }),
    documentName: text('document_name'),
    fileName: varchar('file_name', { length: 200 }),
    isExpired: integer('is_expired'),
    expirationTimespan: integer('expiration_timespan'),
    expirationDate: date('expiration_date', { mode: 'string' }),
    uploadedTimespan: integer('uploaded_timespan'),
    nearExpireReminderDone: integer('near_expire_reminder_done'),
    sendEmailToSub: integer('send_email_to_sub'),
    emailSentSuccess: integer('email_sent_success'),
    lastReminderDate: date('last_reminder_date', { mode: 'string' }),
  },
)
