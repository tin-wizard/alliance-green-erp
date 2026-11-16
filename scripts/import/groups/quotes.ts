/**
 * Group 7 — quotes (plan §2.5 step 7).
 *
 * The forward model keeps one header table (`app.quotes`) with a `kind`
 * discriminator, while legacy keeps two near-identical headers. That merge is the
 * only real decision in this group:
 *
 *  - `customer_quote.id` is the quote number staff and customers know, so it is
 *    preserved as `app.quotes.id`.
 *  - `standalone_quote.id` comes from a second, overlapping number space. Two
 *    legacy rows can own the same number, so a standalone quote is given the next
 *    free id and the crosswalk keeps the legacy number. The id sequence is moved
 *    past every explicit insert so a later app-side quote cannot reuse a number.
 *
 * Legacy headers store no subtotal or total — only `tax_amount`, which is the
 * operator's typed tax. The transformer therefore stores it as
 * `manual_tax_amount` (honoured as typed) and **recomputes** the quote from its
 * staged lines with `@cls/pricing`, the same calculator the app uses. When the
 * recomputed tax disagrees with the legacy figure the difference is an
 * `unbalanced_totals` exception for finance: neither number is silently dropped,
 * because the legacy number is what the customer's PDF printed.
 */
import { and, eq, sql } from 'drizzle-orm'
import type { Tx } from '@cls/db'
// Relative on purpose: `scripts/` is outside the workspace packages, so the bare
// `@cls/pricing` specifier only resolves through the repo tsconfig `paths`, which
// the migration runner has and a lone script does not.
import {
  calculateQuoteTotals,
  format,
  isZero,
  parseDecimal,
  round,
  subtract,
} from '../../../packages/pricing/src/index'
import {
  quoteHours,
  quotePackingParts,
  quotePackingSlips,
  quotePackingSpecialParts,
  quoteParts,
  quoteRejections,
  quotes,
  quoteSpecialParts,
  sites,
  users,
  workOrders,
} from '@cls/db/schema'
import type { GroupTransformer, TransformContext, TransformHelpers } from '../types'
import { selectIdMemo } from '../exists-memo'

const GROUP = 'quotes'

/** Quote statuses: 1 in progress, 2 saved, 3 awaiting approval, 4 approved, 5 cancelled. */
const QUOTE_STATUS_CODES = ['1', '2', '3', '4', '5'] as const

/** The header crosswalk lives under one entity because the target is one table. */
const QUOTE_ENTITY = 'quote'

const LEGACY_TO_ENTITY: Record<string, string> = {
  customer_quote: 'customer_quote',
  customer_quote_hours: 'customer_quote_hour',
  customer_quote_parts: 'customer_quote_part',
  customer_quote_soparts: 'customer_quote_special_part',
  customer_qo_packing_slip: 'quote_packing_slip',
  customer_qo_packing_parts: 'quote_packing_part',
  standalone_quote: 'standalone_quote',
  standalone_quote_hours: 'standalone_quote_hour',
  standalone_quote_parts: 'standalone_quote_part',
  standalone_quote_soparts: 'standalone_quote_special_part',
  rejected_quotes: 'rejected_quote',
}

type ExceptionInput = Parameters<TransformHelpers['exception']>[0]

