import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { app } from './base'

/**
 * Work Orders module — forward model.
 *
 * The legacy contract (`public.workorder`, `public.wo_*`, `public.localwo_*`) is
 * mirrored read-only elsewhere. This slice is the deliberate new model:
 *
 *  - `work_orders.id` is the work-order number, assigned by
 *    `work_order_number_series` (the `wo_next_pid` replacement). It is not an
 *    identity column, because the number is a business identifier.
 *  - `work_orders.site_id` replaces legacy `workorder.customer`, which in
 *    practice held a *site* id. The customer is derived through `sites.custid`.
 *  - statuses are the 12 legacy `wo_status` codes, stored verbatim
 *    (BUSINESS-RULES C5); `lib/status.ts` projects them for display.
 *  - money is `numeric(12,2)`, rates `numeric(9,4)`; never text, never float.
 *  - every child table points at `work_orders` with an app-side FK.
 *  - actor columns are uuids into `app.users` but without FK constraints, so
 *    this domain slice does not import the identity slice (avoids a circular
 *    schema module). The server layer always resolves the actor from a session.
 */

export const workOrderDocumentKind = app.enum('work_order_document_kind', [
  'photo',
  'document',
  'signature',
  'service_report',
  'other',
])

export const workOrderAssignmentRole = app.enum('work_order_assignment_role', [
  'lead',
  'assist',
  'subcontractor',
])

export const workOrderRevisionType = app.enum('work_order_revision_type', [
  'create',
  'update',
  'dispatch',
  'capture',
  'complete',
  'cancel',
  'manual',
])

export const workOrderNotificationStatus = app.enum('work_order_notification_status', [
  'queued',
  'sent',
  'failed',
  'skipped',
])

/**
 * The `wo_next_pid` replacement. id 1 is the main series, id 2 the maintenance
 * series. The allocator in `modules/work-orders/lib/numbering.ts` owns the
 * increment rules.
 */
export const workOrderNumberSeries = app.table(
  'work_order_number_series',
  {
    id: smallint('id').primaryKey(),
    nextId: integer('next_id').notNull(),
    description: text('description').notNull().default(''),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('work_order_number_series_id_check', sql`${table.id} in (1, 2)`)],
)

