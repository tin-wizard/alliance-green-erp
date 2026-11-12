/**
 * Group 4 — parts and rate cards (plan §2.5 step 4).
 *
 * `parts.number` is the business key: preserved exactly (trim only), including
 * case, because a human reads it on a quote and a case-folded number would be a
 * different part to whoever types it next. Lookups are case-insensitive, which is
 * why a rate row written as `abc-01` still finds part `ABC-01`.
 *
 * Counters are preserved verbatim. `current_quantity` disagrees with the ledger in
 * the legacy system (measured baseline drift); correcting it here would make the
 * migration the source of a stock difference, so it is copied as-is and Inventory
 * owns the opening balance.
 *
 * Three tables have a uuid/bigserial target and no unique key to conflict on
 * (`parts_supplier_rates`, `parts_selling_rates`, `parts_price_history`), so their
 * idempotency comes from the crosswalk: a replayed row updates the row it created
 * instead of adding a second one.
 *
 * `prf` has no forward table (a purchase requisition form header is not modelled in
 * the rebuild). It is recorded as `not_migrated` and crosswalked to the mirror, so
 * the rows are not lost and the decision is on the report.
 */
import { eq, sql } from 'drizzle-orm'
import type { Tx } from '@cls/db'
import {
  partGroups,
  partPriceHistory,
  parts,
  partSellingRateLists,
  partSellingRates,
  partSupplierRateLists,
  partSupplierRates,
  sharedParts,
  users,
  workOrderNumberSeries,
} from '@cls/db/schema'
import type { GroupTransformer, TransformContext } from '../types'

const GROUP = 'parts'

/** Placeholder work orders (§5) are quarantined, so they must not seed a series. */
const PLACEHOLDER_WORK_ORDER_IDS = [0, 9999998, 9999999, 44444444, 99999999]

/** `work_order_number_series.id` is constrained to the two legacy series. */
const SERIES_IDS = new Set([1, 2])

const MAX_INT4 = 2_147_483_647

function requiredId(context: TransformContext): number {
  const id = context.helpers.int('id')
  if (id === null) {
    throw new Error(`${context.table}.id is not an integer: ${JSON.stringify(context.row.id)}`)
  }
  return id
}

/**
 * A legacy wall clock (`2025-03-04 10:11:12`) is read as UTC so the digits are
 * stored unchanged; no local-time conversion is applied (§2.6).
 */
function instant(value: string | null): Date | null {
  if (value === null) return null
  const normalised = value.includes('T') ? value : value.replace(' ', 'T')
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(normalised) ? normalised : `${normalised}Z`
  const parsed = new Date(zoned)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** A part number from a rate row: trimmed, case-insensitive, lowest id wins a tie. */
async function resolvePart(tx: Tx, code: string | null): Promise<number | null> {
  if (code === null) return null
  const [row] = await tx
    .select({ id: parts.id })
    .from(parts)
    .where(sql`lower(${parts.partNumber}) = ${code.toLowerCase()}`)
    .orderBy(parts.id)
    .limit(1)
  return row?.id ?? null
}

async function rememberMirror(context: TransformContext, reason: string): Promise<void> {
  const { helpers, sourceKey } = context
  const entity = context.table === 'prf' ? 'prf' : context.table
  await helpers.exception({
    exceptionClass: 'not_migrated',
    entity,
    sourceKey: context.table,
    action: 'kept in the read-only legacy mirror only; no app table exists',
    notes: reason,
  })
  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: `public.${context.table}`,
    targetKey: sourceKey,
  })
}