/**
 * `types.ts`'s `ExceptionClass` union predates these groups; the column is free
 * text and `helpers.exception` already casts, so the extra labels land as written.
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
  return LEGACY_TO_ENTITY[table] ?? 'customer_quote'
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

/** Legacy `revision_id` is a float chain number: 0, 0.1, 0.2 … */
function revisionNumberOf(helpers: TransformHelpers): string {
  const raw = helpers.text('revision_id')
  if (raw === null) return '0.0'
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed.toFixed(1) : '0.0'
}

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
): Promise<Record<string, unknown> | null> {
  const text = helpers.text(column)
  if (text === null) return null
  try {
    const parsed = JSON.parse(text) as unknown
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : { value: parsed }
  } catch {
    await recordException(helpers, {
      exceptionClass: 'unparseable_json',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'stored NULL content',
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
  entity: string,
  targetTable: string,
  targetKey: string,
): Promise<void> {
  await context.helpers.remember({
    entity,
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
  const [row] = await selectIdMemo(tx, sites.id, candidate)
  return row?.id ?? null
}

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

/**
 * A quote id referenced from another legacy quote. Both headers share the target
 * table, so both crosswalks are tried before the id is taken at face value.
 */
async function resolveQuoteId(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  for (const sourceTable of ['customer_quote', 'standalone_quote']) {
    const mapped = await helpers.targetKey(QUOTE_ENTITY, sourceTable, String(legacyId))
    if (mapped !== null) {
      const candidate = intOf(mapped)
      if (candidate !== null) return candidate
    }
  }
  // No mapping yet: a customer quote keeps its number, so the id is its own key.
  const [row] = await selectIdMemo(tx, quotes.id, legacyId)
  return row?.id ?? null
}

async function quoteParent(
  context: TransformContext,
  sourceTable: string,
  column: string,
): Promise<number | null> {
  const { helpers } = context
  const mapped = await helpers.targetKey(
    QUOTE_ENTITY,
    sourceTable,
    String(helpers.int(column) ?? ''),
  )
  const candidate = intOf(mapped)
  if (candidate !== null) return candidate
  await recordException(helpers, {
    exceptionClass: 'orphan_line',
    entity: entityFor(context.table),
    sourceKey: context.sourceKey,
    action: 'row not inserted: quote_id is NOT NULL and the quote does not exist',
    notes: `${column} = ${JSON.stringify(context.row[column])}, source table ${sourceTable}`,
  })
  return null
}

/* ------------------------------- header rules ------------------------------ */

interface StagedLine {
  [column: string]: string | null
}

async function stagedLines(
  tx: Tx,
  table: string,
  dumpId: string,
  column: string,
  key: string,
): Promise<StagedLine[]> {
  const rows = (await tx.execute(
    sql`select * from ${sql.raw(`migration."stg_${table}"`)} where "_dump_id" = ${dumpId} and ${sql.raw(`"${column}"`)} = ${key}`,
  )) as unknown as StagedLine[]
  return rows ?? []
}

function isNumber(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false
  const trimmed = value.trim()
  return trimmed !== '' && Number.isFinite(Number(trimmed.replace(/[$,\s]/g, '')))
}

function numberOr(value: string | null | undefined, fallback: string): string {
  if (!isNumber(value)) return fallback
  return String(Number(String(value).replace(/[$,\s]/g, '')))
}

/**
 * Recompute the quote from its staged lines and compare the tax with the legacy
 * figure. Returns true when the two agree (or when there is nothing to compare).
 */
async function reconcileQuoteTotals(
  context: TransformContext,
  legacyId: string,
  source: 'customer' | 'standalone',
  legacyTax: string | null,
  appliedTaxRate: string | null,
): Promise<void> {
  const { tx, helpers, dumpId } = context
  if (legacyTax === null || appliedTaxRate === null) return

  const hoursTable = source === 'customer' ? 'customer_quote_hours' : 'standalone_quote_hours'
  const partsTable = source === 'customer' ? 'customer_quote_parts' : 'standalone_quote_parts'
  const sopartsTable = source === 'customer' ? 'customer_quote_soparts' : 'standalone_quote_soparts'
  const column = source === 'customer' ? 'cust_qoid' : 'sal_qoid'

  const [hours, parts, specialParts] = await Promise.all([
    stagedLines(tx, hoursTable, dumpId, column, legacyId),
    stagedLines(tx, partsTable, dumpId, column, legacyId),
    stagedLines(tx, sopartsTable, dumpId, column, legacyId),
  ])
  if (hours.length + parts.length + specialParts.length === 0) return

  let totals: ReturnType<typeof calculateQuoteTotals>
  try {
    totals = calculateQuoteTotals({
      appliedTaxRate,
      labour: hours
        .filter((line) => isNumber(line.hours) && isNumber(line.rate))
        .map((line) => ({
          hours: numberOr(line.hours, '0'),
          numTechs: numberOr(line.numtechs, '1'),
          rate: numberOr(line.rate, '0'),
        })),
      parts: parts
        .filter((line) => isNumber(line.qty) && isNumber(line.price))
        .map((line) => ({ qty: numberOr(line.qty, '0'), price: numberOr(line.price, '0') })),
      specialParts: specialParts
        .filter((line) => isNumber(line.qty) && isNumber(line.price))
        .map((line) => ({
          name: (line.name ?? '').trim() === '' ? 'unnamed' : (line.name ?? ''),
          qty: numberOr(line.qty, '0'),
          price: numberOr(line.price, '0'),
        })),
    })
  } catch {
    // The calculator refuses values it cannot round; the line rows carry the
    // per-value exceptions, so there is nothing more to say here.
    return
  }

  const computed = parseDecimal(totals.tax)
  const legacy = parseDecimal(legacyTax)
  if (computed === null || legacy === null) return
  const difference = round(subtract(computed, legacy), 2)
  if (isZero(difference)) return

  await recordException(helpers, {
    exceptionClass: 'unbalanced_totals',
    entity: entityFor(context.table),
    sourceKey: context.sourceKey,
    action: 'legacy tax_amount kept as manual_tax_amount; recomputed tax recorded',
    notes: `subtotal = ${totals.subtotal}, computed tax = ${totals.tax}, legacy tax_amount = ${legacyTax}, difference = ${format(difference, 2)}`,
  })
}

async function transformQuoteHeader(
  context: TransformContext,
  kind: 'customer' | 'standalone',
): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const legacyId = helpers.int('id')
  if (legacyId === null) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'row not inserted: the quote has no id',
      notes: `id = ${JSON.stringify(context.row.id)}`,
    })
    return
  }

  const siteIdRaw = helpers.int('site')
  let siteId = await resolveSite(tx, helpers, siteIdRaw)
  if (siteId === null && siteIdRaw !== null) {
    // Preserved raw (the column has no FK) so the quote is not lost; operations
    // must import the missing site.
    siteId = siteIdRaw
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'raw legacy site id preserved in site_id; no app.sites row exists',
      notes: `site = ${JSON.stringify(context.row.site)}`,
    })
  }
  if (siteId === null) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'row not inserted: site_id is NOT NULL and the row has no site',
      notes: `site = ${JSON.stringify(context.row.site)}`,
    })
    return
  }

  const statusLabel = helpers.enumOf('status', QUOTE_STATUS_CODES)
  let status = statusLabel === null ? 1 : Number(statusLabel)
  if (statusLabel === null && (context.row.status ?? '').trim() !== '') {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity: entityFor(context.table),
      sourceKey,
      action: 'stored status 1 (in progress) because the target column is NOT NULL',
      notes: `status = ${JSON.stringify(context.row.status)} is not one of 1-5`,
    })
  }
  if (status === 2 && kind === 'customer') {
    // `quotes_saved_kind_check`: "saved" only exists for standalone quotes.
    await recordException(helpers, {
      exceptionClass: 'status_not_allowed_for_kind',
      entity: entityFor(context.table),
      sourceKey,
      action: 'stored status 1 (in progress)',
      notes: 'status 2 (saved) is a standalone-only state',
    })
    status = 1
  }

  const revisionLegacyId = helpers.int('revision_quote_id')
  const revisionQuoteId = await resolveQuoteId(tx, helpers, revisionLegacyId)
  let rootQuoteId: number | null = null
  if (revisionQuoteId !== null) {
    const [predecessor] = await tx
      .select({ rootQuoteId: quotes.rootQuoteId })
      .from(quotes)
      .where(eq(quotes.id, revisionQuoteId))
      .limit(1)
    rootQuoteId = predecessor?.rootQuoteId ?? revisionQuoteId
  }

  // The chain end is a property of the whole dump, not of processing order: a
  // quote is last when no other staged row quotes it as its predecessor.
  const children = await tx.execute(
    sql`select 1 from ${sql.raw(`migration."stg_${context.table}"`)} where "_dump_id" = ${context.dumpId} and "revision_quote_id" = ${String(legacyId)} limit 1`,
  )
  const hasChild = Array.isArray(children) && children.length > 0

  const workOrderNumber = helpers.int('workordernumber')
  let convertedWorkOrderId: number | null = null
  if (kind === 'customer' && workOrderNumber !== null) {
    // A reserved number that has a work order is a quote that was converted.
    const [converted] = await selectIdMemo(tx, workOrders.id, workOrderNumber)
    convertedWorkOrderId = converted?.id ?? null
  }

  const dateCreated = helpers.date('date_created')
  const taxAmount = helpers.money('tax_amount')
  const appliedTaxRate = decimalOf(helpers.text('appliedtaxrate'))

  const values: typeof quotes.$inferInsert = {
    kind,
    workOrderNumber,
    siteId,
    shipContact: helpers.text('ShipCntc'),
    shipStreet1: helpers.text('ShipStrt1'),
    shipStreet2: helpers.text('ShipStrt2'),
    shipCity: helpers.text('ShipCity'),
    shipProvince: helpers.text('ShipPrvSt'),
    shipPostalCode: helpers.text('ShipPstZp'),
    isAddressUpdated: helpers.flag('is_address_updated') === 1,
    report: kind === 'customer' ? helpers.text('report') : null,
    notes: helpers.text('notes'),
    pdfNotes: kind === 'standalone' ? helpers.text('pdf_notes') : null,
    status,
    paymentTermsId: kind === 'customer' ? helpers.int('payment_terms') : null,
    taxCode: helpers.text('tax_code'),
    appliedTaxRate,
    manualTaxAmount: taxAmount,
    dueDate: kind === 'customer' ? helpers.date('due_date') : null,
    isDueDateTbd: kind === 'customer' && helpers.flag('is_due_date_tbd') === 1,
    dateApproved: helpers.date('date_approved'),
    ...(dateCreated === null ? {} : { dateCreated }),
    isRevision: helpers.flag('is_revision') === 1,
    revisionQuoteId,
    rootQuoteId,
    revisionId: revisionNumberOf(helpers),
    isLastRevision: !hasChild,
    isDeleted: kind === 'standalone' && helpers.flag('is_deleted') === 1,
    createdFromLocal: kind === 'standalone' && helpers.flag('created_from_local') === 1,
    referenceWoNumber: kind === 'standalone' ? helpers.text('reference_wo_number') : null,
    convertedWorkOrderId,
    createdBy: await resolveUser(tx, helpers, helpers.int('createdby')),
  }

  if (kind === 'customer') {
    // The legacy number is the number on the customer's PDF; keep it. If a
    // standalone quote already owns it, do not clobber that row.
    const [inserted] = await tx
      .insert(quotes)
      .values({ ...values, id: legacyId })
      .onConflictDoNothing({ target: quotes.id })
      .returning({ id: quotes.id })
    if (inserted) {
      await rememberRow(context, QUOTE_ENTITY, 'quotes', String(inserted.id))
    } else {
      const [existing] = await tx
        .select({ id: quotes.id, kind: quotes.kind })
        .from(quotes)
        .where(eq(quotes.id, legacyId))
        .limit(1)
      if (existing?.kind !== 'customer') {
        await recordException(helpers, {
          exceptionClass: 'quote_id_collision',
          entity: entityFor(context.table),
          sourceKey,
          action: 'row not inserted: the target id belongs to another quote',
          notes: `customer_quote.id = ${String(legacyId)}`,
        })
        return
      }
      await tx.update(quotes).set(values).where(eq(quotes.id, legacyId))
      await rememberRow(context, QUOTE_ENTITY, 'quotes', String(legacyId))
    }
  } else {
    const mapped = await helpers.targetKey(QUOTE_ENTITY, context.table, sourceKey)
    if (mapped === null) {
      // Second id space: take the next free number and keep the crosswalk.
      const [next] = (await tx.execute(
        sql`select coalesce(max(id), 0) + 1 as id from app.quotes`,
      )) as unknown as Array<{ id: number }>
      const [inserted] = await tx
        .insert(quotes)
        .values({ ...values, id: Number(next!.id) })
        .returning({ id: quotes.id })
      await rememberRow(context, QUOTE_ENTITY, 'quotes', String(inserted!.id))
    } else {
      await tx
        .update(quotes)
        .set(values)
        .where(eq(quotes.id, Number(mapped)))
      await rememberRow(context, QUOTE_ENTITY, 'quotes', mapped)
    }
  }

  // Keep the serial ahead of every explicit insert so an app-side quote cannot
  // reuse a number the migration already handed out (§2.6).
  await tx.execute(
    sql`select setval(pg_get_serial_sequence('app.quotes', 'id'), greatest((select coalesce(max(id), 1) from app.quotes), 1))`,
  )

  await reconcileQuoteTotals(context, String(legacyId), kind, taxAmount, appliedTaxRate)
}

