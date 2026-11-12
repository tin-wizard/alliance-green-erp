/**
 * Group 6 — work orders (plan §2.5 step 6).
 *
 * `workorder` is both the header and the business key: its `id` is the work-order
 * number the legacy app allocated from `wo_next_pid`, so `app.work_orders.id` is
 * that same number and there is no separate `legacy_id`.
 *
 * Three rules from `plan/CUTOVER-AND-MIGRATION.md` §2.6 and §5 shape this file:
 *
 *  - `workorder.customer` holds a **site** id in practice (28,587 of the rows);
 *    `workorder.site` is used only when `customer` does not resolve. Either way
 *    the decision is written to `migration.exceptions` when it is not the plain
 *    case, because "which id did we believe" is the question the parity run asks.
 *  - Placeholder work orders (`99999999`, `44444444`, `9999999`, `9999998`, `0`)
 *    are not work; they are quarantined and never enter `app.work_orders`.
 *  - Money and dates go through `helpers.money`/`date`/`timestamp`, so a blank
 *    amount is null (or a recorded 0.00 where the column forbids null) and a zero
 *    date is null, never 1970.
 *
 * Children resolve their parent through `migration.row_map` and fall back to
 * `app.work_orders.id`, which is the same number. A child whose parent is missing
 * is an `orphan_line`: the parent is never invented.
 */
import { eq, sql } from 'drizzle-orm'
import type { Tx } from '@cls/db'
import {
  localWorkOrderHours,
  localWorkOrderTechs,
  salesInvoices,
  sageLinks,
  sites,
  subcontractors,
  users,
  workOrderHours,
  workOrderNotes,
  workOrderParts,
  workOrderReports,
  workOrderRevisions,
  workOrders,
  workOrderSpecialParts,
  workOrderTax,
} from '@cls/db/schema'
import type { GroupTransformer, TransformContext, TransformHelpers } from '../types'

const GROUP = 'work-orders'

/** The 12 legacy `wo_status` codes, stored verbatim (BUSINESS-RULES C5). */
const WO_STATUS_CODES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const
const WO_NOTE_TYPES = ['note', 'status', 'dispatch', 'completion', 'system'] as const
const WO_REVISION_TYPES = [
  'create',
  'update',
  'dispatch',
  'capture',
  'complete',
  'cancel',
  'manual',
] as const

/** §5: these ids are operator placeholders, not work orders. */
const PLACEHOLDER_WORK_ORDERS = new Set(['99999999', '44444444', '9999999', '9999998', '0'])

/** Part numbers legacy used to mean "no part" (§5: 110 of 113 unresolved lines). */
const UNRESOLVED_PART_NUMBERS = new Set(['---', '-', 'n/a', 'na', 'tbd'])

/** Manifest entity per legacy table, for `row_map` and `migration.exceptions`. */
const LEGACY_TO_ENTITY: Record<string, string> = {
  workorder: 'work_order',
  wo_hours: 'work_order_hour',
  localwo_hours: 'local_work_order_hour',
  localwo_techs: 'local_work_order_tech',
  wo_soparts: 'work_order_special_part',
  wo_parts: 'work_order_part',
  wo_tax: 'work_order_tax',
  wo_report: 'work_order_report',
  wo_notes: 'work_order_note',
  wo_revisions: 'work_order_revision',
  wo_invoiceno: 'work_order_invoice_number',
  wo_images_cropped: 'work_order_image',
}

type ExceptionInput = Parameters<TransformHelpers['exception']>[0]

/**
 * `types.ts`'s `ExceptionClass` union predates these groups: it lists the classes
 * the plan measured, not the ones this group's rules introduce. The column is free
 * text and `helpers.exception` already casts, so the extra labels land as written;
 * they should be added to the union when `types.ts` is next edited.
 */
async function recordException(
  helpers: TransformHelpers,
  input: Omit<ExceptionInput, 'exceptionClass'> & { exceptionClass: string },
): Promise<void> {
  await helpers.exception({
    ...input,
    exceptionClass: input.exceptionClass as ExceptionInput['exceptionClass'],
  })
}

function entityFor(table: string): string {
  return LEGACY_TO_ENTITY[table] ?? 'work_order'
}

