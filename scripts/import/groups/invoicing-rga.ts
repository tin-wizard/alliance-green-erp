/**
 * Group 10 — invoicing and RGA (plan §2.5 step 10).
 *
 * A legacy invoice is not one table. The header is `inv_tax` (the operator-posted
 * subtotal/tax/total, stored exactly as posted — A5), and the lines are
 * `inv_hours`, `inv_parts` and `inv_soparts`, all keyed by `woid`. The forward
 * model is one `app.sales_invoices` row per work order with three line tables, so
 * this group builds the header on demand (whatever inv_* row arrives first), then
 * keeps the header's line-derived amounts current, and finally overrides them
 * with the posted snapshot when `inv_tax` arrives.
 *
 * Money rules from §2.6 and A5:
 *
 *  - Blank text is missing, not zero: it is stored NULL where the column allows
 *    it and reported (`blank_money`, `blank_tax`) where it does not.
 *  - The posted snapshot is never silently replaced by a recomputation. When the
 *    posted total and the line total disagree, both are recorded
 *    (`unbalanced_totals`, owner finance) and the posted total is what the
 *    invoice keeps, because that is what the customer received.
 *  - `'0.00'` and blank are different facts. RGA money columns report the
 *    difference (`zero_amount` versus `blank_money`), never a coerced zero.
 *  - No default tax rate is ever applied. A blank rate leaves
 *    `applied_tax_rate` NULL.
 *
 * `inv_project` is deliberately not migrated: it is the legacy Sage project
 * link, `app.sage_links.external_id` is an API id used to fetch documents from
 * Sage, and writing a project *name* there would corrupt reconciliation. The
 * link is reported once for the table and finance reconciles posted invoices by
 * work-order number in Sage.
 *
 * RGAs keep the raw legacy status code (the app projects labels in the module).
 * A status outside the target's check list cannot be stored as NULL, so the row
 * is reported and not inserted rather than guessed into a neighbouring code.
 */
import { eq, sql } from 'drizzle-orm'
import type { Tx } from '@cls/db'
import {
  invoiceLabourLines,
  invoicePartLines,
  invoiceSpecialPartLines,
  purchaseOrders,
  rgaParts,
  rgaSpecialParts,
  rgas,
  salesInvoices,
  sites,
  subcontractors,
  suppliers,
  users,
  workOrders,
} from '@cls/db/schema'
import { stagingTable } from '../manifest'
import type { GroupTransformer, TransformContext, TransformHelpers } from '../types'

const GROUP = 'invoicing-rga'
const CALC_TYPES = ['sub', 'sub_project', 'local', 'local_project'] as const
const RGA_STATUSES = [2, 3, 4, 6, 7, 10, 11] as const
const RGA_TYPES = ['rga', 'credit', 'replacement'] as const
const REPLACEMENT_TYPES = ['supplier', 'subcontractor', 'customer', 'subcredit'] as const

/** The manifest entity name, used for row_map and exception rows. */
function entityFor(table: string): string {
  switch (table) {
    case 'inv_project':
      return 'invoice_project'
    case 'inv_hours':
      return 'invoice_hour'
    case 'inv_parts':
      return 'invoice_part'
    case 'inv_soparts':
      return 'invoice_special_part'
    case 'inv_tax':
      return 'invoice_tax'
    case 'rga':
      return 'rga'
    case 'rga_parts':
      return 'rga_part'
    default:
      return 'rga_special_part'
  }
}

function intOf(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Legacy wall-clock text to an instant in the company timezone.
 *
 * The old server wrote local Toronto time. `new Date(text)` would read it in
 * whatever zone the migration machine happens to be in and shift every value, so
 * the offset is taken from the zone itself and the wall clock is preserved.
 */
function instantOf(value: string | null): Date | undefined {
  if (value === null) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value.trim())
  if (!match) return undefined
  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match
  const utc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  )
  return new Date(utc - zoneOffsetMs(new Date(utc)))
}

/** How far Toronto is from UTC at that instant, in milliseconds. */
function zoneOffsetMs(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  const local = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour') % 24,
    read('minute'),
    read('second'),
  )
  return local - date.getTime()
}

/** The business date of an instant, in the company timezone (the module's rule). */
function businessDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/**
 * `qty * price` in cents, so a two-decimal line never picks up float drift.
 * The module formats every line to two decimals before it sums, and so does this.
 */
function amountOf(qty: string | null, price: string | null): string | null {
  if (qty === null || price === null) return null
  const qtyCents = Math.round(Number(qty) * 100)
  const priceCents = Math.round(Number(price) * 100)
  if (!Number.isFinite(qtyCents) || !Number.isFinite(priceCents)) return null
  return (Math.round((qtyCents * priceCents) / 100) / 100).toFixed(2)
}

/* ------------------------------ parents ------------------------------ */

/** Only a parent that exists is returned, because the FK would reject a guess. */
async function resolveWorkOrder(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('work_order', 'workorder', String(legacyId))
  const candidate = intOf(mapped) ?? legacyId
  const [row] = await tx
    .select({ id: workOrders.id })
    .from(workOrders)
    .where(eq(workOrders.id, candidate))
    .limit(1)
  return row?.id ?? null
}

async function resolveSite(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('site', 'sites', String(legacyId))
  const candidate = intOf(mapped) ?? legacyId
  const [row] = await tx.select({ id: sites.id }).from(sites).where(eq(sites.id, candidate)).limit(1)
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

async function resolveSupplier(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('supplier', 'suppliers', String(legacyId))
  const candidate = intOf(mapped) ?? legacyId
  const [row] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(eq(suppliers.id, candidate))
    .limit(1)
  return row?.id ?? null
}

async function resolvePurchaseOrder(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('purchase_order', 'purchaseorder', String(legacyId))
  const candidate = intOf(mapped) ?? legacyId
  const [row] = await tx
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, candidate))
    .limit(1)
  return row?.id ?? null
}