/* --------------------------------- lines ---------------------------------- */

async function transformQuoteHour(
  context: TransformContext,
  sourceTable: string,
  column: string,
): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const quoteId = await quoteParent(context, sourceTable, column)
  if (quoteId === null) return

  const [inserted] = await tx
    .insert(quoteHours)
    .values({
      quoteId,
      lineDate: helpers.date('date'),
      hours: await requiredMoney(helpers, context, 'hours'),
      numTechs: helpers.int('numtechs') ?? 1,
      rateCode: null,
      rate: await requiredMoney(helpers, context, 'rate'),
      incurredHours: null,
      incurredRate: null,
      note: null,
      // Legacy has no line order; insertion order is the order the operator saw.
      sortOrder: helpers.int('id') ?? 0,
    })
    .returning({ id: quoteHours.id })
  await rememberRow(context, entityFor(context.table), 'quote_hours', String(inserted!.id))
}

async function transformQuotePart(
  context: TransformContext,
  sourceTable: string,
  column: string,
): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const quoteId = await quoteParent(context, sourceTable, column)
  if (quoteId === null) return

  const [inserted] = await tx
    .insert(quoteParts)
    .values({
      quoteId,
      partNo: helpers.text('partno') ?? '',
      description: null,
      qty: helpers.int('qty') ?? 0,
      price: await requiredMoney(helpers, context, 'price'),
      costPrice: null,
      isUnderWarranty: helpers.flag('is_under_warranty') === 1,
      sortOrder: helpers.int('id') ?? 0,
    })
    .returning({ id: quoteParts.id })
  await rememberRow(context, entityFor(context.table), 'quote_parts', String(inserted!.id))
}