function intOf(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

/** A rate or percentage, kept as a decimal string with room for 5 places. */
function decimalOf(raw: string | null): string | null {
  if (raw === null) return null
  const trimmed = raw.trim().replace(/%$/, '')
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed.toFixed(5) : null
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/
const CLOCK = /^\d{2}:\d{2}(:\d{2})?$/

/**
 * Cache of a validated wall-clock timestamp. Drizzle's insert type for a
 * `timestamp` column is `Date`, but the legacy wall clock must not go through a JS
 * `Date`: that turns local wall clock into a UTC instant and shifts it for any
 * reader in another zone. Postgres parses the ISO text in the session timezone,
 * which is exactly what MySQL wrote, so the value is handed over as SQL.
 */
function stamp(value: string | null): Date | null {
  return value === null ? null : (sql`${value}::timestamp` as unknown as Date)
}

async function timestampOf(
  helpers: TransformHelpers,
  context: TransformContext,
  column: string,
): Promise<string | null> {
  const value = helpers.timestamp(column)
  if (value === null) return null
  if (ISO_TIMESTAMP.test(value)) return value
  await recordException(helpers, {
    exceptionClass: 'unparseable_timestamp',
    entity: entityFor(context.table),
    sourceKey: context.sourceKey,
    action: 'stored NULL timestamp',
    notes: `${column} = ${JSON.stringify(value)} is not wall-clock ISO text`,
  })
  return null
}

function clockOf(helpers: TransformHelpers, column: string): string | null {
  const value = helpers.text(column)
  if (value === null) return null
  return CLOCK.test(value) ? value : null
}

/**
 * A money column the target declares NOT NULL cannot hold null, so an unreadable
 * legacy amount becomes 0.00 **and a recorded exception** — never a silent zero.
 */
async function requiredMoney(
  helpers: TransformHelpers,
  context: TransformContext,
  column: string,
): Promise<string> {
  const value = helpers.money(column)
  if (value !== null) return value
  const raw = (context.row[column] ?? '').trim()
  await recordException(helpers, {
    exceptionClass: raw === '' ? 'blank_money' : 'unparseable_money',
    entity: entityFor(context.table),
    sourceKey: context.sourceKey,
    action: 'stored 0.00 because the target column is NOT NULL',
    notes: `${column} = ${JSON.stringify(context.row[column])}`,
  })
  return '0.00'
}

async function parseJson(
  helpers: TransformHelpers,
  context: TransformContext,
  column: string,
): Promise<unknown> {
  const text = helpers.text(column)
  if (text === null) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    await recordException(helpers, {
      exceptionClass: 'unparseable_json',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'stored NULL snapshot',
      notes: `${column} is not JSON; ${String(text.length)} characters stay in staging`,
    })
    return null
  }
}

async function alreadyMapped(context: TransformContext): Promise<boolean> {
  const existing = await context.helpers.targetKey(
    entityFor(context.table),
    context.table,
    context.sourceKey,
  )
  return existing !== null
}

async function rememberRow(
  context: TransformContext,
  targetTable: string,
  targetKey: string,
): Promise<void> {
  await context.helpers.remember({
    entity: entityFor(context.table),
    sourceTable: context.table,
    sourceKey: context.sourceKey,
    targetTable,
    targetKey,
  })
}

/* ------------------------------ parent lookups ----------------------------- */

async function resolveSite(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('site', 'sites', String(legacyId))
  const candidate = intOf(mapped) ?? legacyId
  const [row] = await tx
    .select({ id: sites.id })
    .from(sites)
    .where(eq(sites.id, candidate))
    .limit(1)
  return row?.id ?? null
}

async function resolveSubcontractor(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('subcontractor', 'subcontractor', String(legacyId))
  const candidate = intOf(mapped) ?? legacyId
  const [row] = await tx
    .select({ id: subcontractors.id })
    .from(subcontractors)
    .where(eq(subcontractors.id, candidate))
    .limit(1)
  return row?.id ?? null
}

/** `app.users.legacy_id` is the fallback when identity has not written a mapping. */
async function resolveUser(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<string | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('user', 'users', String(legacyId))
  if (mapped !== null) return mapped
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.legacyId, legacyId))
    .limit(1)
  return row?.id ?? null
}

interface WorkOrderParent {
  id: number
  dateTaken: string
}

async function resolveWorkOrderParent(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<WorkOrderParent | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('work_order', 'workorder', String(legacyId))
  const candidate = intOf(mapped) ?? legacyId
  const [row] = await tx
    .select({ id: workOrders.id, dateTaken: workOrders.dateTaken })
    .from(workOrders)
    .where(eq(workOrders.id, candidate))
    .limit(1)
  return row ?? null
}

async function requireWorkOrder(
  context: TransformContext,
  column: string,
): Promise<WorkOrderParent | null> {
  const { tx, helpers } = context
  const parent = await resolveWorkOrderParent(tx, helpers, helpers.int(column))
  if (parent === null) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'row not inserted: work_order_id is NOT NULL and the parent does not exist',
      notes: `${column} = ${JSON.stringify(context.row[column])}`,
    })
  }
  return parent
}

/* --------------------------------- headers -------------------------------- */