async function transformPart(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const id = requiredId(context)
  const partNumber = helpers.text('number')

  if (partNumber === null) {
    // The number is the identity every line, quote and rate row uses; a part
    // without one cannot be referenced, so it is reported rather than stored.
    await helpers.exception({
      exceptionClass: 'unresolved_part_line',
      entity: 'part',
      sourceKey,
      action: 'row not inserted: parts.number is the business key and is blank',
      notes: `parts.id = ${String(id)}`,
    })
    return
  }

  const [sameNumber] = await tx
    .select({ id: parts.id })
    .from(parts)
    .where(eq(parts.partNumber, partNumber))
    .limit(1)
  if (sameNumber && sameNumber.id !== id) {
    // Two legacy rows claiming one number is a master-data conflict: the unique
    // index would reject it anyway, so it fails with the two ids named.
    throw new Error(
      `parts.number ${JSON.stringify(partNumber)} already belongs to part ${sameNumber.id}, not ${id}`,
    )
  }

  // sage_item_id is a unique alternate key. Two legacy rows can point at one Sage
  // item; the migration keeps both parts and leaves the duplicate unlinked rather
  // than merging stock or failing the row.
  let sageItemId = helpers.int('sage_id')
  if (sageItemId !== null) {
    const [owner] = await tx
      .select({ id: parts.id })
      .from(parts)
      .where(eq(parts.sageItemId, sageItemId))
      .limit(1)
    if (owner && owner.id !== id) {
      await helpers.exception({
        exceptionClass: 'duplicate_sage_item',
        entity: 'part',
        sourceKey,
        action: 'part kept, sage_item_id stored NULL',
        notes: `sage_id ${sageItemId} already belongs to part ${owner.id}`,
      })
      sageItemId = null
    }
  }

  const values = {
    partNumber,
    name: helpers.text('name'),
    partGroupId: helpers.int('part_group_id'),
    cost: helpers.money('cost'),
    sellPrice: helpers.money('sell_price'),
    // A counter, not money: the target is NOT NULL, and legacy null already meant
    // "no stock movement recorded".
    purchasedQuantity: helpers.money('purchased_quantity') ?? '0',
    currentQuantity: helpers.money('current_quantity') ?? '0',
    soldQuantity: helpers.money('sold_quantity') ?? '0',
    sageItemId,
    activeInSage: helpers.flag('active_in_sage') === 1,
    subignore: helpers.flag('subignore') === 1,
    parentPartNumber: helpers.text('parent_partnumber'),
    clsLinkedPartCode: helpers.text('cls_linked_partcode'),
    warranty: helpers.text('warranty'),
    labourWarranty: helpers.text('labor_warranty'),
    installCostPerUnit: helpers.money('installcostperunit'),
    installProfitFormula: helpers.text('install_profit_formula'),
    recycleProfitFormula: helpers.text('recycle_profit_formula'),
    notes: helpers.text('part_popup_notes'),
  }

  await tx
    .insert(parts)
    .values({ id, ...values })
    .onConflictDoUpdate({ target: parts.id, set: { ...values, updatedAt: new Date() } })

  await helpers.remember({
    entity: 'part',
    sourceTable: context.table,
    sourceKey,
    targetTable: 'parts',
    targetKey: String(id),
  })
}

async function transformPartGroup(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const id = requiredId(context)
  // The target has no unique index on `name`, so the preserved legacy id is the
  // upsert key; deduplicating by label would need a constraint the schema lacks.
  const values = {
    name: helpers.text('name') ?? `group-${id}`,
    sortOrder: helpers.int('sort_id'),
    isWinner: helpers.flag('is_winner') === 1,
  }

  await tx
    .insert(partGroups)
    .values({ id, ...values })
    .onConflictDoUpdate({ target: partGroups.id, set: values })

  await helpers.remember({
    entity: 'part_group',
    sourceTable: context.table,
    sourceKey,
    targetTable: 'part_groups',
    targetKey: String(id),
  })
}

async function transformSellingRateList(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const id = requiredId(context)
  const values = {
    listHeading: helpers.text('list_heading'),
    listDate: helpers.date('list_date'),
    isWinner: helpers.flag('is_winner') === 1,
  }

  await tx
    .insert(partSellingRateLists)
    .values({ id, ...values })
    .onConflictDoUpdate({ target: partSellingRateLists.id, set: values })

  await helpers.remember({
    entity: 'part_selling_rate_list',
    sourceTable: context.table,
    sourceKey,
    targetTable: 'part_selling_rate_lists',
    targetKey: String(id),
  })
}

async function transformSupplierRateList(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const id = requiredId(context)
  const values = {
    supplierId: helpers.int('supplier_id'),
    listHeading: helpers.text('list_heading'),
    listDate: helpers.date('list_date'),
    hasBuyRates: helpers.flag('has_buy_rates') === 1,
  }

  await tx
    .insert(partSupplierRateLists)
    .values({ id, ...values })
    .onConflictDoUpdate({ target: partSupplierRateLists.id, set: values })

  await helpers.remember({
    entity: 'part_supplier_rate_list',
    sourceTable: context.table,
    sourceKey,
    targetTable: 'part_supplier_rate_lists',
    targetKey: String(id),
  })
}