async function transformQuoteSpecialPart(
  context: TransformContext,
  sourceTable: string,
  column: string,
): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const quoteId = await quoteParent(context, sourceTable, column)
  if (quoteId === null) return

  const [inserted] = await tx
    .insert(quoteSpecialParts)
    .values({
      quoteId,
      name: helpers.text('name') ?? '',
      qty: helpers.int('qty') ?? 0,
      price: await requiredMoney(helpers, context, 'price'),
      costPrice: null,
      isEmergencyLighting: false,
      sortOrder: helpers.int('id') ?? 0,
    })
    .returning({ id: quoteSpecialParts.id })
  await rememberRow(context, entityFor(context.table), 'quote_special_parts', String(inserted!.id))
}

async function transformQuotePackingSlip(context: TransformContext): Promise<void> {
  const { tx, helpers } = context
  // `cust_qoid` names a customer quote, so the crosswalk is the customer quote's.
  const quoteId = await quoteParent(context, 'customer_quote', 'cust_qoid')
  if (quoteId === null) return

  const mapped = await helpers.targetKey(entityFor(context.table), context.table, context.sourceKey)
  const dateCreated = helpers.date('date_created')
  const values: typeof quotePackingSlips.$inferInsert = {
    quoteId,
    shipDate: helpers.date('ship_date'),
    packingSlipLevel: helpers.int('packing_slip_level') ?? 1,
    ...(dateCreated === null ? {} : { dateCreated }),
  }
  let targetKey = mapped
  if (mapped === null) {
    const [inserted] = await tx
      .insert(quotePackingSlips)
      .values(values)
      .returning({ id: quotePackingSlips.id })
    targetKey = String(inserted!.id)
  } else {
    await tx
      .update(quotePackingSlips)
      .set(values)
      .where(eq(quotePackingSlips.id, Number(mapped)))
  }
  await rememberRow(context, entityFor(context.table), 'quote_packing_slips', targetKey!)
}