async function transformWorkOrder(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const rawId = (context.row.id ?? '').trim()
  const id = intOf(rawId)

  if (id === null || PLACEHOLDER_WORK_ORDERS.has(rawId)) {
    // §5: the placeholders are operator scratch rows. They are quarantined with
    // their raw values so a human can archive or explicitly import them later.
    await helpers.exception({
      exceptionClass: 'placeholder_work_order',
      entity: 'work_order',
      sourceKey,
      action: 'row not inserted into app.work_orders; owner ops decides its fate',
      notes: `workorder.id = ${JSON.stringify(context.row.id)}`,
    })
    return
  }

  // The header carries the number in `id` only. If a future dump also carries
  // `woid`/`workorder_num`, a disagreement is reported, never guessed away.
  for (const column of ['woid', 'workorder_num', 'work_order_num']) {
    const other = intOf(context.row[column])
    if (other !== null && other !== id) {
      await recordException(helpers, {
        exceptionClass: 'woid_mismatch',
        entity: 'work_order',
        sourceKey,
        action: 'row not inserted: id and the secondary key disagree',
        notes: `id = ${String(id)}, ${column} = ${String(other)}`,
      })
      return
    }
  }

  // §2.6: `customer` is a site id in practice; `site` is the fallback and the
  // precedence is recorded when the fallback is what resolved.
  const customerId = helpers.int('customer')
  const siteColumnId = helpers.int('site')
  let siteId = await resolveSite(tx, helpers, customerId)
  if (siteId === null) {
    const fallback = await resolveSite(tx, helpers, siteColumnId)
    if (fallback !== null) {
      siteId = fallback
      await helpers.exception({
        exceptionClass: 'orphan_workorder_site',
        entity: 'work_order',
        sourceKey,
        action: 'mapped via workorder.site because workorder.customer does not resolve',
        notes: `customer = ${JSON.stringify(context.row.customer)}, site = ${JSON.stringify(context.row.site)}`,
      })
    }
  }
  if (siteId === null) {
    const preserved = customerId ?? siteColumnId
    if (preserved === null) {
      await helpers.exception({
        exceptionClass: 'orphan_workorder_site',
        entity: 'work_order',
        sourceKey,
        action: 'row not inserted: no site id on the row and site_id is NOT NULL',
        notes: `customer = ${JSON.stringify(context.row.customer)}, site = ${JSON.stringify(context.row.site)}`,
      })
      return
    }
    // The raw id is preserved (the column has no FK) so the work order is not
    // lost; the exception is what tells operations the site must be imported.
    siteId = preserved
    await helpers.exception({
      exceptionClass: 'orphan_workorder_site',
      entity: 'work_order',
      sourceKey,
      action: 'raw legacy site id preserved in site_id; no app.sites row exists',
      notes: `customer = ${JSON.stringify(context.row.customer)}, site = ${JSON.stringify(context.row.site)}`,
    })
  }

  const statusLabel = helpers.enumOf('status', WO_STATUS_CODES)
  if (statusLabel === null && (context.row.status ?? '').trim() !== '') {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity: 'work_order',
      sourceKey,
      action: 'stored status 1 (Active) because the target column is NOT NULL',
      notes: `status = ${JSON.stringify(context.row.status)} is not one of 1-12`,
    })
  }

  const subcontractorId = await resolveSubcontractor(tx, helpers, helpers.int('subcontractor'))
  if (subcontractorId === null && (context.row.subcontractor ?? '').trim() !== '') {
    await helpers.exception({
      exceptionClass: 'subcontractor_without_vendor',
      entity: 'work_order',
      sourceKey,
      action: 'stored NULL subcontractor_id',
      notes: `subcontractor = ${JSON.stringify(context.row.subcontractor)} has no app.subcontractors row`,
    })
  }

  const dateTaken = helpers.date('datetaken')
  const invoicedOn = helpers.date('invdate')

  const values: typeof workOrders.$inferInsert = {
    id,
    siteId,
    serviceTypeId: helpers.int('servicetype') ?? 1,
    priorityId: helpers.int('priority') ?? 3,
    status: statusLabel === null ? 1 : Number(statusLabel),
    ...(dateTaken === null ? {} : { dateTaken }),
    expectedCompletion: helpers.date('expcompletion'),
    serviceRequired: helpers.text('servicerequired') ?? '',
    notes: helpers.text('notes'),
    subcontractorId,
    securityCode: helpers.text('securitycode'),
    customerPo: helpers.text('customerpo'),
    isLocal: helpers.flag('local') === 1,
    isProject: helpers.flag('is_project_wo') === 1,
    isTjxQuote: helpers.flag('is_tjx_quote') === 1,
    isPmaOrder: helpers.flag('is_pma_order') === 1,
    isMarkedRed: helpers.flag('is_marked_red') === 1,
    isMarkedGreen: helpers.flag('is_marked_green') === 1,
    isMarkedCritical: helpers.flag('is_marked_critical') === 1,
    completedAt: stamp(await timestampOf(helpers, context, 'completiondate')),
    invoicedAt: invoicedOn === null ? null : stamp(`${invoicedOn}T00:00:00`),
    sageSalesDone: helpers.flag('sgsales_done') === 1,
    stockUpdated: helpers.flag('stock_updated') === 1,
    onlyPortalStockUpdated: helpers.flag('only_portal_stock_updated') === 1,
  }

  const { id: _number, ...updates } = values
  await tx
    .insert(workOrders)
    .values(values)
    .onConflictDoUpdate({ target: workOrders.id, set: updates })
  await rememberRow(context, 'work_orders', String(id))
}