/** Line tables use their own serial ids, so only the crosswalk can answer. */
async function resolvePurchaseOrderPart(
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('purchase_order_part', 'po_parts', String(legacyId))
  return intOf(mapped)
}

async function resolvePurchaseOrderSpecialPart(
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('purchase_order_special_part', 'po_soparts', String(legacyId))
  return intOf(mapped)
}

async function resolveUser(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<string | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('user', 'users', String(legacyId))
  if (mapped !== null) {
    const [byId] = await tx.select({ id: users.id }).from(users).where(eq(users.id, mapped)).limit(1)
    if (byId) return byId.id
  }
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.legacyId, legacyId))
    .limit(1)
  return row?.id ?? null
}

/* --------------------------- the invoice header ------------------------ */

/**
 * The crosswalk for "the invoice of a work order" is keyed by the work order,
 * not by the table that happened to create it, because `inv_hours`,
 * `inv_parts`, `inv_soparts` and `inv_tax` all describe the same document.
 */
const INVOICE_ENTITY = 'sales_invoice'
const INVOICE_SOURCE_TABLE = 'workorder'

/** Marks which `inv_tax` row wrote the posted snapshot of a work order's invoice. */
const SNAPSHOT_ENTITY = 'invoice_tax_snapshot'

async function ensureInvoice(
  context: TransformContext,
  workOrderId: number,
): Promise<number | null> {
  const { tx, helpers } = context
  const mapped = await helpers.targetKey(INVOICE_ENTITY, INVOICE_SOURCE_TABLE, String(workOrderId))
  if (mapped !== null) return intOf(mapped)

  const [wo] = await tx
    .select({
      id: workOrders.id,
      siteId: workOrders.siteId,
      isLocal: workOrders.isLocal,
      isProject: workOrders.isProject,
      invoicedAt: workOrders.invoicedAt,
      sageSalesDone: workOrders.sageSalesDone,
    })
    .from(workOrders)
    .where(eq(workOrders.id, workOrderId))
    .limit(1)
  if (!wo) return null

  const [site] = await tx
    .select({ customerId: sites.customerId })
    .from(sites)
    .where(eq(sites.id, wo.siteId))
    .limit(1)

  // The app derives calc_type from the work-order flags (work-orders/lib/rules);
  // the legacy snapshot writes the same four labels, so the derivation matches.
  const calcType = wo.isLocal
    ? wo.isProject
      ? 'local_project'
      : 'local'
    : wo.isProject
      ? 'sub_project'
      : 'sub'

  const invoiceDate = wo.invoicedAt ? businessDate(wo.invoicedAt) : null
  const issued = wo.sageSalesDone

  const [inserted] = await tx
    .insert(salesInvoices)
    .values({
      workOrderId,
      // The module's own numbering rule: one invoice per work order.
      invoiceNumber: `INV-${workOrderId}`,
      workOrderNumber: workOrderId,
      customerId: site?.customerId ?? null,
      siteId: wo.siteId,
      calcType,
      status: issued ? 'issued' : 'draft',
      ...(invoiceDate === null ? {} : { invoiceDate }),
      ...(issued ? { issuedAt: instantOf(invoiceDate ?? null) ?? sql`now()` } : {}),
    })
    .onConflictDoNothing({ target: salesInvoices.workOrderId })
    .returning({ id: salesInvoices.id })

  const invoiceId =
    inserted?.id ??
    (
      await tx
        .select({ id: salesInvoices.id })
        .from(salesInvoices)
        .where(eq(salesInvoices.workOrderId, workOrderId))
        .limit(1)
    )[0]?.id
  if (invoiceId === undefined) return null

  await helpers.remember({
    entity: INVOICE_ENTITY,
    sourceTable: INVOICE_SOURCE_TABLE,
    sourceKey: String(workOrderId),
    targetTable: 'sales_invoices',
    targetKey: String(invoiceId),
  })
  return invoiceId
}

async function hasPostedSnapshot(helpers: TransformHelpers, workOrderId: number): Promise<boolean> {
  return (await helpers.targetKey(SNAPSHOT_ENTITY, 'inv_tax', String(workOrderId))) !== null
}

/**
 * Keep the header's line-derived amounts true after a line lands.
 *
 * It runs only while no posted snapshot exists: once `inv_tax` has written what
 * the operator posted, a later replay of a line must not overwrite that number.
 */
async function refreshLineAmounts(
  context: TransformContext,
  invoiceId: number,
  workOrderId: number,
): Promise<void> {
  if (await hasPostedSnapshot(context.helpers, workOrderId)) return
  await context.tx.execute(sql`
    update app.sales_invoices set
      labour_amount = line.labour,
      material_amount = line.material + line.special,
      subtotal_amount = line.labour + line.material + line.special,
      total_amount = line.labour + line.material + line.special + tax_amount,
      updated_at = now()
    from (
      select
        coalesce((select sum(amount) from app.invoice_labour_lines where invoice_id = ${invoiceId}), 0)::numeric as labour,
        coalesce((select sum(amount) from app.invoice_part_lines where invoice_id = ${invoiceId}), 0)::numeric as material,
        coalesce((select sum(amount) from app.invoice_special_part_lines where invoice_id = ${invoiceId}), 0)::numeric as special
    ) as line
    where id = ${invoiceId}
  `)
}