async function transformQuotePackingPart(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const slipKey = helpers.int('packing_slip_id')
  const mappedSlip =
    slipKey === null
      ? null
      : await helpers.targetKey('quote_packing_slip', 'customer_qo_packing_slip', String(slipKey))
  if (mappedSlip === null) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'row not inserted: packing_slip_id is NOT NULL and the slip does not exist',
      notes: `packing_slip_id = ${JSON.stringify(context.row.packing_slip_id)}`,
    })
    return
  }

  const [slip] = await tx
    .select({ id: quotePackingSlips.id, quoteId: quotePackingSlips.quoteId })
    .from(quotePackingSlips)
    .where(eq(quotePackingSlips.id, Number(mappedSlip)))
    .limit(1)
  if (!slip) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'row not inserted: the packing slip has no row in app.quote_packing_slips',
      notes: `packing_slip_id = ${JSON.stringify(context.row.packing_slip_id)}`,
    })
    return
  }

  // The shipped line points at the quote line it belongs to when the part number
  // matches; the packing slip carries the quote, so the link is derivable.
  const partNo = helpers.text('partno')
  const [quotePart] =
    partNo === null
      ? []
      : await tx
          .select({ id: quoteParts.id })
          .from(quoteParts)
          .where(and(eq(quoteParts.quoteId, slip.quoteId), eq(quoteParts.partNo, partNo)))
          .orderBy(sql`${quoteParts.id} asc`)
          .limit(1)

  const [inserted] = await tx
    .insert(quotePackingParts)
    .values({
      packingSlipId: slip.id,
      quotePartId: quotePart?.id ?? null,
      partNo: partNo ?? '',
      actualQty: helpers.int('actual_qty'),
      backorderQty: helpers.int('backorder_qty') ?? 0,
      shippedQty: helpers.int('shipped_qty'),
      sortOrder: helpers.int('sortorder') ?? helpers.int('id') ?? 0,
    })
    .returning({ id: quotePackingParts.id })
  await rememberRow(context, entityFor(context.table), 'quote_packing_parts', String(inserted!.id))
}