/* -------------------------------- children -------------------------------- */

async function transformWorkOrderHour(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const parent = await requireWorkOrder(context, 'woid')
  if (parent === null) return

  const lineDate = helpers.date('date')
  if (lineDate === null) {
    // A labour line with no date cannot be placed in time; the work order's own
    // date is the only defensible stand-in and the substitution is recorded.
    await recordException(helpers, {
      exceptionClass: 'zero_date',
      entity: 'work_order_hour',
      sourceKey: context.sourceKey,
      action: 'line dated from the work order date',
      notes: `woid = ${JSON.stringify(context.row.woid)}, date = ${JSON.stringify(context.row.date)}`,
    })
  }

  const [inserted] = await tx
    .insert(workOrderHours)
    .values({
      workOrderId: parent.id,
      lineDate: lineDate ?? parent.dateTaken,
      hours: await requiredMoney(helpers, context, 'hours'),
      rateCode: helpers.int('rate') ?? 1,
      hourlyRate: await requiredMoney(helpers, context, 'hourly_rate'),
      note: null,
    })
    .returning({ id: workOrderHours.id })
  await rememberRow(context, 'work_order_hours', String(inserted!.id))
}

async function transformLocalWorkOrderHour(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const parent = await requireWorkOrder(context, 'woid')
  if (parent === null) return

  const lineDate = helpers.date('date')
  if (lineDate === null) {
    await recordException(helpers, {
      exceptionClass: 'zero_date',
      entity: 'local_work_order_hour',
      sourceKey: context.sourceKey,
      action: 'line dated from the work order date',
      notes: `woid = ${JSON.stringify(context.row.woid)}, date = ${JSON.stringify(context.row.date)}`,
    })
  }

  const techUserId = await resolveUser(tx, helpers, helpers.int('tech'))
  if (techUserId === null && (context.row.tech ?? '').trim() !== '') {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: 'local_work_order_hour',
      sourceKey: context.sourceKey,
      action: 'stored NULL tech_user_id',
      notes: `tech = ${JSON.stringify(context.row.tech)} has no app.users row`,
    })
  }

  const [inserted] = await tx
    .insert(localWorkOrderHours)
    .values({
      workOrderId: parent.id,
      lineDate: lineDate ?? parent.dateTaken,
      timeIn: clockOf(helpers, 'timein'),
      timeOut: clockOf(helpers, 'timeout'),
      hours: await requiredMoney(helpers, context, 'hours'),
      headcount: helpers.int('numtechs') ?? 1,
      techUserId,
    })
    .returning({ id: localWorkOrderHours.id })
  await rememberRow(context, 'local_work_order_hours', String(inserted!.id))
}

async function transformLocalWorkOrderTech(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const parent = await requireWorkOrder(context, 'woid')
  if (parent === null) return

  const techUserId = await resolveUser(tx, helpers, helpers.int('tech'))
  if (techUserId === null) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: 'local_work_order_tech',
      sourceKey: context.sourceKey,
      action: 'row not inserted: tech_user_id is NOT NULL and the user does not exist',
      notes: `tech = ${JSON.stringify(context.row.tech)}`,
    })
    return
  }

  const assignedAt = stamp(await timestampOf(helpers, context, 'date'))
  const [inserted] = await tx
    .insert(localWorkOrderTechs)
    .values({
      workOrderId: parent.id,
      techUserId,
      ...(assignedAt === null ? {} : { assignedAt }),
    })
    .onConflictDoUpdate({
      target: [localWorkOrderTechs.workOrderId, localWorkOrderTechs.techUserId],
      set: assignedAt === null ? {} : { assignedAt },
    })
    .returning({ id: localWorkOrderTechs.id })
  await rememberRow(context, 'local_work_order_techs', String(inserted!.id))
}

async function transformWorkOrderSpecialPart(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const parent = await requireWorkOrder(context, 'woid')
  if (parent === null) return

  const qty = helpers.money('qty')
  if (qty !== null && Number(qty) <= -99999) {
    // Legacy marks a removed special line with a -99999 quantity sentinel; the
    // pricing calculators skip it, and so does the migration.
    await recordException(helpers, {
      exceptionClass: 'legacy_deleted_line',
      entity: 'work_order_special_part',
      sourceKey: context.sourceKey,
      action: 'line not inserted: the -99999 quantity is the legacy deleted marker',
      notes: `name = ${JSON.stringify(context.row.name)}, qty = ${JSON.stringify(context.row.qty)}`,
    })
    return
  }

  const [inserted] = await tx
    .insert(workOrderSpecialParts)
    .values({
      workOrderId: parent.id,
      name: helpers.text('name') ?? '',
      qty: await requiredMoney(helpers, context, 'qty'),
      price: await requiredMoney(helpers, context, 'price'),
      isEmergencyLighting: helpers.flag('is_emergency_lighting') === 1,
    })
    .returning({ id: workOrderSpecialParts.id })
  await rememberRow(context, 'work_order_special_parts', String(inserted!.id))
}