async function transformSellingRate(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const partId = await resolvePart(tx, helpers.text('part_code'))
  if (partId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity: 'part_selling_rate',
      sourceKey,
      action: 'rate row not inserted: part_code matches no app.parts row',
      notes: `part_code = ${JSON.stringify(context.row.part_code)}`,
    })
    return
  }

  const insertedAt = instant(helpers.timestamp('date_inserted'))
  const values = {
    partId,
    listId: helpers.int('list_id'),
    oldSellPrice: helpers.money('old_sell_price'),
    increasePercentage: helpers.int('increase_percentage'),
    sellPrice: helpers.money('sell_price'),
    installPrice: helpers.money('install_price'),
    recyclePrice: helpers.money('recycle_price'),
    ...(insertedAt === null ? {} : { dateInserted: insertedAt }),
  }

  const existing = await helpers.targetKey('part_selling_rate', context.table, sourceKey)
  let targetKey = existing
  if (existing === null) {
    const [row] = await tx
      .insert(partSellingRates)
      .values(values)
      .returning({ id: partSellingRates.id })
    targetKey = row!.id
  } else {
    await tx.update(partSellingRates).set(values).where(eq(partSellingRates.id, existing))
  }

  await helpers.remember({
    entity: 'part_selling_rate',
    sourceTable: context.table,
    sourceKey,
    targetTable: 'part_selling_rates',
    targetKey: targetKey!,
  })
}

async function transformSupplierRate(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const partId = await resolvePart(tx, helpers.text('part_code'))
  if (partId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity: 'part_supplier_rate',
      sourceKey,
      action: 'rate row not inserted: part_code matches no app.parts row',
      notes: `part_code = ${JSON.stringify(context.row.part_code)}`,
    })
    return
  }

  // `cost_price` is the typed text and `cost_price_decimal` its parsed copy; the
  // copy wins when both exist so a currency symbol cannot change the number.
  const parsedCost = helpers.money('cost_price_decimal')
  const insertedAt = instant(helpers.timestamp('date_inserted'))

  const values = {
    partId,
    supplierId: helpers.int('supplier_id'),
    subSupplierId: helpers.int('sub_supplier_id'),
    costPrice: parsedCost ?? helpers.money('cost_price'),
    lastCostPrice: helpers.money('last_cost_price'),
    sellPrice: helpers.money('sell_price'),
    lastSellPrice: helpers.money('last_sell_price'),
    installPrice: helpers.money('install_price'),
    recyclePrice: helpers.money('recycle_price'),
    markup: helpers.money('markup'),
    modelNumber1: helpers.text('model_number_1'),
    modelNumber2: helpers.text('model_number_2'),
    modelNumber3: helpers.text('model_number_3'),
    supplierWarranty: helpers.text('supplier_warranty'),
    defaultRate: helpers.flag('default_rate') === 1,
    ...(insertedAt === null ? {} : { dateInserted: insertedAt }),
  }

  const existing = await helpers.targetKey('part_supplier_rate', context.table, sourceKey)
  let targetKey = existing
  if (existing === null) {
    const [row] = await tx
      .insert(partSupplierRates)
      .values(values)
      .returning({ id: partSupplierRates.id })
    targetKey = row!.id
  } else {
    await tx.update(partSupplierRates).set(values).where(eq(partSupplierRates.id, existing))
  }

  await helpers.remember({
    entity: 'part_supplier_rate',
    sourceTable: context.table,
    sourceKey,
    targetTable: 'part_supplier_rates',
    targetKey: targetKey!,
  })
}