/** The special-part mirror of the packing line above: same slip, no part number. */
async function transformQuotePackingSpecialPart(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const slipKey = helpers.int('packing_slip_id')
  const mappedSlip =
    slipKey === null
      ? null
      : await helpers.targetKey('quote_packing_slip', 'customer_qo_packing_slip', String(slipKey))
  if (mappedSlip === null) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'row not inserted: packing_slip_id is NOT NULL and the slip does not exist',
      notes: `packing_slip_id = ${JSON.stringify(context.row.packing_slip_id)}`,
    })
    return
  }

  const [slip] = await tx
    .select({ id: quotePackingSlips.id, quoteId: quotePackingSlips.quoteId })
    .from(quotePackingSlips)
    .where(eq(quotePackingSlips.id, Number(mappedSlip)))
    .limit(1)
  if (!slip) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'row not inserted: the packing slip has no row in app.quote_packing_slips',
      notes: `packing_slip_id = ${JSON.stringify(context.row.packing_slip_id)}`,
    })
    return
  }

  // The shipped special part is linked by name within the slip's quote.
  const name = helpers.text('name') ?? ''
  const [special] =
    name === ''
      ? []
      : await tx
          .select({ id: quoteSpecialParts.id })
          .from(quoteSpecialParts)
          .where(and(eq(quoteSpecialParts.quoteId, slip.quoteId), eq(quoteSpecialParts.name, name)))
          .orderBy(sql`${quoteSpecialParts.id} asc`)
          .limit(1)

  const [inserted] = await tx
    .insert(quotePackingSpecialParts)
    .values({
      packingSlipId: slip.id,
      quoteSpecialPartId: special?.id ?? null,
      name,
      actualQty: helpers.int('actual_qty'),
      backorderQty: helpers.int('backorder_qty') ?? 0,
      shippedQty: helpers.int('shipped_qty'),
      sortOrder: helpers.int('sortorder') ?? helpers.int('id') ?? 0,
    })
    .returning({ id: quotePackingSpecialParts.id })
  await rememberRow(
    context,
    entityFor(context.table),
    'quote_packing_special_parts',
    String(inserted!.id),
  )
}