export const workOrders = app.table(
  'work_orders',
  {
    /** Business identifier (the WO number), assigned by the allocator. */
    id: integer('id').primaryKey(),
    /** 1 = main series, 2 = maintenance series (legacy `wo_next_pid.id`). */
    series: smallint('series').notNull().default(1),
    /** Legacy `workorder.customer` semantics: this holds a **site** id. */
    siteId: integer('site_id').notNull(),
    serviceTypeId: smallint('service_type_id').notNull().default(1),
    priorityId: smallint('priority_id').notNull().default(3),
    categoryId: smallint('category_id'),
    /** Legacy `wo_status` code 1-12, stored verbatim. */
    status: smallint('status').notNull().default(1),
    dateTaken: date('date_taken').notNull().default(sql`current_date`),
    expectedCompletion: date('expected_completion'),
    serviceRequired: text('service_required').notNull().default(''),
    notes: text('notes'),
    subcontractorId: integer('subcontractor_id'),
    securityCode: text('security_code'),
    customerPo: text('customer_po'),
    isLocal: boolean('is_local').notNull().default(false),
    isProject: boolean('is_project').notNull().default(false),
    isTjxQuote: boolean('is_tjx_quote').notNull().default(false),
    isPmaOrder: boolean('is_pma_order').notNull().default(false),
    isMarkedRed: boolean('is_marked_red').notNull().default(false),
    isMarkedGreen: boolean('is_marked_green').notNull().default(false),
    isMarkedCritical: boolean('is_marked_critical').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completionNote: text('completion_note'),
    invoicedAt: timestamp('invoiced_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    /** Legacy integration flags; also the invoice-immutability guard (B3). */
    sageSalesDone: boolean('sage_sales_done').notNull().default(false),
    stockUpdated: boolean('stock_updated').notNull().default(false),
    onlyPortalStockUpdated: boolean('only_portal_stock_updated').notNull().default(false),
    /** Optimistic concurrency. Every write increments and checks it. */
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('work_orders_status_check', sql`${table.status} between 1 and 12`),
    check('work_orders_series_check', sql`${table.series} in (1, 2)`),
    index('work_orders_status_idx').on(table.status),
    index('work_orders_series_status_idx').on(table.series, table.status),
    index('work_orders_site_idx').on(table.siteId),
    index('work_orders_subcontractor_idx').on(table.subcontractorId),
    index('work_orders_expected_completion_idx').on(table.expectedCompletion),
    index('work_orders_cursor_idx').on(table.dateTaken, table.id),
    index('work_orders_customer_po_idx').on(table.customerPo),
  ],
)

/** Technician and subcontractor assignment. Drives portal scoping. */
export const workOrderAssignments = app.table(
  'work_order_assignments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workOrderId: integer('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    techUserId: uuid('tech_user_id'),
    subcontractorId: integer('subcontractor_id'),
    role: workOrderAssignmentRole('role').notNull().default('assist'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    assignedBy: uuid('assigned_by'),
  },
  (table) => [
    index('work_order_assignments_wo_idx').on(table.workOrderId),
    index('work_order_assignments_tech_idx').on(table.techUserId),
    index('work_order_assignments_sub_idx').on(table.subcontractorId),
  ],
)

export const workOrderHours = app.table(
  'work_order_hours',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workOrderId: integer('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    lineDate: date('line_date').notNull(),
    hours: numeric('hours', { precision: 7, scale: 2 }).notNull(),
    /** Legacy rate code 1/2/3. Informational; `hourlyRate` is the money rate. */
    rateCode: smallint('rate_code').notNull().default(1),
    hourlyRate: numeric('hourly_rate', { precision: 9, scale: 2 }).notNull(),
    techUserId: uuid('tech_user_id'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => [index('work_order_hours_wo_idx').on(table.workOrderId, table.lineDate)],
)

export const workOrderParts = app.table(
  'work_order_parts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workOrderId: integer('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    partNo: text('part_no').notNull(),
    description: text('description'),
    qty: numeric('qty', { precision: 9, scale: 2 }).notNull(),
    price: numeric('price', { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => [index('work_order_parts_wo_idx').on(table.workOrderId)],
)

export const workOrderSpecialParts = app.table(
  'work_order_special_parts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workOrderId: integer('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    qty: numeric('qty', { precision: 9, scale: 2 }).notNull(),
    price: numeric('price', { precision: 12, scale: 2 }).notNull(),
    isEmergencyLighting: boolean('is_emergency_lighting').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => [index('work_order_special_parts_wo_idx').on(table.workOrderId)],
)

/** Working tax selection; the invoice snapshot is produced on demand. */
export const workOrderTax = app.table('work_order_tax', {
  workOrderId: integer('work_order_id')
    .primaryKey()
    .references(() => workOrders.id, { onDelete: 'cascade' }),
  taxProvince: text('tax_province').notNull().default('ON'),
  appliedTaxRate: numeric('applied_tax_rate', { precision: 9, scale: 5 }),
  appliedTaxRatePst: numeric('applied_tax_rate_pst', { precision: 9, scale: 5 }),
  /** Operator-posted tax, honoured only while `manualSubtotalAmount` matches. */
  manualTaxAmount: numeric('manual_tax_amount', { precision: 12, scale: 2 }),
  manualSubtotalAmount: numeric('manual_subtotal_amount', { precision: 12, scale: 2 }),
  subtotalAmount: numeric('subtotal_amount', { precision: 12, scale: 2 }),
  taxTotal: numeric('tax_total', { precision: 12, scale: 2 }),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }),
  computedAt: timestamp('computed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Service report, one per work order (`wo_report`). */
export const workOrderReports = app.table('work_order_reports', {
  workOrderId: integer('work_order_id')
    .primaryKey()
    .references(() => workOrders.id, { onDelete: 'cascade' }),
  report: text('report').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
})

/** Notes and status-transition history (`wo_notes`). */
export const workOrderNotes = app.table(
  'work_order_notes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workOrderId: integer('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    userId: uuid('user_id'),
    title: text('title'),
    notes: text('notes'),
    /** `note`, `status`, `dispatch`, `completion`, `system`. */
    notesType: text('notes_type').notNull().default('note'),
    previousStatus: smallint('previous_status'),
    statusId: smallint('status_id'),
    isPublic: boolean('is_public').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('work_order_notes_wo_idx').on(table.workOrderId, table.createdAt)],
)

/** Full revision snapshots; `is_last_revision` marks the chain end (C7). */
export const workOrderRevisions = app.table(
  'work_order_revisions',
  {
    revisionId: bigserial('revision_id', { mode: 'number' }).primaryKey(),
    workOrderId: integer('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revisedByUserId: uuid('revised_by_user_id'),
    revisionType: workOrderRevisionType('revision_type').notNull().default('manual'),
    /** The event name the legacy portal wrote (`OnSubmitEditWo`), kept verbatim beside the mapped type. */
    legacyRevisionType: text('legacy_revision_type'),
    dataWorkorder: jsonb('data_workorder').$type<Record<string, unknown>>(),
    dataWoHours: jsonb('data_wo_hours').$type<unknown[]>(),
    dataWoLocalHours: jsonb('data_wo_local_hours').$type<unknown[]>(),
    dataWoParts: jsonb('data_wo_parts').$type<unknown[]>(),
    dataWoSoparts: jsonb('data_wo_soparts').$type<unknown[]>(),
    dataWoReport: jsonb('data_wo_report').$type<Record<string, unknown> | null>(),
    dataWoTax: jsonb('data_wo_tax').$type<Record<string, unknown> | null>(),
    dataWoNotes: jsonb('data_wo_notes').$type<unknown[]>(),
    isLastRevision: boolean('is_last_revision').notNull().default(true),
  },
  (table) => [
    index('work_order_revisions_wo_idx').on(table.workOrderId, table.createdAt),
    uniqueIndex('work_order_revisions_chain_end')
      .on(table.workOrderId)
      .where(sql`${table.isLastRevision}`),
  ],
)

export const workOrderDocuments = app.table(
  'work_order_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workOrderId: integer('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    kind: workOrderDocumentKind('kind').notNull().default('document'),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type'),
    sizeBytes: integer('size_bytes'),
    caption: text('caption'),
    isPublic: boolean('is_public').notNull().default(false),
    retentionUntil: date('retention_until'),
    uploadedBy: uuid('uploaded_by'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('work_order_documents_wo_idx').on(table.workOrderId, table.kind)],
)

/**
 * Notification triggers (dispatch, reminder, completion). Delivery is deferred:
 * the row is the event, `status` moves when a delivery worker exists.
 */
export const workOrderNotifications = app.table(
  'work_order_notifications',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workOrderId: integer('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    channel: text('channel').notNull().default('email'),
    recipient: text('recipient'),
    subject: text('subject'),
    body: text('body'),
    status: workOrderNotificationStatus('status').notNull().default('queued'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => [index('work_order_notifications_status_idx').on(table.status, table.createdAt)],
)

/* ------------------------------------------------------------------ *
 * Local work orders (in-house technicians)                            *
 * ------------------------------------------------------------------ */

export const localWorkOrderHours = app.table(
  'local_work_order_hours',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workOrderId: integer('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    lineDate: date('line_date').notNull(),
    timeIn: time('time_in'),
    timeOut: time('time_out'),
    hours: numeric('hours', { precision: 7, scale: 2 }).notNull(),
    headcount: integer('headcount').notNull().default(1),
    techUserId: uuid('tech_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => [index('local_work_order_hours_wo_idx').on(table.workOrderId, table.lineDate)],
)

export const localWorkOrderTechs = app.table(
  'local_work_order_techs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workOrderId: integer('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    techUserId: uuid('tech_user_id').notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    assignedBy: uuid('assigned_by'),
  },
  (table) => [
    uniqueIndex('local_work_order_techs_unique').on(table.workOrderId, table.techUserId),
    index('local_work_order_techs_tech_idx').on(table.techUserId),
  ],
)

export const localWorkOrderSignatures = app.table(
  'local_work_order_signatures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workOrderId: integer('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    signerName: text('signer_name').notNull(),
    storageKey: text('storage_key').notNull(),
    note: text('note'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    capturedBy: uuid('captured_by'),
  },
  (table) => [index('local_work_order_signatures_wo_idx').on(table.workOrderId)],
)

export type WorkOrder = typeof workOrders.$inferSelect
export type NewWorkOrder = typeof workOrders.$inferInsert
export type WorkOrderHour = typeof workOrderHours.$inferSelect
export type WorkOrderPart = typeof workOrderParts.$inferSelect
export type WorkOrderSpecialPart = typeof workOrderSpecialParts.$inferSelect
export type WorkOrderDocument = typeof workOrderDocuments.$inferSelect
export type WorkOrderRevision = typeof workOrderRevisions.$inferSelect
export type WorkOrderNote = typeof workOrderNotes.$inferSelect
export type LocalWorkOrderHour = typeof localWorkOrderHours.$inferSelect
export type WorkOrderNumberSeriesRow = typeof workOrderNumberSeries.$inferSelect