interface LineTotals {
  labour: string
  material: string
  special: string
  subtotal: string
}

async function lineTotals(tx: Tx, invoiceId: number): Promise<LineTotals> {
  const rows = (await tx.execute(sql`
    select
      coalesce((select sum(amount) from app.invoice_labour_lines where invoice_id = ${invoiceId}), 0)::numeric(14,2)::text as labour,
      coalesce((select sum(amount) from app.invoice_part_lines where invoice_id = ${invoiceId}), 0)::numeric(14,2)::text as material,
      coalesce((select sum(amount) from app.invoice_special_part_lines where invoice_id = ${invoiceId}), 0)::numeric(14,2)::text as special
  `)) as unknown as Array<{ labour: string; material: string; special: string }>
  const row = rows[0] ?? { labour: '0', material: '0', special: '0' }
  const subtotal = (Number(row.labour) + Number(row.material) + Number(row.special)).toFixed(2)
  return { ...row, subtotal }
}

/* ------------------------------- lines ------------------------------- */

async function transformLabourLine(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const workOrderId = await resolveWorkOrder(tx, helpers, helpers.int('woid'))
  if (workOrderId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'line not inserted: woid does not resolve to an app.work_orders row',
      notes: `woid = ${JSON.stringify(context.row.woid)}`,
    })
    return
  }
  const invoiceId = await ensureInvoice(context, workOrderId)
  if (invoiceId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'line not inserted: the invoice for this work order could not be created',
      notes: `woid = ${JSON.stringify(context.row.woid)}`,
    })
    return
  }

  // `entered_rate` is the manual override the operator typed; `rate` is what the
  // calculator used. The stored rate is the one that produced the money.
  const rate = helpers.money('rate') ?? helpers.money('entered_rate')
  const hours = helpers.money('hours')
  const lineDate = helpers.date('date')
  const amount = amountOf(hours, rate)
  if (rate === null || hours === null || lineDate === null || amount === null) {
    await helpers.exception({
      exceptionClass: rate === null || hours === null ? 'blank_money' : 'zero_date',
      entity,
      sourceKey,
      action: 'line not inserted: hours, rate and date are NOT NULL on app.invoice_labour_lines',
      notes: `hours = ${JSON.stringify(context.row.hours)}, rate = ${JSON.stringify(context.row.rate)}, entered_rate = ${JSON.stringify(context.row.entered_rate)}, date = ${JSON.stringify(context.row.date)}`,
    })
    return
  }

  const position = helpers.int('id') ?? 1
  const [inserted] = await tx
    .insert(invoiceLabourLines)
    .values({
      invoiceId,
      // The legacy row id keeps the legacy line order and is stable on a replay.
      position,
      description: `Labour — ${lineDate}`,
      lineDate,
      hours,
      qty: hours,
      price: rate,
      hourlyRate: rate,
      amount,
    })
    .returning({ id: invoiceLabourLines.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'invoice_labour_lines',
    targetKey: String(inserted!.id),
  })
  await refreshLineAmounts(context, invoiceId, workOrderId)
}

async function transformPartLine(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const workOrderId = await resolveWorkOrder(tx, helpers, helpers.int('woid'))
  if (workOrderId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'line not inserted: woid does not resolve to an app.work_orders row',
      notes: `woid = ${JSON.stringify(context.row.woid)}`,
    })
    return
  }
  const invoiceId = await ensureInvoice(context, workOrderId)
  if (invoiceId === null) return

  const partNo = helpers.text('partno')
  const price = helpers.money('price') ?? helpers.money('entered_price')
  const qty = helpers.money('qty')
  const amount = amountOf(qty, price)
  if (partNo === null || qty === null || price === null || amount === null) {
    await helpers.exception({
      exceptionClass: partNo === null ? 'unresolved_part_line' : 'blank_money',
      entity,
      sourceKey,
      action: 'line not inserted: part_no, qty and price are NOT NULL',
      notes: `partno = ${JSON.stringify(context.row.partno)}, qty = ${JSON.stringify(context.row.qty)}, price = ${JSON.stringify(context.row.price)}`,
    })
    return
  }

  const [inserted] = await tx
    .insert(invoicePartLines)
    .values({
      invoiceId,
      position: helpers.int('id') ?? 1,
      partNo,
      qty,
      price,
      amount,
      isLocalPart: helpers.flag('is_local_part') === 1,
      appliedWorkOrderId: helpers.text('applied_woid'),
    })
    .returning({ id: invoicePartLines.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'invoice_part_lines',
    targetKey: String(inserted!.id),
  })
  await refreshLineAmounts(context, invoiceId, workOrderId)
}

async function transformSpecialPartLine(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const workOrderId = await resolveWorkOrder(tx, helpers, helpers.int('woid'))
  if (workOrderId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'line not inserted: woid does not resolve to an app.work_orders row',
      notes: `woid = ${JSON.stringify(context.row.woid)}`,
    })
    return
  }
  const invoiceId = await ensureInvoice(context, workOrderId)
  if (invoiceId === null) return

  const name = helpers.text('name')
  const price = helpers.money('price') ?? helpers.money('entered_price')
  const qty = helpers.money('qty')
  const amount = amountOf(qty, price)
  if (name === null || qty === null || price === null || amount === null) {
    await helpers.exception({
      exceptionClass: name === null ? 'unresolved_part_line' : 'blank_money',
      entity,
      sourceKey,
      action: 'line not inserted: name, qty and price are NOT NULL',
      notes: `name = ${JSON.stringify(context.row.name)}, qty = ${JSON.stringify(context.row.qty)}, price = ${JSON.stringify(context.row.price)}`,
    })
    return
  }

  const [inserted] = await tx
    .insert(invoiceSpecialPartLines)
    .values({
      invoiceId,
      position: helpers.int('id') ?? 1,
      name,
      qty,
      price,
      amount,
      isLocalPart: helpers.flag('is_local_part') === 1,
      isEmergencyLighting: helpers.flag('is_emergency_lighting') === 1,
      warrantyYears: helpers.text('warranty_years'),
      laborWarrantyYears: helpers.text('labor_warranty_years'),
      appliedWorkOrderId: helpers.text('applied_woid'),
    })
    .returning({ id: invoiceSpecialPartLines.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'invoice_special_part_lines',
    targetKey: String(inserted!.id),
  })
  await refreshLineAmounts(context, invoiceId, workOrderId)
}