/** A legacy username on a history row, resolved to a uuid when the account migrated. */
async function resolveUserName(tx: Tx, name: string | null): Promise<string | null> {
  if (name === null) return null
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.username}) = ${name.toLowerCase()}`)
    .limit(1)
  return row?.id ?? null
}

async function transformPriceHistory(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const priceId = helpers.int('price_id')

  // `price_id` is the legacy `parts.id`: the table records a per-part price change
  // and carries no part number, so the part is the only parent it can have.
  const parent =
    priceId === null
      ? undefined
      : (await tx.select({ id: parts.id }).from(parts).where(eq(parts.id, priceId)).limit(1))[0]
  if (!parent) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity: 'part_price_history',
      sourceKey,
      action: 'history row not inserted: price_id matches no app.parts row',
      notes: `price_id = ${JSON.stringify(context.row.price_id)}`,
    })
    return
  }

  const fieldName = helpers.text('field_name')
  if (fieldName === null) {
    // The field name is what makes a history row meaningful; without it the row
    // records nothing and the column is NOT NULL in the target.
    throw new Error(`parts_price_history.field_name is blank on source key ${sourceKey}`)
  }

  const changedAt = instant(helpers.timestamp('date_inserted'))
  const values = {
    partId: parent.id,
    fieldName,
    lastValue: helpers.text('last_value'),
    newValue: helpers.text('new_value'),
    changedBy: await resolveUserName(tx, helpers.text('user_name')),
    sectionName: helpers.text('section_name'),
    ...(changedAt === null ? {} : { changedAt }),
  }

  const existing = await helpers.targetKey('part_price_history', context.table, sourceKey)
  let targetKey = existing
  if (existing === null) {
    const [row] = await tx
      .insert(partPriceHistory)
      .values(values)
      .returning({ id: partPriceHistory.id })
    targetKey = String(row!.id)
  } else {
    await tx
      .update(partPriceHistory)
      .set(values)
      .where(eq(partPriceHistory.id, Number(existing)))
  }

  await helpers.remember({
    entity: 'part_price_history',
    sourceTable: context.table,
    sourceKey,
    targetTable: 'part_price_history',
    targetKey: targetKey!,
  })
}

async function transformSharedPart(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const partCode = helpers.text('partcode')
  const mainPartCode = helpers.text('main_partcode')

  if (partCode === null || mainPartCode === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity: 'shared_part',
      sourceKey,
      action: 'mapping not inserted: both codes are required',
      notes: `partcode = ${JSON.stringify(context.row.partcode)}, main_partcode = ${JSON.stringify(context.row.main_partcode)}`,
    })
    return
  }

  await tx
    .insert(sharedParts)
    .values({ partCode, mainPartCode })
    .onConflictDoUpdate({ target: sharedParts.partCode, set: { mainPartCode } })

  await helpers.remember({
    entity: 'shared_part',
    sourceTable: context.table,
    sourceKey,
    targetTable: 'shared_parts',
    targetKey: partCode,
  })
}

async function transformPrf(context: TransformContext): Promise<void> {
  await rememberMirror(
    context,
    'purchase requisition form header (internal request before a PO); the rebuild has no requisition table, the PO module starts at the purchase order',
  )
}

/**
 * `wo_next_pid` seeds the allocator. Taking only the legacy counter would let the
 * app issue a number a migrated work order already owns, so the floor is the
 * highest work-order id actually migrated (or staged, when this group runs before
 * the work-order transform).
 */
async function highestWorkOrderId(tx: Tx, dumpId: string): Promise<number> {
  const [applied] = (await tx.execute(
    sql`select coalesce(max("id"), 0)::int as value from app.work_orders`,
  )) as unknown as Array<{ value: number }>
  const [staged] = (await tx.execute(sql`
    select coalesce(max("id"::int), 0)::int as value
    from migration."stg_workorder"
    where "_dump_id" = ${dumpId}
      and "id" ~ '^[0-9]{1,9}$'
      and "id"::int not in ${sql.raw(`(${PLACEHOLDER_WORK_ORDER_IDS.join(', ')})`)}
  `)) as unknown as Array<{ value: number }>
  return Math.max(Number(applied?.value ?? 0), Number(staged?.value ?? 0))
}

async function transformNextPid(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, dumpId } = context
  const series = helpers.int('id')
  if (series === null || !SERIES_IDS.has(series)) {
    // The target has a check constraint (`id in (1, 2)`); a third counter has no
    // place to live and needs a decision, not a silent insert.
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity: 'wo_next_pid',
      sourceKey,
      action: 'series not seeded: the target allows series 1 and 2 only',
      notes: `id = ${JSON.stringify(context.row.id)}`,
    })
    return
  }

  const sourceNext = helpers.int('next_id')
  const floor = await highestWorkOrderId(tx, dumpId)
  const nextId = Math.min(MAX_INT4, Math.max(sourceNext ?? 1, floor + 1))

  const values = {
    nextId,
    description: helpers.text('comments') ?? '',
  }

  await tx
    .insert(workOrderNumberSeries)
    .values({ id: series, ...values })
    .onConflictDoUpdate({
      target: workOrderNumberSeries.id,
      set: { ...values, updatedAt: new Date() },
    })

  await helpers.exception({
    exceptionClass: 'series_seed',
    entity: 'wo_next_pid',
    sourceKey,
    action: 'allocator seeded above both the legacy counter and the highest migrated work order',
    notes: `series ${series}: next_id = ${nextId} (legacy ${sourceNext ?? 'none'}, highest work order ${floor})`,
  })

  await helpers.remember({
    entity: 'wo_next_pid',
    sourceTable: context.table,
    sourceKey,
    targetTable: 'work_order_number_series',
    targetKey: String(series),
  })
}

export const transformer: GroupTransformer = {
  group: GROUP,

  async transform(context) {
    switch (context.table) {
      case 'parts':
        return transformPart(context)
      case 'parts_group':
        return transformPartGroup(context)
      case 'parts_selling_rates':
        return transformSellingRate(context)
      case 'parts_selling_rates_list':
        return transformSellingRateList(context)
      case 'parts_supplier_rates':
        return transformSupplierRate(context)
      case 'parts_supplier_rates_list':
        return transformSupplierRateList(context)
      case 'parts_price_history':
        return transformPriceHistory(context)
      case 'shared_parts_list':
        return transformSharedPart(context)
      case 'prf':
        return transformPrf(context)
      case 'wo_next_pid':
        return transformNextPid(context)
      default:
        throw new Error(`${GROUP}: no mapping for table ${context.table}`)
    }
  },

  unmapped: {
    'parts.saved_sage_price':
      'the last price Sage sent back; reconciliation owns the Sage diff and `cost`/`sell_price` are the stored values',
    'parts.is_sage_saved': 'flag for the legacy saved-price cache; no forward column',
    'parts.defaultsortorder':
      'legacy catalogue ordering; the forward list sorts by number and name',
    'parts.part_popup_notes': 'mapped to parts.notes, the only free-text column in the target',
    'parts_supplier_rates.list_id':
      'no list column on app.part_supplier_rates; the list header migrates but rate rows are not linked to it (schema gap)',
    'parts_supplier_rates.cost_price_decimal':
      'the parsed copy of cost_price and preferred when present; not stored twice',
    'parts_price_history.price_id':
      'treated as the legacy parts.id (the table carries no part number); unresolved values are orphan_line',
    'prf.*':
      'purchase requisition headers have no forward table; rows stay in the mirror (not_migrated)',
    'wo_next_pid.comments': 'mapped to work_order_number_series.description',
    'wo_next_pid.next_id': 'mapped, but floored at the highest migrated work-order id (§2.6)',
  },

  parity: [
    {
      group: GROUP,
      label: 'parts',
      oldSql: 'select count(*)::int as value from migration."stg_parts"',
      newSql: 'select count(*)::int as value from app.parts where id > 0',
    },
    {
      group: GROUP,
      label: 'parts sell-price sum',
      oldSql: `select coalesce(sum(case when "sell_price" ~ '^-?[0-9]+(\\.[0-9]+)?$' then "sell_price"::numeric else 0 end), 0)::numeric as value