async function transformRejectedQuote(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const workOrderNumber = helpers.int('woid')
  const [quote] =
    workOrderNumber === null
      ? []
      : await tx
          .select({ id: quotes.id })
          .from(quotes)
          .where(and(eq(quotes.workOrderNumber, workOrderNumber), eq(quotes.kind, 'customer')))
          .orderBy(sql`${quotes.id} desc`)
          .limit(1)

  if (!quote) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'row not inserted: quote_id is NOT NULL and no quote carries that work-order number',
      notes: `woid = ${JSON.stringify(context.row.woid)}`,
    })
    return
  }

  const rejectedSeconds = helpers.int('date_rejected')
  const rejectedAt = rejectedSeconds === null ? null : new Date(rejectedSeconds * 1000)
  const [inserted] = await tx
    .insert(quoteRejections)
    .values({
      quoteId: quote.id,
      reason: helpers.text('rejected_reason'),
      quoteContent: await parseJson(helpers, context, 'quote_content'),
      rejectedByDetail: helpers.text('rejected_by_detail'),
      ...(rejectedAt === null ? {} : { rejectedAt }),
    })
    .returning({ id: quoteRejections.id })
  await rememberRow(context, entityFor(context.table), 'quote_rejections', String(inserted!.id))
}

const PAYTERMS =
  'payment-term vocabulary; app.quotes.payment_terms_id is a soft reference and the terms are entered by hand, so the five labels are not copied'
const QUOTE_WORKSHEET =
  'subcontractor quote worksheet; the app has no second quote table, and these rows were re-entered into app.quotes'
const QUOTE_WORKSHEET_HOURS =
  'subcontractor worksheet hours; the customer quote labour lives in app.quote_hours'
const QUOTE_WORKSHEET_PART =
  'subcontractor worksheet part; the customer quote material lives in app.quote_parts'
const QUOTE_WORKSHEET_SPECIAL =
  'subcontractor worksheet special part; the customer quote special part lives in app.quote_special_parts'
const QUOTE_INCURRED =
  'incurred cost tracking for the worksheet; cost accounting moved to app.subcontractor_invoices, so the incurred snapshot is not replayed'
const CALCQUOTE =
  'calculated-quote snapshot; every total is recomputed from the stored lines by @cls/pricing, so a second copy of the arithmetic would only be able to disagree'
const CALCQUOTE_HOURS =
  'calculated-quote hour snapshot; the hours themselves are migrated from customer_quote_hours'
const CALCQUOTE_PART =
  'calculated-quote part snapshot; the parts are migrated from customer_quote_parts'
const CALCQUOTE_SPECIAL =
  'calculated-quote special part snapshot; the parts are migrated from customer_quote_soparts'