/* --------------------------- the posted snapshot ----------------------- */

/**
 * The legacy tax rate is a fraction (`0.13`), which is what the target stores.
 * A value outside 0..1 is not a rate, so it becomes NULL and is listed rather
 * than divided by a hundred on a hunch.
 */
async function appliedRate(context: TransformContext): Promise<string | null> {
  const raw = context.helpers.text('appliedtaxrate')
  const value = context.helpers.money('appliedtaxrate')
  if (value === null) return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    await context.helpers.exception({
      exceptionClass: 'unknown_enum',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'applied_tax_rate stored NULL: the value is not a 0..1 rate',
      notes: `appliedtaxrate = ${JSON.stringify(raw)}`,
    })
    return null
  }
  return value
}

async function transformInvoiceSnapshot(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const workOrderId = await resolveWorkOrder(tx, helpers, helpers.int('woid'))
  if (workOrderId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'snapshot not stored: woid does not resolve to an app.work_orders row',
      notes: `woid = ${JSON.stringify(context.row.woid)}`,
    })
    return
  }

  // One invoice per work order. A second inv_tax row would overwrite what the
  // first one posted, so it is reported instead of quietly winning.
  const writer = await helpers.targetKey(SNAPSHOT_ENTITY, 'inv_tax', String(workOrderId))
  if (writer !== null && writer !== sourceKey) {
    await helpers.exception({
      exceptionClass: 'dated_duplicate_skipped',
      entity,
      sourceKey,
      action: `snapshot skipped: inv_tax row ${writer} already posted the totals for woid ${workOrderId}`,
      notes: `woid = ${workOrderId}`,
    })
    return
  }

  const invoiceId = await ensureInvoice(context, workOrderId)
  if (invoiceId === null) return

  const legacySubtotal = helpers.money('subtotal_amount')
  const legacyTax = helpers.money('tax_amount')
  const legacyTotal = helpers.money('total_amount')
  const totals = await lineTotals(tx, invoiceId)

  // Blank and zero tax are different facts, and neither is a rate. Counted
  // separately so finance can decide about the ~24k blank rows (§5).
  if (legacyTax === null) {
    await helpers.exception({
      exceptionClass: 'blank_tax',
      entity,
      sourceKey,
      action: 'tax stored 0 (NOT NULL column) and applied_tax_rate stored NULL; no default rate applied',
      notes: `tax_amount = ${JSON.stringify(context.row.tax_amount)}, appliedtaxrate = ${JSON.stringify(context.row.appliedtaxrate)}`,
    })
  } else if (Number(legacyTax) === 0) {
    await helpers.exception({
      exceptionClass: 'blank_tax',
      entity,
      sourceKey,
      action: 'tax stored 0.00 as posted (a real zero, not a blank); applied_tax_rate kept as recorded',
      notes: `tax_amount = ${JSON.stringify(context.row.tax_amount)}`,
    })
  }

  if (legacySubtotal === null) {
    await helpers.exception({
      exceptionClass: 'blank_money',
      entity,
      sourceKey,
      action: 'subtotal stored from the invoice lines: the posted subtotal is blank and the column is NOT NULL',
      notes: `subtotal_amount = ${JSON.stringify(context.row.subtotal_amount)}, line subtotal = ${totals.subtotal}`,
    })
  }

  const postedSubtotal = legacySubtotal ?? totals.subtotal
  const postedTax = legacyTax ?? '0.00'
  const postedTotal = legacyTotal ?? (Number(postedSubtotal) + Number(postedTax)).toFixed(2)

  // Both numbers are recorded; neither is silently chosen. The posted snapshot
  // stays on the invoice because it is the document the customer received (A5).
  if (legacySubtotal !== null && Number(legacySubtotal) !== Number(totals.subtotal)) {
    await helpers.exception({
      exceptionClass: 'unbalanced_totals',
      entity,
      sourceKey,
      action: 'posted subtotal kept; difference recorded against the recomputed line total',
      notes: `posted subtotal = ${legacySubtotal}, lines = ${totals.subtotal}, posted tax = ${postedTax}, posted total = ${postedTotal}`,
    })
  }

  const declared = helpers.enumOf('calc_type', CALC_TYPES)
  const [flags] = await tx
    .select({ isLocal: workOrders.isLocal, isProject: workOrders.isProject })
    .from(workOrders)
    .where(eq(workOrders.id, workOrderId))
    .limit(1)
  // A blank legacy calc_type is "not set", not an unknown label: the work-order
  // flags are the authoritative source and the app's own rule maps them.
  const resolvedCalcType =
    declared ??
    (flags === undefined
      ? null
      : flags.isLocal
        ? flags.isProject
          ? 'local_project'
          : 'local'
        : flags.isProject
          ? 'sub_project'
          : 'sub')

  // The override columns mirror the posted snapshot only when it disagrees with
  // the lines: that is exactly what "operator-posted, not recomputed" means.
  const overridden = legacySubtotal !== null && Number(legacySubtotal) !== Number(totals.subtotal)

  await tx
    .update(salesInvoices)
    .set({
      subtotalAmount: postedSubtotal,
      taxAmount: postedTax,
      totalAmount: postedTotal,
      ...(resolvedCalcType === null ? {} : { calcType: resolvedCalcType }),
      appliedTaxRate: await appliedRate(context),
      ...(overridden
        ? { manualSubtotalAmount: legacySubtotal, manualTaxAmount: legacyTax }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(salesInvoices.id, invoiceId))

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'sales_invoices',
    targetKey: String(invoiceId),
  })
  await helpers.remember({
    entity: SNAPSHOT_ENTITY,
    sourceTable: 'inv_tax',
    sourceKey: String(workOrderId),
    targetTable: 'sales_invoices',
    targetKey: `${invoiceId}#${sourceKey}`,
  })
}