from migration."stg_parts"`,
      newSql: 'select coalesce(sum(sell_price), 0)::numeric as value from app.parts where id > 0',
    },
    {
      group: GROUP,
      label: 'parts cost sum',
      oldSql: `select coalesce(sum(case when "cost" ~ '^-?[0-9]+(\\.[0-9]+)?$' then "cost"::numeric else 0 end), 0)::numeric as value
from migration."stg_parts"`,
      newSql: 'select coalesce(sum(cost), 0)::numeric as value from app.parts where id > 0',
    },
    {
      group: GROUP,
      label: 'part groups',
      oldSql: 'select count(*)::int as value from migration."stg_parts_group"',
      newSql: 'select count(*)::int as value from app.part_groups',
    },
    {
      group: GROUP,
      label: 'supplier rate cards',
      oldSql: 'select count(*)::int as value from migration."stg_parts_supplier_rates"',
      newSql: 'select count(*)::int as value from app.part_supplier_rates',
    },
    {
      group: GROUP,
      label: 'selling rate cards',
      oldSql: 'select count(*)::int as value from migration."stg_parts_selling_rates"',
      newSql: 'select count(*)::int as value from app.part_selling_rates',
    },
    {
      group: GROUP,
      label: 'shared part mappings',
      oldSql: 'select count(*)::int as value from migration."stg_shared_parts_list"',
      // `app.shared_parts` has no surrogate key, so the rehearsal reset cannot
      // delete an earlier run's rows. Read the rows this import owns through the
      // crosswalk instead of a delta over the whole table.
      newSql: `select count(*)::int as value
from app.shared_parts p
join migration.row_map r
  on r.entity = 'shared_part'
 and r.source_table = 'shared_parts_list'
 and r.target_table = 'shared_parts'
 and r.target_key = p.part_code`,
    },
    {
      group: GROUP,
      label: 'price history rows',
      oldSql: 'select count(*)::int as value from migration."stg_parts_price_history"',
      newSql: 'select count(*)::int as value from app.part_price_history',
    },
  ],
}
