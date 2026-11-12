/**
 * Group 9 — inventory (plan §2.5 step 9).
 *
 * The legacy "inventory" tables are four different things wearing one name:
 *
 *  - `parts_salepurchase_log` is the stock movement ledger. DATA-DICTIONARY
 *    names it exactly that, and its `transaction_type` vocabulary
 *    (Sale / Purchase / Adjustment) is the vocabulary `app.inventory_movements`
 *    documents. It is the only log that lands in the ledger.
 *  - `parts_purchasing_log`, `parts_selling_log` and `parts_purchased_inventory`
 *    are earlier, narrower write paths for the same events (purchase / sale /
 *    purchase-invoice line). Importing all four would make every movement appear
 *    twice or three times in one ledger, so they are deliberately not migrated
 *    and reported once per table (`not_migrated`, owner operations). The staged
 *    rows stay queryable for anyone who wants to re-derive them.
 *  - `parts_inventory` is a per-shipment batch with its own cost/sell/markup and
 *    sold counter. The forward model has no batch table — `app.parts` carries
 *    the authoritative counters (E4) — so the batch rows are reported, not
 *    invented into receipts that never existed.
 *  - `parts_inventory_adjustment` and `parts_price_lock` have exact targets.
 *
 * E4: `parts.current_quantity` stays authoritative. Nothing here derives a
 * counter from the ledger, and a ledger that disagrees with a counter is a
 * finding for the report, not something migration "corrects".
 */
import { eq, sql } from 'drizzle-orm'
import type { Tx } from '@cls/db'
import {
  inventoryMovements,
  partPriceLocks,
  partStockAdjustments,
  parts,
  sites,
  subcontractors,
  workOrders,
} from '@cls/db/schema'
import { stagingTable } from '../manifest'
import type { GroupTransformer, TransformContext, TransformHelpers } from '../types'

const GROUP = 'inventory'
const ADJUSTMENT_TYPES = ['global', 'alliance', 'subcontractor', 'customer', 'contractor'] as const
const TRANSACTION_TYPES = ['Sale', 'Purchase', 'Adjustment'] as const

/** Legacy ledger vocabulary to the granular movement type the app stores. */
const MOVEMENT_TYPE: Record<string, 'sale' | 'purchase_receipt' | 'adjustment'> = {
  Sale: 'sale',
  Purchase: 'purchase_receipt',
  Adjustment: 'adjustment',
}