/* --------------------------------- RGA -------------------------------- */

type RgaValues = typeof rgas.$inferInsert
type ReplacementType = (typeof REPLACEMENT_TYPES)[number]

/**
 * `rga_type` in the legacy table mixes the document kind with the party that
 * replaces the part. The forward model splits them, so the mapping is explicit
 * and anything else is reported instead of being filed under a neighbour.
 */
function classifyRgaType(raw: string | null): {
  known: boolean
  rgaType: (typeof RGA_TYPES)[number]
  replacementType: ReplacementType | null
} {
  const value = raw === null ? '' : raw.trim().toLowerCase()
  if (value === '') return { known: true, rgaType: 'rga', replacementType: null }
  const asType = RGA_TYPES.find((entry) => entry === value)
  if (asType) return { known: true, rgaType: asType, replacementType: null }
  const asParty = REPLACEMENT_TYPES.find((entry) => entry === value)
  if (asParty) return { known: true, rgaType: 'rga', replacementType: asParty }
  return { known: false, rgaType: 'rga', replacementType: null }
}

async function transformRga(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const legacyStatus = helpers.int('status')
  const status = legacyStatus !== null && (RGA_STATUSES as readonly number[]).includes(legacyStatus)
    ? legacyStatus
    : null
  if (status === null) {
    // `app.rgas.status` is NOT NULL with a check list. There is no honest NULL
    // here, and a neighbouring code would be a guess, so the row is reported and
    // left for the module owner to place.
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity,
      sourceKey,
      action: 'RGA not inserted: status is NOT NULL and outside 2/3/4/6/7/10/11',
      notes: `status = ${JSON.stringify(row.status)}`,
    })
    return
  }

  const classified = classifyRgaType(helpers.text('rga_type'))
  if (!classified.known) {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity,
      sourceKey,
      action: "stored rga_type 'rga' because the column is NOT NULL; replacement_type left NULL",
      notes: `rga_type = ${JSON.stringify(row.rga_type)}`,
    })
  }

  const declaredReplacement = helpers.enumOf('replacement_type', REPLACEMENT_TYPES)
  const requestDate = helpers.date('request_date')
  if (requestDate === null) {
    await helpers.exception({
      exceptionClass: 'zero_date',
      entity,
      sourceKey,
      action: 'request_date stored as the import date: the column is NOT NULL and the source has no usable date',
      notes: `request_date = ${JSON.stringify(row.request_date)}`,
    })
  }

  const completedAt = helpers.timestamp('date_completed')
  const createdAt = helpers.timestamp('date_created')

  const values: RgaValues = {
    supplierId: await resolveSupplier(tx, helpers, helpers.int('supplier_id')),
    poId: await resolvePurchaseOrder(tx, helpers, helpers.int('poid')),
    workOrderId: await resolveWorkOrder(tx, helpers, helpers.int('workordernumber')),
    siteId: await resolveSite(tx, helpers, helpers.int('site')),
    subcontractorId: await resolveSubcontractor(tx, helpers, helpers.int('subcontractor')),
    rgaType: classified.rgaType,
    replacementType: declaredReplacement ?? classified.replacementType,
    status,
    legacyStatus: helpers.int('status_on_july_21_2025'),
    ...(requestDate === null ? {} : { requestDate }),
    rgaNotes: helpers.text('rga_notes'),
    internalNotes: helpers.text('notes'),
    rgaInvoiceNumber: helpers.text('rga_invoicenumber'),
    rgaInvoiceDate: helpers.date('rga_invoicedate'),
    shippingAddress: helpers.text('shipping_address'),
    isCritical: helpers.flag('is_marked_critical') === 1,
    isSubmitted: helpers.flag('is_submitted') === 1,
    stockUpdated: helpers.flag('stock_updated') === 1,
    revisionNo: helpers.int('revision_no') ?? 0,
    createdBy: await resolveUser(tx, helpers, helpers.int('createdby')),
    ...(completedAt === null ? {} : { completedAt: instantOf(completedAt) }),
    ...(createdAt === null ? {} : { createdAt: instantOf(createdAt) }),
  }

  const [inserted] = await tx.insert(rgas).values(values).returning({ id: rgas.id })
  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'rgas',
    targetKey: String(inserted!.id),
  })
}

async function resolveRga(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('rga', 'rga', String(legacyId))
  const candidate = intOf(mapped)
  if (candidate === null) return null
  const [row] = await tx.select({ id: rgas.id }).from(rgas).where(eq(rgas.id, candidate)).limit(1)
  return row?.id ?? null
}