async function transformWorkOrderPart(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const parent = await requireWorkOrder(context, 'woid')
  if (parent === null) return

  const partNo = helpers.text('partno')
  if (partNo === null || UNRESOLVED_PART_NUMBERS.has(partNo.toLowerCase())) {
    // §5: the line is kept so the work order's totals do not change, and the row
    // is recorded so operations can map it to a real part or a special line.
    await recordException(helpers, {
      exceptionClass: 'unresolved_part_line',
      entity: 'work_order_part',
      sourceKey: context.sourceKey,
      action: 'line kept with its non-part number; not linked to a part',
      notes: `woid = ${JSON.stringify(context.row.woid)}, partno = ${JSON.stringify(context.row.partno)}`,
    })
  }

  const [inserted] = await tx
    .insert(workOrderParts)
    .values({
      workOrderId: parent.id,
      partNo: partNo ?? '',
      description: null,
      qty: await requiredMoney(helpers, context, 'qty'),
      price: await requiredMoney(helpers, context, 'price'),
    })
    .returning({ id: workOrderParts.id })
  await rememberRow(context, 'work_order_parts', String(inserted!.id))
}

async function transformWorkOrderTaxRow(context: TransformContext): Promise<void> {
  const { tx, helpers } = context
  const parent = await requireWorkOrder(context, 'woid')
  if (parent === null) return

  const values = {
    workOrderId: parent.id,
    taxProvince: helpers.text('name') ?? 'ON',
    appliedTaxRate: decimalOf(helpers.text('appliedtaxrate')),
    appliedTaxRatePst: decimalOf(helpers.text('appliedtaxrate_pst')),
    taxTotal: helpers.money('tax_total'),
  }
  await tx
    .insert(workOrderTax)
    .values(values)
    .onConflictDoUpdate({ target: workOrderTax.workOrderId, set: values })
  await rememberRow(context, 'work_order_tax', String(parent.id))
}

async function transformWorkOrderReport(context: TransformContext): Promise<void> {
  const { tx, helpers } = context
  const parent = await requireWorkOrder(context, 'woid')
  if (parent === null) return

  const values = { workOrderId: parent.id, report: helpers.text('report') ?? '' }
  await tx
    .insert(workOrderReports)
    .values(values)
    .onConflictDoUpdate({ target: workOrderReports.workOrderId, set: values })
  await rememberRow(context, 'work_order_reports', String(parent.id))
}

async function transformWorkOrderNote(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const parent = await requireWorkOrder(context, 'woid')
  if (parent === null) return

  const notesType = helpers.enumOf('notes_type', WO_NOTE_TYPES)
  if (notesType === null && (context.row.notes_type ?? '').trim() !== '') {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity: 'work_order_note',
      sourceKey: context.sourceKey,
      action: "stored notes_type 'note'",
      notes: `notes_type = ${JSON.stringify(context.row.notes_type)}`,
    })
  }

  const createdAt = stamp(await timestampOf(helpers, context, 'date_created'))
  const [inserted] = await tx
    .insert(workOrderNotes)
    .values({
      workOrderId: parent.id,
      userId: await resolveUser(tx, helpers, helpers.int('user_id')),
      title: helpers.text('title'),
      notes: helpers.text('notes'),
      notesType: notesType ?? 'note',
      previousStatus: helpers.int('previous_status_id'),
      statusId: helpers.int('status_id'),
      isPublic: helpers.flag('is_public') === 1,
      ...(createdAt === null ? {} : { createdAt }),
    })
    .returning({ id: workOrderNotes.id })
  await rememberRow(context, 'work_order_notes', String(inserted!.id))
}