/** The manifest entity name, used for row_map and exception rows. */
function entityFor(table: string): string {
  switch (table) {
    case 'parts_inventory':
      return 'part_inventory'
    case 'parts_inventory_adjustment':
      return 'part_inventory_adjustment'
    case 'parts_purchased_inventory':
      return 'part_purchased_inventory'
    case 'parts_purchasing_log':
      return 'part_purchasing_log'
    case 'parts_salepurchase_log':
      return 'part_salepurchase_log'
    case 'parts_selling_log':
      return 'part_selling_log'
    default:
      return 'part_price_lock'
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

/* ------------------------------ parents ------------------------------ */

/** `app.parts.id` is the legacy id; the number is the business key. */
async function resolvePart(tx: Tx, partNo: string | null): Promise<number | null> {
  if (partNo === null) return null
  const [row] = await tx
    .select({ id: parts.id })
    .from(parts)
    .where(sql`lower(${parts.partNumber}) = lower(${partNo})`)
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

/* --------------------------- table skips ---------------------------- */

const stagedCounts = new Map<string, number>()

/**
 * Rows staged for this table and dump.
 *
 * A `not_migrated` decision is one row per table carrying the count, not one row
 * per source row, so the report stays readable for a 60k-row log.
 */
async function stagedCount(context: TransformContext): Promise<number> {
  const key = `${context.dumpId}:${context.table}`
  const cached = stagedCounts.get(key)
  if (cached !== undefined) return cached
  let value = 1
  try {
    const rows = (await context.tx.execute(
      sql`select count(*)::int as rows from ${sql.raw(`migration."${stagingTable(context.table)}"`)} where "_dump_id" = ${context.dumpId}`,
    )) as unknown as Array<{ rows: number }>
    // The transform is only called for a staged row, so the real count is never
    // zero; the floor also guards a direct unit-test call that stages nothing.
    value = Math.max(Number(rows[0]?.rows ?? 0), 1)
  } catch {
    // The staging relation is generated from the manifest; a table added before
    // the DDL is regenerated still has to report a decision.
    value = 1
  }
  stagedCounts.set(key, value)
  return value
}

async function recordNotMigrated(context: TransformContext, reason: string): Promise<void> {
  // Idempotent by contract: the exception's unique key is
  // (class, entity, source key), so every row of the table upserts the same row.
  await context.helpers.exception({
    exceptionClass: 'not_migrated',
    entity: entityFor(context.table),
    sourceKey: `${context.table}:all`,
    rowCount: await stagedCount(context),
    action: 'not migrated: no target table in the app schema',
    notes: reason,
  })
}

/* ----------------------------- adjustments --------------------------- */

async function transformAdjustment(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const entity = entityFor(context.table)
  const existing = await helpers.targetKey(entity, context.table, sourceKey)
  if (existing !== null) return

  const partNo = helpers.text('partno')
  const qty = helpers.money('qty')
  if (partNo === null || qty === null) {
    // part_no and qty are NOT NULL: an adjustment we cannot identify or count
    // cannot be stored without inventing either.
    await helpers.exception({
      exceptionClass: partNo === null ? 'unresolved_part_line' : 'blank_money',
      entity,
      sourceKey,
      action: 'row not inserted: part_no and qty are NOT NULL',
      notes: `partno = ${JSON.stringify(context.row.partno)}, qty = ${JSON.stringify(context.row.qty)}`,
    })
    return
  }

  const declared = helpers.enumOf('adjustment_type', ADJUSTMENT_TYPES)
  if (declared === null) {
    const raw = helpers.text('adjustment_type')
    if (raw !== null) {
      // A label we do not recognise is reported, not guessed at. The column is
      // NOT NULL with a check, so the legacy blank/unattributed case ('') is the
      // only substitution made, and it is the target's own default meaning.
      await helpers.exception({
        exceptionClass: 'unknown_enum',
        entity,
        sourceKey,
        action: "stored 'global' because adjustment_type is NOT NULL and has a check",
        notes: `adjustment_type = ${JSON.stringify(raw)}`,
      })
    }
  }

  const createdAt = helpers.timestamp('date_created') ?? helpers.timestamp('inserted_datetime')
  const [inserted] = await tx
    .insert(partStockAdjustments)
    .values({
      partNo,
      partId: await resolvePart(tx, partNo),
      qty,
      price: helpers.money('price'),
      adjustmentType: declared ?? 'global',
      notes: helpers.text('notes'),
      isLogDeleted: helpers.flag('is_log_deleted') === 1,
      workOrderNumber: await resolveWorkOrder(tx, helpers, intOf(helpers.text('workordernumber'))),
      siteId: await resolveSite(tx, helpers, helpers.int('site')),
      subcontractorId: await resolveSubcontractor(tx, helpers, helpers.int('subcontractor')),
      massAdjustmentNumber: helpers.int('mass_adjustment_number'),
      idempotencyKey: `legacy:parts_inventory_adjustment:${sourceKey}`,
      ...(createdAt === null ? {} : { createdAt: instantOf(createdAt) }),
    })
    .returning({ id: partStockAdjustments.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'part_stock_adjustments',
    targetKey: String(inserted!.id),
  })
}

/* ------------------------------- ledger ------------------------------ */

async function transformMovement(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  const existing = await helpers.targetKey(entity, context.table, sourceKey)
  if (existing !== null) return

  const partNo = helpers.text('partno')
  const qty = helpers.money('qty')
  if (partNo === null || qty === null) {
    await helpers.exception({
      exceptionClass: partNo === null ? 'unresolved_part_line' : 'blank_money',
      entity,
      sourceKey,
      action: 'row not inserted: part_no and qty are NOT NULL',
      notes: `partno = ${JSON.stringify(row.partno)}, qty = ${JSON.stringify(row.qty)}`,
    })
    return
  }

  const transactionType = helpers.enumOf('transaction_type', TRANSACTION_TYPES)
  if (transactionType === null) {
    // movement_type is NOT NULL with a check and is derived from this column;
    // without it there is nothing honest to write.
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity,
      sourceKey,
      action: 'row not inserted: transaction_type does not name a ledger type',
      notes: `transaction_type = ${JSON.stringify(row.transaction_type)}`,
    })
    return
  }

  const woidPoid = helpers.int('woid_poid')
  const invoiceId = helpers.int('invoice_id')
  const invoiceNumber = helpers.text('invoice_number')
  const hasInvoice = invoiceId !== null || invoiceNumber !== null

  // DATA-DICTIONARY #12: one id in `woid_poid`, `invoice_number` and
  // `invoice_id` is ambiguous. The explicit document columns win when they are
  // present; the ambiguous id only becomes the reference when they are absent.
  const documentType = hasInvoice
    ? transactionType === 'Sale'
      ? 'sales_invoice'
      : transactionType === 'Purchase'
        ? 'purchase_order_invoice'
        : null
    : null
  const referenceType =
    documentType ??
    (transactionType === 'Sale'
      ? 'work_order'
      : transactionType === 'Purchase'
        ? 'purchase_order'
        : 'adjustment')
  const documentId = hasInvoice
    ? String(invoiceId ?? invoiceNumber)
    : woidPoid === null
      ? null
      : String(woidPoid)

  const price = helpers.money('price')
  const adjustmentType = helpers.enumOf('adjustment_type', [
    'alliance',
    'subcontractor',
    'customer',
    'contractor',
  ] as const)
  const included = helpers.flag('is_includeed_in_stock_management')
  const createdAt = helpers.timestamp('date_created')

  const [inserted] = await tx
    .insert(inventoryMovements)
    .values({
      partNo,
      partId: await resolvePart(tx, partNo),
      qty,
      price,
      movementType: MOVEMENT_TYPE[transactionType]!,
      transactionType,
      referenceType,
      // NOT NULL: the legacy row id is the last honest identity for a movement
      // that names no document at all.
      referenceId: documentId ?? `legacy:${sourceKey}`,
      documentType,
      documentId,
      woidPoid,
      invoiceNumber,
      invoiceId,
      adjustmentType,
      onFieldCountedQty: helpers.text('on_field_counted_qty'),
      adjSubcontractor: helpers.int('adj_subcontractor'),
      adjSite: helpers.int('adj_site'),
      isLogDeleted: helpers.flag('is_log_deleted') === 1,
      ...(included === null ? {} : { isIncludedInStockManagement: included === 1 }),
      note: helpers.text('notes'),
      idempotencyKey: `legacy:parts_salepurchase_log:${sourceKey}`,
      ...(createdAt === null ? {} : { createdAt: instantOf(createdAt) }),
    })
    .returning({ id: inventoryMovements.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'inventory_movements',
    targetKey: String(inserted!.id),
  })
}

/* ----------------------------- price lock ---------------------------- */

/**
 * The single global price-editor lock (id = 1).
 *
 * Only a lock that is actually held is carried. A released lock is the app's
 * default state for that row, so writing it would add nothing but a stale
 * `updated_at`.
 */
async function transformPriceLock(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return
  if (helpers.flag('is_locked') !== 1) return

  const seconds = helpers.int('lock_time')
  // Legacy unix seconds; a non-positive value never held a lock.
  const lockTime = seconds !== null && seconds > 0 ? new Date(seconds * 1000) : null

  await tx
    .insert(partPriceLocks)
    .values({
      id: 1,
      isLocked: true,
      lockedByName: helpers.text('locked_by'),
      lockTime,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: partPriceLocks.id,
      set: {
        isLocked: true,
        lockedByName: helpers.text('locked_by'),
        lockTime,
        updatedAt: new Date(),
      },
    })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'part_price_locks',
    targetKey: '1',
  })
}