const CALCQUOTE_REPORT =
  'calculated-quote report snapshot; app.quotes.report already carries the report text from customer_quote'

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
      case 'customer_quote':
        return transformQuoteHeader(context, 'customer')
      case 'customer_quote_hours':
        return transformQuoteHour(context, 'customer_quote', 'cust_qoid')
      case 'customer_quote_parts':
        return transformQuotePart(context, 'customer_quote', 'cust_qoid')
      case 'customer_quote_soparts':
        return transformQuoteSpecialPart(context, 'customer_quote', 'cust_qoid')
      case 'customer_qo_packing_slip':
        return transformQuotePackingSlip(context)
      case 'customer_qo_packing_parts':
        return transformQuotePackingPart(context)
      case 'standalone_quote':
        return transformQuoteHeader(context, 'standalone')
      case 'standalone_quote_hours':
        return transformQuoteHour(context, 'standalone_quote', 'sal_qoid')
      case 'standalone_quote_parts':
        return transformQuotePart(context, 'standalone_quote', 'sal_qoid')
      case 'standalone_quote_soparts':
        return transformQuoteSpecialPart(context, 'standalone_quote', 'sal_qoid')
      case 'rejected_quotes':
        return transformRejectedQuote(context)
      case 'customer_qo_packing_soparts':
        return transformQuotePackingSpecialPart(context)
      // The `quote_*`/`calcquote_*` worksheets and the payment-term vocabulary
      // joined the group after this transformer was first written. None has a
      // target table; each is recorded once per table instead of throwing.
      case 'customer_quote_payterms':
        return skipTable(context, PAYTERMS)
      case 'quote_hours':
        return skipTable(context, QUOTE_WORKSHEET_HOURS)
      case 'quote_hours_incurred':
        return skipTable(context, QUOTE_INCURRED)
      case 'quote_parts':
        return skipTable(context, QUOTE_WORKSHEET_PART)
      case 'quote_parts_incurred':
        return skipTable(context, QUOTE_INCURRED)
      case 'quote_report':
        return skipTable(context, QUOTE_WORKSHEET)
      case 'quote_soparts':
        return skipTable(context, QUOTE_WORKSHEET_SPECIAL)
      case 'quote_soparts_incurred':
        return skipTable(context, QUOTE_INCURRED)
      case 'calcquote_hours':
        return skipTable(context, CALCQUOTE_HOURS)
      case 'calcquote_hours_incurred':
        return skipTable(context, CALCQUOTE)
      case 'calcquote_incurred':
        return skipTable(context, CALCQUOTE)
      case 'calcquote_parts':
        return skipTable(context, CALCQUOTE_PART)
      case 'calcquote_parts_incurred':
        return skipTable(context, CALCQUOTE)
      case 'calcquote_report':
        return skipTable(context, CALCQUOTE_REPORT)
      case 'calcquote_soparts':
        return skipTable(context, CALCQUOTE_SPECIAL)
      case 'calcquote_soparts_incurred':
        return skipTable(context, CALCQUOTE)
      default:
        throw new Error(`${GROUP}: no mapping for table ${context.table}`)
    }
  },

  unmapped: {
    'standalone_quote_parts.entered_price':
      'the operator raw entry; `price` is the allocated value the quote total uses',
    'standalone_quote_soparts.entered_price': 'the operator raw entry; `price` is the total basis',
    'customer_quote.tax_amount':
      'no total column on the header: the value is kept as quotes.manual_tax_amount and the recomputed tax is compared against it',
    'customer_quote_payterms.*': PAYTERMS,
    'quote_hours.*': QUOTE_WORKSHEET_HOURS,
    'quote_hours_incurred.*': QUOTE_INCURRED,
    'quote_parts.*': QUOTE_WORKSHEET_PART,
    'quote_parts_incurred.*': QUOTE_INCURRED,
    'quote_report.*': QUOTE_WORKSHEET,
    'quote_soparts.*': QUOTE_WORKSHEET_SPECIAL,
    'quote_soparts_incurred.*': QUOTE_INCURRED,
    'calcquote_hours.*': CALCQUOTE_HOURS,
    'calcquote_hours_incurred.*': CALCQUOTE,
    'calcquote_incurred.*': CALCQUOTE,
    'calcquote_parts.*': CALCQUOTE_PART,
    'calcquote_parts_incurred.*': CALCQUOTE,
    'calcquote_report.*': CALCQUOTE_REPORT,
    'calcquote_soparts.*': CALCQUOTE_SPECIAL,
    'calcquote_soparts_incurred.*': CALCQUOTE,
  },

  parity: [
    {
      group: GROUP,
      label: 'quote headers (customer + standalone)',
      oldSql:
        'select (select count(*) from migration."stg_customer_quote") + (select count(*) from migration."stg_standalone_quote") as rows',
      newSql: `select count(*)::int as rows
from app.quotes q
join migration.row_map r
  on r.entity = 'quote' and r.target_table = 'quotes' and r.target_key = q.id::text`,
    },
    {
      group: GROUP,
      label: 'quote parts lines',
      oldSql:
        'select (select count(*) from migration."stg_customer_quote_parts") + (select count(*) from migration."stg_standalone_quote_parts") as rows',
      newSql: 'select count(*)::int as rows from app.quote_parts',
    },
    {
      group: GROUP,
      label: 'quote labour hours',
      oldSql:
        'select ((select coalesce(sum(nullif(hours, \'\')::numeric), 0) from migration."stg_customer_quote_hours") + (select coalesce(sum(nullif(hours, \'\')::numeric), 0) from migration."stg_standalone_quote_hours"))::numeric(14, 2) as hours',
      newSql: 'select coalesce(sum(hours), 0)::numeric(14, 2) as hours from app.quote_hours',
    },
  ],
}