async function transformWorkOrderRevision(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const parent = await requireWorkOrder(context, 'woid')
  if (parent === null) return

  const revisionType = helpers.enumOf('revision_type', WO_REVISION_TYPES)
  if (revisionType === null && (context.row.revision_type ?? '').trim() !== '') {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity: 'work_order_revision',
      sourceKey,
      action: "stored revision_type 'manual'",
      notes: `revision_type = ${JSON.stringify(context.row.revision_type)}`,
    })
  }

  const createdAt = stamp(await timestampOf(helpers, context, 'created_time'))
  const values: typeof workOrderRevisions.$inferInsert = {
    workOrderId: parent.id,
    revisedByUserId: await resolveUser(tx, helpers, helpers.int('revised_by_user')),
    revisionType: revisionType ?? 'manual',
    dataWorkorder: (await parseJson(helpers, context, 'data_workorder')) as Record<
      string,
      unknown
    > | null,
    dataWoHours: (await parseJson(helpers, context, 'data_wo_hours')) as unknown[] | null,
    dataWoLocalHours: (await parseJson(helpers, context, 'data_wo_localhours')) as unknown[] | null,
    dataWoParts: (await parseJson(helpers, context, 'data_wo_parts')) as unknown[] | null,
    dataWoSoparts: (await parseJson(helpers, context, 'data_wo_soparts')) as unknown[] | null,
    dataWoReport: (await parseJson(helpers, context, 'data_wo_report')) as Record<
      string,
      unknown
    > | null,
    dataWoTax: (await parseJson(helpers, context, 'data_wo_tax')) as Record<string, unknown> | null,
    dataWoNotes: (await parseJson(helpers, context, 'data_wo_notes')) as unknown[] | null,
    isLastRevision: helpers.flag('is_last_revision') === 1,
    ...(createdAt === null ? {} : { createdAt }),
  }

  const revisionId = intOf(context.row.revision_id)
  if (revisionId === null) {
    const [inserted] = await tx
      .insert(workOrderRevisions)
      .values(values)
      .returning({ id: workOrderRevisions.revisionId })
    await rememberRow(context, 'work_order_revisions', String(inserted!.id))
    return
  }

  // The legacy revision id is kept as the target id so the chain stays auditable
  // and a replay updates the row instead of appending a duplicate. The sequence
  // is moved past it so a new revision cannot reuse the number.
  await tx
    .insert(workOrderRevisions)
    .values({ ...values, revisionId })
    .onConflictDoUpdate({ target: workOrderRevisions.revisionId, set: values })
  await rememberRow(context, 'work_order_revisions', String(revisionId))
  await tx.execute(
    sql`select setval(pg_get_serial_sequence('app.work_order_revisions', 'revision_id'), greatest((select coalesce(max(revision_id), 1) from app.work_order_revisions), 1))`,
  )
}

/**
 * `wo_invoiceno` is the legacy record of the Sage invoice number a work order was
 * posted under. The new home is `app.sage_links`, keyed by the sales invoice, so
 * the row can only be written once the invoicing group has created that invoice.
 * Until then the number is preserved in the exception ledger, not lost.
 */
async function transformWorkOrderInvoiceNumber(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers, sourceKey } = context
  const parent = await requireWorkOrder(context, 'woid')
  if (parent === null) return

  const externalId = helpers.text('invoiceno')
  if (externalId === null) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: 'work_order_invoice_number',
      sourceKey,
      action: 'row not inserted: no Sage invoice number on the row',
      notes: `woid = ${JSON.stringify(context.row.woid)}`,
    })
    return
  }

  const [invoice] = await tx
    .select({ id: salesInvoices.id })
    .from(salesInvoices)
    .where(eq(salesInvoices.workOrderId, parent.id))
    .limit(1)

  if (!invoice) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: 'work_order_invoice_number',
      sourceKey,
      action:
        'deferred: app.sales_invoices rows are created by the invoicing-rga group; rerun work-orders with --force afterwards',
      notes: `woid = ${JSON.stringify(context.row.woid)}, invoiceno = ${JSON.stringify(externalId)}`,
    })
    return
  }

  const [inserted] = await tx
    .insert(sageLinks)
    .values({
      docType: 'sales_invoice',
      docId: invoice.id,
      externalRef: `legacy-wo-invoiceno:${sourceKey}`,
      externalId,
    })
    .onConflictDoUpdate({
      target: [sageLinks.docType, sageLinks.docId],
      set: { externalId },
    })
    .returning({ id: sageLinks.id })
  await rememberRow(context, 'sage_links', String(inserted!.id))
}

/**
 * Reasons for the tables the manifest routes to this group but the app schema has
 * no home for. One constant per table so the decision is written down once, in
 * the same words, in the exception and in `unmapped`.
 */
const LOCAL_CUSTOMER_PROFILE =
  'local customer profile text (interior, exterior, mustnotes, codes) was folded into site and work-order notes; rows stay in staging for the office'
const LOCAL_HOUR_HISTORY =
  'change audit of local hour edits; the app writes its own audit trail, so the history is not replayed'
const LOCAL_QUOTE =
  'local work-order quotes were re-entered into app.quotes; there is no second quote table'
const LOCAL_SIGNATURE =
  'MySQL stores only the signer name; app.local_work_order_signatures requires a storage_key for the captured image, which the dump does not carry'
const MATERIAL_CHECKLIST =
  'subcontractor material checklist form; the app schema has no checklist table, so the rows stay in staging for operations to decide'
const MATERIAL_CHECKLIST_ENTRY = 'checklist custom entry; its parent checklist has no target table'
const MATERIAL_CHECKLIST_DEFECTIVE =
  'checklist defective part; its parent checklist has no target table'
