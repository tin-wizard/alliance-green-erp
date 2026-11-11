// @generated
// Source: packages/db/contract/schema.json (2026-11-11).
// Do not edit by hand. Run `pnpm db:generate:schema` after updating the contract.
// Domain: technical

import { bigint, integer, numeric, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'


/**
 * api_sc_callback_url_response — ServiceChannel callback responses.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyApiScCallbackUrlResponse = pgTable(
  'api_sc_callback_url_response',
  {
    id: serial('id').primaryKey(),
    notes: text('notes'),
    executeTimeint: bigint('execute_timeint', { mode: 'number' }),
    runtime: varchar('runtime', { length: 50 }),
  },
)

/**
 * api_sc_status_webhook — ServiceChannel status webhook payloads.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyApiScStatusWebhook = pgTable(
  'api_sc_status_webhook',
  {
    id: serial('id').primaryKey(),
    notes: text('notes'),
    jsonResponse: text('json_response'),
    executeTimeint: bigint('execute_timeint', { mode: 'number' }),
    hookname: varchar('hookname', { length: 80 }),
    eventType: varchar('event_type', { length: 50 }),
    woid: integer('woid'),
    customerpo: varchar('customerpo', { length: 50 }),
    statusPrimary: varchar('status_primary', { length: 30 }),
    statusExtended: varchar('status_extended', { length: 30 }),
    isRead: integer('is_read'),
    createdTime: timestamp('created_time', { mode: 'string', withTimezone: false }),
  },
)

/**
 * api_sc_webhook — Inbound ServiceChannel webhook payloads and derived statuses.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyApiScWebhook = pgTable(
  'api_sc_webhook',
  {
    id: serial('id').primaryKey(),
    notes: text('notes'),
    jsonResponse: text('json_response'),
    executeTimeint: bigint('execute_timeint', { mode: 'number' }),
    hookname: varchar('hookname', { length: 80 }),
    eventType: varchar('event_type', { length: 50 }),
    woid: integer('woid'),
    customerpo: varchar('customerpo', { length: 50 }),
    statusPrimary: varchar('status_primary', { length: 30 }),
    statusExtended: varchar('status_extended', { length: 30 }),
    isRead: integer('is_read'),
    createdTime: timestamp('created_time', { mode: 'string', withTimezone: false }),
  },
)

/**
 * cron_run_history — Cron execution log (cronname, execute_timeint, runtime).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCronRunHistory = pgTable(
  'cron_run_history',
  {
    id: serial('id').primaryKey(),
    cronname: varchar('cronname', { length: 50 }),
    executeTimeint: bigint('execute_timeint', { mode: 'number' }),
    runtime: varchar('runtime', { length: 50 }),
  },
)

/**
 * errors_log_info — Error log (woid, revision_type, user).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyErrorsLogInfo = pgTable(
  'errors_log_info',
  {
    id: serial('id').primaryKey(),
    woid: varchar('woid', { length: 100 }),
    createdTime: varchar('created_time', { length: 100 }),
    revisionType: varchar('revision_type', { length: 100 }),
    userId: varchar('user_id', { length: 100 }),
  },
)

/**
 * rejected_quotes — Quotes rejected by a customer (reason, content, who rejected).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyRejectedQuotes = pgTable(
  'rejected_quotes',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    dateRejected: integer('date_rejected').notNull(),
    rejectedReason: text('rejected_reason'),
    quoteContent: text('quote_content'),
    rejectedByDetail: varchar('rejected_by_detail', { length: 200 }),
  },
)

/**
 * servchannel_api_setting — ServiceChannel API settings (name/value).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyServchannelApiSetting = pgTable(
  'servchannel_api_setting',
  {
    id: serial('id').primaryKey(),
    settingName: varchar('setting_name', { length: 30 }),
    settingValue: varchar('setting_value', { length: 50 }),
  },
)

/**
 * signoff_cron — Work queue for extracting technician sign-off sheets from uploaded PDFs.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacySignoffCron = pgTable(
  'signoff_cron',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    isProcessed: integer('is_processed'),
    timespanUploaded: integer('timespan_uploaded'),
    timespanProcessed: integer('timespan_processed'),
    signatureFound: integer('signature_found'),
    isReviewed: integer('is_reviewed'),
  },
)

/**
 * undispatched_batch_upload — Batch-upload staging for undispatched work orders.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyUndispatchedBatchUpload = pgTable(
  'undispatched_batch_upload',
  {
    id: serial('id').primaryKey(),
    batchTimespan: bigint('batch_timespan', { mode: 'number' }),
  },
)

/**
 * undispatched_workorders — Imported-but-not-yet-created work orders from the dispatch feed.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyUndispatchedWorkorders = pgTable(
  'undispatched_workorders',
  {
    id: serial('id').primaryKey(),
    locationId: varchar('location_id', { length: 50 }),
    locationName: varchar('location_name', { length: 100 }),
    siteId: integer('site_id'),
    trackingNo: varchar('tracking_no', { length: 100 }),
    nte: numeric('nte', { precision: 7, scale: 2 }),
    address: varchar('address', { length: 100 }),
    province: varchar('province', { length: 8 }),
    city: varchar('city', { length: 100 }),
    category: text('category'),
    batchId: integer('batch_id'),
    batchType: varchar('batch_type', { length: 20 }),
    createdTimespan: bigint('created_timespan', { mode: 'number' }),
    isImported: integer('is_imported'),
    reUpdated: integer('re_updated'),
  },
)