/**
 * `'0.00'` and blank are different facts about an RGA price. Both are recorded so
 * a real zero is never confused with a missing value (§2.6).
 */
async function noteZeroAmount(
  context: TransformContext,
  entity: string,
  column: string,
  value: string | null,
): Promise<void> {
  const raw = context.helpers.text(column)
  if (raw === null || value === null || Number(value) !== 0) return
  await context.helpers.exception({
    exceptionClass: 'zero_amount',
    entity,
    sourceKey: context.sourceKey,
    action: 'stored 0.00: the source value is a real zero',
    notes: `${column} = ${JSON.stringify(raw)}`,
  })
}

async function transformRgaPart(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const rgaId = await resolveRga(tx, helpers, helpers.int('rgaid'))
  if (rgaId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'line not inserted: rgaid does not resolve to an app.rgas row',
      notes: `rgaid = ${JSON.stringify(row.rgaid)}`,
    })
    return
  }

  const partNo = helpers.text('partno')
  const qty = helpers.money('qty')
  const price = helpers.money('price')
  if (partNo === null || qty === null) {
    await helpers.exception({
      exceptionClass: partNo === null ? 'unresolved_part_line' : 'blank_money',
      entity,
      sourceKey,
      action: 'line not inserted: part_no and qty are NOT NULL',
      notes: `partno = ${JSON.stringify(row.partno)}, qty = ${JSON.stringify(row.qty)}`,
    })
    return
  }

  // return_qty is NOT NULL with no source for "not set": an unset return quantity
  // becomes 0 and is reported, never silently assumed to equal the ordered qty.
  const returnQty = helpers.money('return_qty')
  if (returnQty === null) {
    await helpers.exception({
      exceptionClass: 'blank_money',
      entity,
      sourceKey,
      action: 'return_qty stored 0: the column is NOT NULL and the source value is blank',
      notes: `return_qty = ${JSON.stringify(row.return_qty)}`,
    })
  }
  if (price === null) {
    await helpers.exception({
      exceptionClass: 'blank_money',
      entity,
      sourceKey,
      action: 'price stored 0: the column is NOT NULL and the source value is blank',
      notes: `price = ${JSON.stringify(row.price)}`,
    })
  }
  await noteZeroAmount(context, entity, 'price', price)

  const poPartId = helpers.int('po_part_id')
  const resolvedPoPartId = await resolvePurchaseOrderPart(helpers, poPartId)
  if (poPartId !== null && resolvedPoPartId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'po_part_id left NULL: no crosswalk for that po_parts row',
      notes: `po_part_id = ${poPartId}`,
    })
  }

  const [inserted] = await tx
    .insert(rgaParts)
    .values({
      rgaId,
      position: helpers.int('id') ?? 1,
      partNo,
      qty,
      returnQty: returnQty ?? '0',
      price: price ?? '0',
      reasonForReturn: helpers.text('reason_for_return'),
      underWarranty: helpers.flag('under_warranty') === 1,
      purchaseType: helpers.text('item_purchase_type'),
      purchaseTypeNumber: helpers.text('item_purchase_type_number'),
      poNumber: helpers.text('po_number'),
      poPartId: resolvedPoPartId,
      modelNumber: helpers.text('model_number'),
      originalInvoiceNumber: helpers.text('rp_invoicenumber'),
      originalInvoiceDate: helpers.date('rp_invoicedate'),
    })
    .returning({ id: rgaParts.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'rga_parts',
    targetKey: String(inserted!.id),
  })
}

async function transformRgaSpecialPart(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const rgaId = await resolveRga(tx, helpers, helpers.int('rgaid'))
  if (rgaId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'line not inserted: rgaid does not resolve to an app.rgas row',
      notes: `rgaid = ${JSON.stringify(row.rgaid)}`,
    })
    return
  }

  const name = helpers.text('name')
  const qty = helpers.money('qty')
  const price = helpers.money('price')
  if (name === null || qty === null) {
    await helpers.exception({
      exceptionClass: name === null ? 'unresolved_part_line' : 'blank_money',
      entity,
      sourceKey,
      action: 'line not inserted: name and qty are NOT NULL',
      notes: `name = ${JSON.stringify(row.name)}, qty = ${JSON.stringify(row.qty)}`,
    })
    return
  }

  const returnQty = helpers.money('return_qty')
  if (returnQty === null) {
    await helpers.exception({
      exceptionClass: 'blank_money',
      entity,
      sourceKey,
      action: 'return_qty stored 0: the column is NOT NULL and the source value is blank',
      notes: `return_qty = ${JSON.stringify(row.return_qty)}`,
    })
  }
  if (price === null) {
    await helpers.exception({
      exceptionClass: 'blank_money',
      entity,
      sourceKey,
      action: 'price stored 0: the column is NOT NULL and the source value is blank',
      notes: `price = ${JSON.stringify(row.price)}`,
    })
  }
  await noteZeroAmount(context, entity, 'price', price)

  const poSpecialPartId = helpers.int('po_sopart_id')
  const resolvedPoSpecialPartId = await resolvePurchaseOrderSpecialPart(helpers, poSpecialPartId)
  if (poSpecialPartId !== null && resolvedPoSpecialPartId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'po_special_part_id left NULL: no crosswalk for that po_soparts row',
      notes: `po_sopart_id = ${poSpecialPartId}`,
    })
  }

  const [inserted] = await tx
    .insert(rgaSpecialParts)
    .values({
      rgaId,
      position: helpers.int('id') ?? 1,
      name,
      qty,
      returnQty: returnQty ?? '0',
      price: price ?? '0',
      reasonForReturn: helpers.text('reason_for_return'),
      purchaseType: helpers.text('item_purchase_type'),
      purchaseTypeNumber: helpers.text('item_purchase_type_number'),
      poNumber: helpers.text('po_number'),
      poSpecialPartId: resolvedPoSpecialPartId,
      modelNumber: helpers.text('model_number'),
      originalInvoiceNumber: helpers.text('rp_invoicenumber'),
      originalInvoiceDate: helpers.date('rp_invoicedate'),
    })
    .returning({ id: rgaSpecialParts.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'rga_special_parts',
    targetKey: String(inserted!.id),
  })
}