const MATERIAL_CHECKLIST_NOTE = 'checklist note; its parent checklist has no target table'
const MATERIAL_CHECKLIST_PART = 'checklist part line; its parent checklist has no target table'
const MATERIAL_CHECKLIST_RETURN_ENTRY =
  'checklist returning custom entry; its parent checklist has no target table'
const MATERIAL_CHECKLIST_RETURNING_PART =
  'checklist returning part; its parent checklist has no target table'
const WO_IMAGES_CROPPED =
  'crop marker with no file name and no bytes; the images are re-uploaded as work-order documents from the folder path, so there is no storage key to point at'
const UNDISPATCHED =
  'bulk-import inbox of work orders that were never dispatched; there is no target table, so owner operations must decide whether these are migrated as work orders before cutover'

/** One `not_migrated` row per table: the report names the decision once, not per row. */
async function skipTable(context: TransformContext, reason: string): Promise<void> {
  await context.helpers.exception({
    exceptionClass: 'not_migrated',
    entity: context.table,
    sourceKey: context.table,
    action: `not migrated: ${reason}`,
    notes: 'whole-table decision; every row of this table is skipped and stays in staging',
  })
}

export const transformer: GroupTransformer = {
  group: GROUP,

  async transform(context) {
    switch (context.table) {
      case 'workorder':
        return transformWorkOrder(context)
      case 'wo_hours':
        return transformWorkOrderHour(context)
      case 'localwo_hours':
        return transformLocalWorkOrderHour(context)
      case 'localwo_techs':
        return transformLocalWorkOrderTech(context)
      case 'wo_soparts':
        return transformWorkOrderSpecialPart(context)
      case 'wo_parts':
        return transformWorkOrderPart(context)
      case 'wo_tax':
        return transformWorkOrderTaxRow(context)
      case 'wo_report':
        return transformWorkOrderReport(context)
      case 'wo_notes':
        return transformWorkOrderNote(context)
      case 'wo_revisions':
        return transformWorkOrderRevision(context)
      case 'wo_invoiceno':
        return transformWorkOrderInvoiceNumber(context)
      case 'wo_images_cropped':
        return skipTable(context, WO_IMAGES_CROPPED)
      // The `localwo_*`, material-checklist and undispatched-inbox tables joined
      // the group after this transformer was first written. None of them has a
      // target table, so each is recorded once per table as a deliberate skip
      // rather than throwing an unknown-table error on every row.
      case 'localwo_cusprofile':
        return skipTable(context, LOCAL_CUSTOMER_PROFILE)
      case 'localwo_hours_change_histroy':
        return skipTable(context, LOCAL_HOUR_HISTORY)
      case 'localwo_quotes':
        return skipTable(context, LOCAL_QUOTE)
      case 'localwo_sigs':
        return skipTable(context, LOCAL_SIGNATURE)
      case 'material_checklist':
        return skipTable(context, MATERIAL_CHECKLIST)
      case 'material_checklist_custom_entries':
        return skipTable(context, MATERIAL_CHECKLIST_ENTRY)
      case 'material_checklist_defective_parts':
        return skipTable(context, MATERIAL_CHECKLIST_DEFECTIVE)
      case 'material_checklist_notes':
        return skipTable(context, MATERIAL_CHECKLIST_NOTE)
      case 'material_checklist_parts':
        return skipTable(context, MATERIAL_CHECKLIST_PART)
      case 'material_checklist_returning_custom_enteries':
        return skipTable(context, MATERIAL_CHECKLIST_RETURN_ENTRY)
      case 'material_checklist_returning_parts':
        return skipTable(context, MATERIAL_CHECKLIST_RETURNING_PART)
      case 'undispatched_workorders':
        return skipTable(context, UNDISPATCHED)
      default:
        throw new Error(`${GROUP}: no mapping for table ${context.table}`)
    }
  },

  unmapped: {
    'workorder.dne': 'no documented meaning and no reference in the new model',
    'workorder.tech': 'assignment, not authorship; technician history lives on the hour lines',
    'workorder.tech_2': 'assignment, not authorship',
    'workorder.tech_labour_rate': 'rate lives on the hour lines that were actually worked',
    'workorder.calc_inv_date': 'legacy invoice preview date; the invoice is rebuilt by invoicing',
    'workorder.wo_folder_attach_path':
      'local filesystem path; files are re-uploaded to object storage',
    'workorder.printed': 'print marker, no business meaning in the new model',
    'workorder.batched': 'Sage export batch date; batching is not modelled',
    'workorder.schannel': 'ServiceChannel flags; integration state is not migrated',
    'workorder.schannel_redone': 'ServiceChannel flags; integration state is not migrated',
    'workorder.sgpurch_done': 'legacy Sage purchase flag; posting state is rebuilt from invoices',
    'workorder.forced_enable_sc_transfer': 'operator override for a transfer that no longer exists',
    'workorder.ready_for_calc_timespan': 'legacy queue marker',
    'workorder.closeout_tech': 'closeout assignment, superseded by work_order_assignments',
    'workorder.closeout_tech_2': 'closeout assignment, superseded by work_order_assignments',
    'workorder.customer_quote_id':
      'quote linkage is authoritative from app.quotes.work_order_number',
    'workorder.is_pma_bckup': 'backup copy of is_pma_order',
    'workorder.marked_invoiced_time': 'unix marker; invoiced_at carries the invoice date',
    'workorder.enable_sale_stock_upd_btn': 'UI permission hint',
    'workorder.assigned_dispatch_id': 'dispatch assignment, superseded by work_order_assignments',
    'workorder.pma_order_category': 'free-text PMA category; no lookup id on the target',
    'workorder.primary_workorder': 'free text, not a work-order id',
    'workorder.add_to_local_modify_once': 'one-shot UI flag',
    'workorder.sc_primary_status': 'ServiceChannel status mirror, rebuilt by the integration',
    'workorder.sc_extended_status': 'ServiceChannel status mirror, rebuilt by the integration',
    'wo_notes.emails': 'distribution list for the note; notifications are rebuilt',
    'wo_tax.tax':
      'legacy rate column; appliedtaxrate/appliedtaxrate_pst are what @cls/pricing reads',
    'wo_tax.tax_gst': 'no target column; the GST/HST split is recomputed from the province',
    'wo_tax.tax_pst': 'no target column; the PST split is recomputed from the province',
    'wo_tax.appliedtaxrate_gst':
      'no target column; the GST/HST split is recomputed from the province',
    'wo_images_cropped.*': WO_IMAGES_CROPPED,
    'localwo_cusprofile.*': LOCAL_CUSTOMER_PROFILE,
    'localwo_hours_change_histroy.*': LOCAL_HOUR_HISTORY,
    'localwo_quotes.*': LOCAL_QUOTE,
    'localwo_sigs.*': LOCAL_SIGNATURE,
    'material_checklist.*': MATERIAL_CHECKLIST,
    'material_checklist_custom_entries.*': MATERIAL_CHECKLIST_ENTRY,
    'material_checklist_defective_parts.*': MATERIAL_CHECKLIST_DEFECTIVE,
    'material_checklist_notes.*': MATERIAL_CHECKLIST_NOTE,
    'material_checklist_parts.*': MATERIAL_CHECKLIST_PART,
    'material_checklist_returning_custom_enteries.*': MATERIAL_CHECKLIST_RETURN_ENTRY,
    'material_checklist_returning_parts.*': MATERIAL_CHECKLIST_RETURNING_PART,
    'undispatched_workorders.*': UNDISPATCHED,
  },

  parity: [
    {
      group: GROUP,
      label: 'work orders by status',
      // Placeholder ids are operator scratch rows (placeholder_work_order) and are
      // never inserted. Excluding them measures the roster the policy promises.
      oldSql: `select status as status, count(*)::int as rows
from migration."stg_workorder"
where btrim(id) not in ('0', '9999998', '9999999', '44444444', '99999999')
group by status order by status`,
      newSql: `select w.status::text as status, count(*)::int as rows
from app.work_orders w
join migration.row_map r
  on r.entity = 'work_order' and r.target_table = 'work_orders' and r.target_key = w.id::text
group by w.status order by w.status`,
    },
    {
      group: GROUP,
      label: 'work-order parts money',
      // A line whose work order does not exist is not inserted (orphan_line:
      // work_order_id is NOT NULL and the parent is never invented), and neither
      // is a line–or parent–whose id is a placeholder.
      oldSql: `select coalesce(sum(nullif(regexp_replace(price, '[^0-9.-]', '', 'g'), '')::numeric), 0)::numeric(14, 2) as total
from migration."stg_wo_parts" p
where exists (
  select 1 from migration."stg_workorder" w
  where w.id = p.woid
    and btrim(w.id) not in ('0', '9999998', '9999999', '44444444', '99999999')
)`,
      newSql: `select coalesce(sum(p.price), 0)::numeric(14, 2) as total
from app.work_order_parts p
join migration.row_map r
  on r.entity = 'work_order_part' and r.target_table = 'work_order_parts' and r.target_key = p.id::text`,
    },
    {
      group: GROUP,
      label: 'work-order labour hours',
      oldSql:
        'select coalesce(sum(nullif(hours, \'\')::numeric), 0)::numeric(14, 2) as hours from migration."stg_wo_hours"',
      newSql: `select coalesce(sum(h.hours), 0)::numeric(14, 2) as hours
from app.work_order_hours h
join migration.row_map r
  on r.entity = 'work_order_hour' and r.target_table = 'work_order_hours' and r.target_key = h.id::text`,
    },
  ],
}