/* ------------------------------ transformer --------------------------- */

export const transformer: GroupTransformer = {
  group: GROUP,

  async transform(context) {
    switch (context.table) {
      case 'parts_inventory_adjustment':
        return transformAdjustment(context)
      case 'parts_salepurchase_log':
        return transformMovement(context)
      case 'parts_price_lock':
        return transformPriceLock(context)
      case 'parts_inventory':
        return recordNotMigrated(
          context,
          'per-shipment batch (cost, sell, markup, sold counter) with no target table; app.parts keeps the authoritative counters (E4) and the rows stay in staging',
        )
      case 'parts_purchased_inventory':
        return recordNotMigrated(
          context,
          'purchase lines of a supplier invoice; the purchasing module owns receipts, and importing these beside parts_salepurchase_log would count every receipt twice',
        )
      case 'parts_purchasing_log':
        return recordNotMigrated(
          context,
          'earlier purchase write path superseded by parts_salepurchase_log, which is the ledger of record (DATA-DICTIONARY); importing both double counts purchases',
        )
      case 'parts_selling_log':
        return recordNotMigrated(
          context,
          'earlier sale write path superseded by parts_salepurchase_log, which is the ledger of record (DATA-DICTIONARY); importing both double counts sales',
        )
      default:
        throw new Error(`${GROUP}: no mapping for table ${context.table}`)
    }
  },

  unmapped: {
    'parts_inventory.*':
      'per-shipment batch rows (cost, sell, markup, sold counter): no batch table in `app`; app.parts keeps the authoritative counters (E4) and the rows stay in staging',
    'parts_purchased_inventory.*':
      'supplier-invoice purchase lines: the purchasing module owns receipts and importing these beside parts_salepurchase_log would count every receipt twice',
    'parts_purchasing_log.*':
      'earlier purchase write path superseded by parts_salepurchase_log, the ledger of record (DATA-DICTIONARY)',
    'parts_selling_log.*':
      'earlier sale write path superseded by parts_salepurchase_log, the ledger of record (DATA-DICTIONARY)',
    'parts_inventory_adjustment.id':
      'the legacy row id lives in migration.row_map, not on the target row',
    'parts_inventory_adjustment.inserted_datetime':
      'load stamp; date_created is the adjustment time and is used unless it is blank',
    'parts_salepurchase_log.id':
      'the legacy row id lives in migration.row_map; it is only used as a reference of last resort',
    'parts_salepurchase_log.inserted_datetime':
      'load stamp; date_created is the movement time',
    'parts_price_lock.id':
      'the target is a single row (id = 1); the legacy id is not carried',
    'parts_price_lock.locked_by':
      'a legacy display name, not a user id: stored in locked_by_name with locked_by left NULL',
  },

  parity: [
    {
      group: GROUP,
      label: 'sale movements: total quantity',
      // A movement with no part number cannot be inserted (part_no is NOT NULL)
      // and is recorded as unresolved_part_line, never zero-filled or invented.
      oldSql:
        "select coalesce(sum(nullif(regexp_replace(qty, '[^0-9.-]', '', 'g'), '')::numeric), 0) as total from migration.\"stg_parts_salepurchase_log\" where lower(transaction_type) = 'sale' and btrim(partno) <> ''",
      newSql:
        "select coalesce(sum(qty), 0)::numeric as total from app.inventory_movements where transaction_type = 'Sale' and idempotency_key like 'legacy:parts_salepurchase_log:%'",
    },
    {
      group: GROUP,
      label: 'purchase movements: total quantity',
      oldSql:
        "select coalesce(sum(nullif(regexp_replace(qty, '[^0-9.-]', '', 'g'), '')::numeric), 0) as total from migration.\"stg_parts_salepurchase_log\" where lower(transaction_type) = 'purchase'",
      newSql:
        "select coalesce(sum(qty), 0)::numeric as total from app.inventory_movements where transaction_type = 'Purchase' and idempotency_key like 'legacy:parts_salepurchase_log:%'",
    },
    {
      group: GROUP,
      label: 'manual stock adjustments: row count',
      oldSql: 'select count(*)::int as rows from migration."stg_parts_inventory_adjustment"',
      newSql:
        "select count(*)::int as rows from app.part_stock_adjustments where idempotency_key like 'legacy:parts_inventory_adjustment:%'",
    },
    {
      group: GROUP,
      label: 'adjustment quantities: total',
      oldSql:
        "select coalesce(sum(nullif(regexp_replace(qty, '[^0-9.-]', '', 'g'), '')::numeric), 0) as total from migration.\"stg_parts_inventory_adjustment\"",
      newSql:
        "select coalesce(sum(qty), 0)::numeric as total from app.part_stock_adjustments where idempotency_key like 'legacy:parts_inventory_adjustment:%'",
    },
  ],
}