/* ---------------------------- not migrated ---------------------------- */

/**
 * Rows staged for this table and dump.
 *
 * The staging relation is generated from the manifest, so a table added to the
 * manifest before the DDL is regenerated would make the count fail; a policy skip
 * still has to be recorded. The floor of 1 is the row being processed.
 */
async function stagedRowCount(context: TransformContext): Promise<number> {
  try {
    const rows = (await context.tx.execute(
      sql`select count(*)::int as rows from ${sql.raw(`migration."${stagingTable(context.table)}"`)} where "_dump_id" = ${context.dumpId}`,
    )) as unknown as Array<{ rows: number }>
    const count = Number(rows[0]?.rows ?? 0)
    return count > 0 ? count : 1
  } catch {
    return 1
  }
}

async function recordNotMigrated(context: TransformContext, reason: string): Promise<void> {
  const count = await stagedRowCount(context)
  await context.helpers.exception({
    exceptionClass: 'not_migrated',
    entity: entityFor(context.table),
    sourceKey: `${context.table}:all`,
    rowCount: count > 0 ? count : 1,
    action: 'not migrated: no target column in the app schema',
    notes: reason,
  })
}

/* ------------------------------ transformer --------------------------- */

export const transformer: GroupTransformer = {
  group: GROUP,

  async transform(context) {
    switch (context.table) {
      case 'inv_hours':
        return transformLabourLine(context)
      case 'inv_parts':
        return transformPartLine(context)
      case 'inv_soparts':
        return transformSpecialPartLine(context)
      case 'inv_tax':
        return transformInvoiceSnapshot(context)
      case 'rga':
        return transformRga(context)
      case 'rga_parts':
        return transformRgaPart(context)
      case 'rga_soparts':
        return transformRgaSpecialPart(context)
      case 'inv_project':
        // `sage_project_workorder` is the project *name* Sage was given. The only
        // Sage link table stores an API id that reconciliation uses to fetch the
        // document, so writing a name there would make reconciliation fail.
        return recordNotMigrated(
          context,
          'legacy Sage project link (sage_project_workorder); app.sage_links.external_id is an API id, not a project name, so the link stays in staging and finance reconciles posted invoices by work-order number',
        )
      case 'sc_inv_hours':
      case 'sc_inv_parts':
      case 'sc_inv_soparts':
      case 'sc_inv_tax':
        // ServiceChannel is handed a copy of the invoice lines so it can render its
        // own document. The rebuild has no ServiceChannel line tables, and the same
        // work order already arrives through inv_hours/inv_parts/inv_soparts/inv_tax.
        return recordNotMigrated(
          context,
          'ServiceChannel invoice-draft copy; the rebuild has no ServiceChannel line tables and the same numbers are already migrated from inv_hours, inv_parts, inv_soparts and inv_tax',
        )
      default:
        throw new Error(`${GROUP}: no mapping for table ${context.table}`)
    }
  },

  unmapped: {
    'inv_project.*':
      'legacy Sage project link: app.sage_links.external_id is an API id used to fetch the document, not a project name, so writing it there would break reconciliation',
    'inv_hours.id':
      'the legacy row id becomes the line position; it is also the crosswalk key',
    'inv_hours.entered_rate':
      'the manual override the operator typed; used only when `rate` is blank, because `rate` is what produced the money',
    'inv_parts.id':
      'the legacy row id becomes the line position; it is also the crosswalk key',
    'inv_parts.entered_price':
      'the manual override; used only when `price` is blank',
    'inv_parts.linked_sopart_cost_price':
      'special-part linkage price; app.invoice_part_lines has no link or cost column (schema gap)',
    'inv_parts.linked_part_sopart':
      'special-part linkage; app.invoice_part_lines has no link column (schema gap)',
    'inv_soparts.entered_price':
      'the manual override; used only when `price` is blank',
    'inv_soparts.is_service_report':
      'no target column on app.invoice_special_part_lines; the report itself lives on the work order',
    'inv_tax.id':
      'the legacy row id lives in migration.row_map; one invoice per work order makes it non-identifying',
    'inv_tax.name':
      'the tax label; app.sales_invoices stores the province and rate, and the label is derived from the province table',
    'rga.id':
      'the legacy row id lives in migration.row_map, not on app.rgas',
    'rga.ship_address_contactname':
      'app.rgas has one free-text shipping_address; the structured legacy address columns have no per-field target',
    'rga.ship_address_company': 'no per-field target; see rga.ship_address_contactname',
    'rga.ship_address_street1': 'no per-field target; see rga.ship_address_contactname',
    'rga.ship_address_street2': 'no per-field target; see rga.ship_address_contactname',
    'rga.ship_address_city': 'no per-field target; see rga.ship_address_contactname',
    'rga.ship_address_province': 'no per-field target; see rga.ship_address_contactname',
    'rga.ship_address_postalcode': 'no per-field target; see rga.ship_address_contactname',
    'rga.ship_address_phone': 'no per-field target; see rga.ship_address_contactname',
    'rga.completiondate':
      'legacy int of unknown unit; date_completed is the timestamp that is carried',
    'rga.rga_folder_attach_path':
      'path on the old file server; documents are re-uploaded, not linked',
    'rga.is_online_vendor_order': 'no target column; the supplier-order flow does not use it',
    'rga.is_type_maintenance': 'no target column on app.rgas (maintenance is a work-order flag)',
    'rga_parts.id': 'the legacy row id becomes the line position; it is also the crosswalk key',
    'rga_soparts.id': 'the legacy row id becomes the line position; it is also the crosswalk key',
    'sc_inv_hours.*': 'ServiceChannel draft copy; see the table-level not_migrated exception',
    'sc_inv_parts.*': 'ServiceChannel draft copy; see the table-level not_migrated exception',
    'sc_inv_soparts.*': 'ServiceChannel draft copy; see the table-level not_migrated exception',
    'sc_inv_tax.*': 'ServiceChannel draft copy; see the table-level not_migrated exception',
  },

  parity: [
    {
      group: GROUP,
      label: 'posted invoice totals (parseable rows only)',
      // Scope: an `inv_tax` row whose work order is inserted and whose posted
      // total is plain numeric. A blank/non-numeric total is a recorded
      // exception (blank_money / unparseable_money), and a snapshot for a
      // placeholder or missing work order is never written (orphan_line).
      oldSql: `select coalesce(sum(nullif(regexp_replace(t.total_amount, '[^0-9.-]', '', 'g'), '')::numeric), 0) as total
from migration."stg_inv_tax" t
where t.total_amount ~ '^-?[0-9]+(\\.[0-9]{1,4})?$'
  and exists (
    select 1 from migration."stg_workorder" w
    where w.id = t.woid
      and btrim(w.id) not in ('0', '9999998', '9999999', '44444444', '99999999')
  )`,
      // The posted value is read back from the invoice the snapshot wrote; the
      // crosswalk only declares which invoices carry a parseable snapshot.
      newSql: `select coalesce(sum(i.total_amount), 0)::numeric as total
from app.sales_invoices i
join migration.row_map r
  on r.entity = 'invoice_tax_snapshot'
 and r.source_table = 'inv_tax'
 and r.target_table = 'sales_invoices'
 and r.source_key = i.work_order_id::text
where exists (
  select 1 from migration."stg_inv_tax" t
  where t."_dump_id" = r.dump_id
    and t.woid = r.source_key
    and t.total_amount ~ '^-?[0-9]+(\\.[0-9]{1,4})?$'
)`,
    },
    {
      group: GROUP,
      label: 'invoices: one per work order with a posted snapshot',
      // A snapshot is written only for an inserted work order; a placeholder or
      // an orphan woid is reported, not turned into an invoice.
      oldSql: `select count(distinct t.woid)::int as rows
from migration."stg_inv_tax" t
where exists (
  select 1 from migration."stg_workorder" w
  where w.id = t.woid
    and btrim(w.id) not in ('0', '9999998', '9999999', '44444444', '99999999')
)`,
      newSql: `select count(*)::int as rows
from app.sales_invoices i
join migration.row_map r
  on r.entity = 'invoice_tax_snapshot'
 and r.source_table = 'inv_tax'
 and r.target_table = 'sales_invoices'
 and r.source_key = i.work_order_id::text`,
    },
    {
      group: GROUP,
      label: 'invoice part lines: total amount',
      // Lines whose `woid` does not resolve to an inserted work order are
      // recorded as orphan_line and not written; `applied_woid` is only a
      // reference column, so it does not decide insertion.
      oldSql: `select coalesce(sum(nullif(regexp_replace(qty, '[^0-9.-]', '', 'g'), '')::numeric * nullif(regexp_replace(price, '[^0-9.-]', '', 'g'), '')::numeric), 0) as total
from migration."stg_inv_parts" p
where exists (
  select 1 from migration."stg_workorder" w
  where w.id = p.woid
    and btrim(w.id) not in ('0', '9999998', '9999999', '44444444', '99999999')
)`,
      newSql: `select coalesce(sum(l.amount), 0)::numeric as total
from app.invoice_part_lines l
join migration.row_map r
  on r.entity = 'invoice_part' and r.target_table = 'invoice_part_lines' and r.target_key = l.id::text`,
    },
    {
      group: GROUP,
      label: 'RGAs: count grouped by a status bucket (completed = 4)',
      oldSql: 'select count(*)::int as rows from migration."stg_rga" where status::int = 4',
      newSql: 'select count(*)::int as rows from app.rgas where status = 4',
    },
    {
      group: GROUP,
      label: 'RGAs: count grouped by a status bucket (cancelled = 10)',
      oldSql: 'select count(*)::int as rows from migration."stg_rga" where status::int = 10',
      newSql: 'select count(*)::int as rows from app.rgas where status = 10',
    },
    {
      group: GROUP,
      label: 'RGA part lines: row count',
      // Codes 1, 5, 8 and 9 are not in the legacy `rga_status` lookup (they are
      // never emitted); the app state machine also has no row for them, so such
      // an RGA and its lines are recorded as unknown_enum, not inserted.
      oldSql: `select count(*)::int as rows
from migration."stg_rga_parts" p
where exists (
  select 1 from migration."stg_rga" g
  where g.id = p.rgaid
    and (case when g.status ~ '^[0-9]+$' then g.status::int end) in (2, 3, 4, 6, 7, 10, 11)
)`,
      newSql: `select count(*)::int as rows
from app.rga_parts p
join migration.row_map r
  on r.entity = 'rga_part' and r.target_table = 'rga_parts' and r.target_key = p.id::text`,
    },
  ],
}
