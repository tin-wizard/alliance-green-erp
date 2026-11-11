// @generated
// Source: packages/db/contract/schema.json (2026-11-11).
// Do not edit by hand. Run `pnpm db:generate:schema` after updating the contract.
// Domain: workorder

import { bigint, bigserial, date, index, integer, numeric, pgTable, serial, smallint, text, time, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core'


/**
 * workorder — Master work order (all types: subcontractor, local, project, TJX, PMA). `id` is assigned by the app, not AUTO_INCREMENT.
 * Rows observed: 42258. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 * `id` is app-assigned in the legacy system (`wo_next_pid`); it is NOT an identity here.
 */
export const legacyWorkorder = pgTable(
  'workorder',
  {
    id: integer('id').primaryKey().notNull(),
    // app-assigned (wo_next_pid), not AUTO_INCREMENT
    site: integer('site').notNull(),
    servicetype: smallint('servicetype').notNull(),
    priority: smallint('priority').notNull(),
    dne: integer('dne').notNull(),
    status: smallint('status').notNull(),
    // see STATUS-VOCABULARY.md (12 values)
    datetaken: date('datetaken', { mode: 'string' }).notNull(),
    expcompletion: date('expcompletion', { mode: 'string' }).notNull(),
    servicerequired: text('servicerequired').notNull(),
    notes: text('notes'),
    subcontractor: integer('subcontractor'),
    completiondate: varchar('completiondate', { length: 120 }),
    securitycode: varchar('securitycode', { length: 100 }),
    customerpo: varchar('customerpo', { length: 100 }),
    local: smallint('local').notNull(),
    tech: integer('tech'),
    // users.id where access = 3
    tech2: integer('tech_2'),
    techLabourRate: numeric('tech_labour_rate', { precision: 7, scale: 2 }),
    invdate: date('invdate', { mode: 'string' }),
    calcInvDate: date('calc_inv_date', { mode: 'string' }),
    customer: integer('customer'),
    // holds a SITE id in practice (28,587 rows match sites.id, 18,106 have no customer.id match)
    woFolderAttachPath: varchar('wo_folder_attach_path', { length: 200 }),
    printed: varchar('printed', { length: 10 }),
    batched: date('batched', { mode: 'string' }),
    // date the work order was exported to Sage
    schannel: integer('schannel').notNull(),
    schannelRedone: integer('schannel_redone'),
    sgsalesDone: integer('sgsales_done'),
    // set to 1 only after the Sage sales invoice is posted; also an edit lock
    sgpurchDone: integer('sgpurch_done'),
    forcedEnableScTransfer: integer('forced_enable_sc_transfer'),
    readyForCalcTimespan: bigint('ready_for_calc_timespan', { mode: 'number' }),
    closeoutTech: integer('closeout_tech'),
    closeoutTech2: integer('closeout_tech_2'),
    isMarkedRed: integer('is_marked_red'),
    isMarkedGreen: integer('is_marked_green'),
    isMarkedCritical: integer('is_marked_critical'),
    isProjectWo: smallint('is_project_wo'),
    customerQuoteId: varchar('customer_quote_id', { length: 50 }),
    isTjxQuote: integer('is_tjx_quote'),
    isPmaOrder: smallint('is_pma_order'),
    isPmaBckup: varchar('is_pma_bckup', { length: 12 }),
    stockUpdated: integer('stock_updated'),
    // set to 1 after the inventory movement; also an edit lock
    markedInvoicedTime: integer('marked_invoiced_time'),
    enableSaleStockUpdBtn: integer('enable_sale_stock_upd_btn'),
    onlyPortalStockUpdated: integer('only_portal_stock_updated'),
    // stock moved in the portal only, not in Sage; also an edit lock
    assignedDispatchId: integer('assigned_dispatch_id'),
    pmaOrderCategory: varchar('pma_order_category', { length: 25 }),
    primaryWorkorder: varchar('primary_workorder', { length: 20 }),
    addToLocalModifyOnce: integer('add_to_local_modify_once'),
    scPrimaryStatus: varchar('sc_primary_status', { length: 20 }),
    scExtendedStatus: varchar('sc_extended_status', { length: 20 }),
  },
  (table) => [
    index('legacy_workorder_local').on(table.local),
    index('legacy_workorder_status').on(table.status),
    index('legacy_workorder_subcontractor').on(table.subcontractor),
  ],
)

/**
 * localwo_cusprofile — Per-customer local-work settings/profile.
 * Rows observed: 93. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyLocalwoCusprofile = pgTable(
  'localwo_cusprofile',
  {
    id: serial('id').primaryKey(),
    site: integer('site').notNull(),
    interior: text('interior'),
    exterior: text('exterior'),
    mustnotes: text('mustnotes'),
    codes: text('codes'),
  },
)

/**
 * localwo_hours — Labour entered by local technicians (time in/out, num techs).
 * Rows observed: 16400. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyLocalwoHours = pgTable(
  'localwo_hours',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    woid: integer('woid').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    timein: time('timein').notNull(),
    timeout: time('timeout').notNull(),
    hours: numeric('hours', { precision: 7, scale: 2 }).notNull(),
    numtechs: integer('numtechs').notNull(),
    tech: integer('tech').notNull(),
  },
)

/**
 * localwo_hours_change_histroy — Audit of edits to `localwo_hours`.
 * Rows observed: 10313. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyLocalwoHoursChangeHistroy = pgTable(
  'localwo_hours_change_histroy',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    fkId: integer('fk_id'),
    woid: integer('woid'),
    date: date('date', { mode: 'string' }).notNull(),
    timein: time('timein').notNull(),
    timeout: time('timeout').notNull(),
    hours: numeric('hours', { precision: 7, scale: 2 }).notNull(),
    numtechs: integer('numtechs').notNull(),
    tech: integer('tech'),
  },
)

/**
 * localwo_quotes — Local work-order quote/summary rows.
 * Rows observed: 1315. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyLocalwoQuotes = pgTable(
  'localwo_quotes',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    tech: varchar('tech', { length: 100 }).notNull(),
    datetime: varchar('datetime', { length: 100 }).notNull(),
    report: text('report').notNull(),
    hours: varchar('hours', { length: 100 }).notNull(),
    numtechs: varchar('numtechs', { length: 100 }).notNull(),
    parts: text('parts'),
    soparts: text('soparts'),
  },
)

/**
 * localwo_sigs — Technician/customer signatures captured for a local work order.
 * Rows observed: 4998. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyLocalwoSigs = pgTable(
  'localwo_sigs',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
  },
)

/**
 * localwo_techs — Technicians assigned to a local work order.
 * Rows observed: 1321. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyLocalwoTechs = pgTable(
  'localwo_techs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    woid: integer('woid').notNull(),
    date: timestamp('date', { mode: 'string', withTimezone: false }),
    tech: integer('tech').notNull(),
  },
)

/**
 * wo_ajax_submit — Draft payloads saved by the work-order AJAX form.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyWoAjaxSubmit = pgTable(
  'wo_ajax_submit',
  {
    id: serial('id').primaryKey(),
    formdata: text('formdata'),
    woid: integer('woid'),
  },
)

/**
 * wo_hours — Labour lines on a work order. `rate` holds a rate *code* (1/2/3); `hourly_rate` is the resolved money rate.
 * Rows observed: 30517. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyWoHours = pgTable(
  'wo_hours',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    rate: smallint('rate'),
    // rate CODE 1/2/3, not money
    date: date('date', { mode: 'string' }).notNull(),
    hours: numeric('hours', { precision: 7, scale: 2 }).notNull(),
    hourlyRate: numeric('hourly_rate', { precision: 7, scale: 2 }),
    // resolved money rate; wins over the code when > 0
  },
)

/**
 * wo_images_cropped — Cropped images attached to work orders.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyWoImagesCropped = pgTable(
  'wo_images_cropped',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid'),
    croppedTime: timestamp('cropped_time', { mode: 'string', withTimezone: false }),
  },
)

/**
 * wo_invoiceno — Work order → Sage invoice number mapping.
 * Rows observed: 26529. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyWoInvoiceno = pgTable(
  'wo_invoiceno',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    invoiceno: varchar('invoiceno', { length: 120 }).notNull(),
  },
  (table) => [
    uniqueIndex('legacy_wo_invoiceno_woid').on(table.woid),
  ],
)

/**
 * wo_notes — Note and status-transition history per work order (prev/next status, public flag).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyWoNotes = pgTable(
  'wo_notes',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    userId: integer('user_id').notNull(),
    notes: text('notes'),
    title: varchar('title', { length: 100 }),
    emails: varchar('emails', { length: 100 }),
    notesType: varchar('notes_type', { length: 30 }),
    previousStatusId: integer('previous_status_id'),
    statusId: integer('status_id'),
    isPublic: smallint('is_public'),
    dateCreated: timestamp('date_created', { mode: 'string', withTimezone: false }),
  },
)

/**
 * wo_parts — Parts lines on a work order (the working estimate that gets copied to `inv_parts`).
 * Rows observed: 45390. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyWoParts = pgTable(
  'wo_parts',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    partno: varchar('partno', { length: 50 }).notNull(),
    qty: numeric('qty', { precision: 7, scale: 2 }).notNull(),
    price: numeric('price', { precision: 7, scale: 2 }),
  },
)

/**
 * wo_report — Service/technician report text, one row per work order; also posted to Sage as a zero-value labour line.
 * Rows observed: 39406. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyWoReport = pgTable(
  'wo_report',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    report: text('report'),
  },
  (table) => [
    uniqueIndex('legacy_wo_report_woid').on(table.woid),
  ],
)

/**
 * wo_revisions — Full revision snapshot of a work order and all its child rows (serialised in `data_*` columns).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyWoRevisions = pgTable(
  'wo_revisions',
  {
    revisionId: serial('revision_id').primaryKey(),
    // primary key of the revision chain
    woid: integer('woid'),
    createdTime: timestamp('created_time', { mode: 'string', withTimezone: false }),
    revisedByUser: integer('revised_by_user'),
    revisionType: varchar('revision_type', { length: 45 }),
    dataWorkorder: text('data_workorder'),
    dataWoHours: text('data_wo_hours'),
    dataWoLocalhours: text('data_wo_localhours'),
    dataWoParts: text('data_wo_parts'),
    dataWoSoparts: text('data_wo_soparts'),
    dataWoReport: text('data_wo_report'),
    dataWoTax: text('data_wo_tax'),
    dataWoNotes: text('data_wo_notes'),
    isLastRevision: integer('is_last_revision'),
  },
  (table) => [
    index('legacy_wo_revisions_woid').on(table.woid),
  ],
)

/**
 * wo_soparts — Special-order / non-stock part lines on a work order.
 * Rows observed: 27756. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyWoSoparts = pgTable(
  'wo_soparts',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    name: text('name').notNull(),
    qty: numeric('qty', { precision: 7, scale: 2 }).notNull(),
    // values <= -99999 are treated as deleted
    price: numeric('price', { precision: 7, scale: 2 }).notNull(),
    isEmergencyLighting: integer('is_emergency_lighting'),
  },
)

/**
 * wo_tax — Province/tax selection and computed tax for a work order (working copy).
 * Rows observed: 26530. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyWoTax = pgTable(
  'wo_tax',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    tax: numeric('tax', { precision: 7, scale: 2 }).notNull(),
    name: varchar('name', { length: 5 }).notNull(),
    taxTotal: numeric('tax_total', { precision: 7, scale: 2 }),
    taxGst: numeric('tax_gst', { precision: 7, scale: 2 }),
    taxPst: numeric('tax_pst', { precision: 7, scale: 2 }),
    appliedtaxrate: varchar('appliedtaxrate', { length: 15 }),
    appliedtaxratePst: varchar('appliedtaxrate_pst', { length: 15 }),
    appliedtaxrateGst: varchar('appliedtaxrate_gst', { length: 15 }),
  },
  (table) => [
    uniqueIndex('legacy_wo_tax_woid').on(table.woid),
  ],
)
