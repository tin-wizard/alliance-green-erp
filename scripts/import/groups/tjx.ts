/**
 * Group 11 — TJX (plan §2.5 step 11).
 *
 * The TJX program is a quote → field-progress → subcontractor-invoice flow. The
 * forward model stores what the legacy panel derived from hidden form fields:
 * two total triplets (with and without markup), an explicit work-order link, and
 * a JSON snapshot per save.
 *
 * What is mapped, and why the rest is not:
 *
 *  - `tjx_quote` → `app.tjx_quotes` plus the primary work-order link in
 *    `app.tjx_quote_work_orders` (`workordernumber` is the legacy one-to-one link).
 *  - `tjx_quote_revisions` → `app.tjx_quote_revisions`. The legacy JSON blobs are
 *    the only surviving record of which rooms, fixtures and parts a historical
 *    save contained, so they are stored verbatim in jsonb.
 *  - `tjx_sub_invoice` → `app.tjx_sub_invoices`; the subcontractor comes from the
 *    work order, because the legacy header does not name one and inventing a
 *    vendor would be worse than reporting a missing parent.
 *  - `tjx_subcontractor_rates` and `tjx_fixture_parts` have exact targets; both
 *    need a master row (`tjx_fixture`) that the manifest does not carry, so a row
 *    whose master is absent is reported as an orphan line instead of creating a
 *    fixture with an invented name.
 *  - `tjx_room`, `tjx_fixture` and `tjx_rooms_template` are the catalogue the
 *    quotes copy from; `tjx_quote_fixtures` becomes a per-quote room row (named
 *    from the room master) plus the fixture quantity row, and the quote's own
 *    lines land in `app.tjx_quote_parts` / `_special_parts` / `_prices`.
 *  - `tjx_fixture_per_quote` and `tjx_fixture_parts_per_quote` are the panel's flat
 *    per-quote copy of that catalogue. The rooms plus the revision JSON already
 *    carry the same facts, so loading the flat copy would duplicate them; they are
 *    reported once each.
 *
 * The tax rate column stores a fraction (`0.13`), which is what the target
 * checks (`0..1`); anything else becomes NULL and is listed, never divided by a
 * hundred on a hunch.
 */
import { eq, sql } from 'drizzle-orm'
import type { Tx } from '@cls/db'
import {
  sites,
  subcontractors,
  tjxFixtureParts,
  tjxFixtures,
  tjxQuoteFixtures,
  tjxQuoteParts,
  tjxQuotePrices,
  tjxQuoteRevisions,
  tjxQuoteRooms,
  tjxQuotes,
  tjxQuoteSpecialParts,
  tjxQuoteWorkOrders,
  tjxRooms,
  tjxRoomTemplates,
  tjxRoomTemplateRooms,
  tjxSubInvoiceFixtures,
  tjxSubInvoiceRevisions,
  tjxSubInvoices,
  tjxSubcontractorRates,
  users,
  workOrderParts,
  workOrders,
  workOrderSpecialParts,
} from '@cls/db/schema'
import { stagingTable } from '../manifest'
import type { GroupTransformer, TransformContext, TransformHelpers } from '../types'
import { selectIdMemo } from '../exists-memo'

const GROUP = 'tjx'
const QUOTE_STATUSES = [1, 3, 4, 5] as const
const PAYMENT_TERMS = [1, 3, 4, 5] as const
const GRID_TYPES = [1, 2, 3, 4] as const
const PART_TYPES = ['Ballast', 'Lamp', ''] as const
const REVISION_TYPES = [
  'insert',
  'update',
  'submit',
  'approve',
  'cancel',
  'refresh_prices',
  'email',
  'import',
] as const
const SUB_INVOICE_REVISION_TYPES = [
  'insert',
  'update',
  'submit',
  'reject',
  'approve',
  'import',
] as const

/** The manifest entity name, used for row_map and exception rows. */
const ENTITIES: Record<string, string> = {
  tjx_quote: 'tjx_quote',
  tjx_quote_fixtures: 'tjx_quote_fixture',
  tjx_fixture_parts: 'tjx_fixture_part',
  tjx_quote_revisions: 'tjx_quote_revision',
  tjx_sub_invoice: 'tjx_sub_invoice',
  tjx_subcontractor_rates: 'tjx_subcontractor_rate',
  tjx_room: 'tjx_room',
  tjx_fixture: 'tjx_fixture',
  tjx_rooms_template: 'tjx_room_template',
  tjx_fixture_per_quote: 'tjx_fixture_per_quote',
  tjx_fixture_parts_per_quote: 'tjx_fixture_part_per_quote',
  tjx_quote_grid_types: 'tjx_quote_grid_type',
  tjx_quote_payterms: 'tjx_quote_payterm',
  tjx_prices_per_quote: 'tjx_quote_price',
  tjx_quote_parts: 'tjx_quote_part',
  tjx_quote_soparts: 'tjx_quote_special_part',
  tjx_quote_extra_workorders: 'tjx_quote_extra_work_order',
  tjx_quote_lastused_sharedpart: 'tjx_quote_last_used_shared_part',
  tjx_quote_downloads: 'tjx_quote_download',
  tjx_sub_invoice_fixtures: 'tjx_sub_invoice_fixture',
  tjx_sub_invoice_revisions: 'tjx_sub_invoice_revision',
  tjx_wo_parts: 'tjx_work_order_part',
  tjx_wo_soparts: 'tjx_work_order_special_part',
}

function entityFor(table: string): string {
  return ENTITIES[table] ?? table
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

function businessDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/* ------------------------------ parents ------------------------------ */

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

async function resolveSubcontractor(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('subcontractor', 'subcontractor', String(legacyId))
  const candidate = intOf(mapped) ?? legacyId
  const [row] = await selectIdMemo(tx, subcontractors.id, candidate)
  return row?.id ?? null
}

async function resolveWorkOrder(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<{ id: number; subcontractorId: number | null } | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('work_order', 'workorder', String(legacyId))
  const candidate = intOf(mapped) ?? legacyId
  const [row] = await tx
    .select({ id: workOrders.id, subcontractorId: workOrders.subcontractorId })
    .from(workOrders)
    .where(eq(workOrders.id, candidate))
    .limit(1)
  return row ?? null
}

async function resolveUser(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<string | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('user', 'users', String(legacyId))
  if (mapped !== null) {
    const [byId] = await selectIdMemo(tx, users.id, mapped)
    if (byId) return byId.id
  }
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.legacyId, legacyId))
    .limit(1)
  return row?.id ?? null
}

/** `app.tjx_fixtures.id` is a serial, so only the legacy-id column can answer. */
async function resolveFixture(tx: Tx, legacyId: number | null): Promise<number | null> {
  if (legacyId === null) return null
  const [row] = await tx
    .select({ id: tjxFixtures.id })
    .from(tjxFixtures)
    .where(eq(tjxFixtures.legacyId, legacyId))
    .limit(1)
  return row?.id ?? null
}

async function resolveQuote(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('tjx_quote', 'tjx_quote', String(legacyId))
  const candidate = intOf(mapped)
  if (candidate === null) return null
  const [row] = await selectIdMemo(tx, tjxQuotes.id, candidate)
  return row?.id ?? null
}

/* ----------------------------- tax rates ----------------------------- */

/**
 * The legacy quote stores its rate as a fraction (`appliedtaxrate = 0.13`), the
 * same shape the target checks. A value outside 0..1 is not a rate; it becomes
 * NULL and is reported rather than rescaled.
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

/** Money that is blank stays the column default and is listed, never invented. */
async function moneyOrDefault(
  context: TransformContext,
  column: string,
  fallback: string,
): Promise<string> {
  const value = context.helpers.money(column)
  if (value !== null) return value
  // Blank and unparseable both arrive here with a null. `helpers.money` already
  // reports an unparseable value through the runner; a blank is reported here
  // because the target column is NOT NULL and cannot hold the missing fact.
  if (context.helpers.text(column) === null) {
    await context.helpers.exception({
      exceptionClass: 'blank_money',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: `stored ${fallback}: the column is NOT NULL and the source value is blank`,
      notes: `${column} = ${JSON.stringify(context.row[column])}`,
    })
  }
  return fallback
}

/* ------------------------------- quotes ------------------------------ */

async function transformQuote(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const status = helpers.int('status')
  if (status === null || !(QUOTE_STATUSES as readonly number[]).includes(status)) {
    // NOT NULL with a check list: there is no honest NULL and no neighbouring
    // label to fall back on, so the quote is reported and left out.
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity,
      sourceKey,
      action: 'quote not inserted: status is NOT NULL and outside 1/3/4/5',
      notes: `status = ${JSON.stringify(row.status)}`,
    })
    return
  }

  const siteId = await resolveSite(tx, helpers, helpers.int('site'))
  const [site] = siteId === null
    ? []
    : await tx
        .select({ customerId: sites.customerId })
        .from(sites)
        .where(eq(sites.id, siteId))
        .limit(1)

  const paymentTerms = helpers.int('payment_terms')
  if (paymentTerms !== null && !(PAYMENT_TERMS as readonly number[]).includes(paymentTerms)) {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity,
      sourceKey,
      action: 'payment_terms_code stored NULL: the code is outside 1/3/4/5',
      notes: `payment_terms = ${paymentTerms}`,
    })
  }
  const grid = helpers.int('ceiling_grid_type')
  if (grid !== null && !(GRID_TYPES as readonly number[]).includes(grid)) {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity,
      sourceKey,
      action: 'ceiling_grid_type stored NULL: the code is outside 1-4',
      notes: `ceiling_grid_type = ${grid}`,
    })
  }

  const createdAt = helpers.timestamp('date_created')
  const quoteType = helpers.text('quote_type')

  const [inserted] = await tx
    .insert(tjxQuotes)
    .values({
      legacyId: helpers.int('id'),
      siteId,
      customerId: site?.customerId ?? null,
      status,
      ...(quoteType === null ? {} : { quoteType }),
      ceilingGridType:
        grid !== null && (GRID_TYPES as readonly number[]).includes(grid) ? grid : null,
      isTypeMaintenance: helpers.flag('is_type_maintenance') === 1,
      paymentTermsCode:
        paymentTerms !== null && (PAYMENT_TERMS as readonly number[]).includes(paymentTerms)
          ? paymentTerms
          : null,
      dueDate: helpers.date('due_date'),
      shipToType: helpers.text('ship_to_type'),
      shipContactName: helpers.text('ship_address_contactname'),
      shipCompany: helpers.text('ship_address_company'),
      shipStreet1: helpers.text('ship_address_street1'),
      shipStreet2: helpers.text('ship_address_street2'),
      shipCity: helpers.text('ship_address_city'),
      shipProvince: helpers.text('ship_address_province'),
      shipPostalCode: helpers.text('ship_address_postalcode'),
      shipPhone: helpers.text('ship_address_phone'),
      shippingAddress: helpers.text('shipping_address'),
      taxCode: helpers.text('tax_code'),
      appliedTaxRate: await appliedRate(context),
      subtotalAmount: await moneyOrDefault(context, 'subtotal_amount', '0'),
      taxAmount: await moneyOrDefault(context, 'tax_amount', '0'),
      totalAmount: await moneyOrDefault(context, 'total_amount', '0'),
      withoutMarkupSubtotalAmount: await moneyOrDefault(context, 'withoutmarkup_subtotal_amount', '0'),
      withoutMarkupTaxAmount: await moneyOrDefault(context, 'withoutmarkup_tax_amount', '0'),
      withoutMarkupTotalAmount: await moneyOrDefault(context, 'withoutmarkup_total_amount', '0'),
      notes: helpers.text('notes'),
      pdfNotes: helpers.text('pdf_notes'),
      revisionNotes: helpers.text('revision_notes'),
      revisionNo: helpers.int('revision_no') ?? 0,
      createdBy: await resolveUser(tx, helpers, helpers.int('createdby')),
      importedAt: new Date(),
      ...(createdAt === null ? {} : { createdAt: instantOf(createdAt) }),
    })
    .returning({ id: tjxQuotes.id })

  const quoteId = inserted!.id
  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'tjx_quotes',
    targetKey: String(quoteId),
  })

  // The legacy quote names one work order. The link is its own table now, and a
  // missing work order is reported rather than linked to a made-up one.
  const workOrder = await resolveWorkOrder(tx, helpers, helpers.int('workordernumber'))
  if (workOrder === null) {
    if (helpers.text('workordernumber') !== null) {
      await helpers.exception({
        exceptionClass: 'orphan_line',
        entity,
        sourceKey,
        action: 'quote imported, primary work-order link not created: the work order does not exist',
        notes: `workordernumber = ${JSON.stringify(row.workordernumber)}`,
      })
    }
    return
  }

  await tx
    .insert(tjxQuoteWorkOrders)
    .values({ quoteId, workOrderId: workOrder.id, isPrimary: true, sortOrder: 0 })
    .onConflictDoNothing({ target: [tjxQuoteWorkOrders.quoteId, tjxQuoteWorkOrders.workOrderId] })
}

/* ------------------------------ revisions ---------------------------- */

/** Legacy blobs are stored as JSON when they parse, and as evidence otherwise. */
function asObject(raw: string | null): Record<string, unknown> {
  if (raw === null) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return { value: parsed }
  } catch {
    return { raw }
  }
}

function asArray(raw: string | null): Record<string, unknown>[] {
  if (raw === null) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return parsed as Record<string, unknown>[]
    return [{ value: parsed }]
  } catch {
    return [{ raw }]
  }
}

async function transformRevision(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const quoteId = await resolveQuote(tx, helpers, helpers.int('quoteid'))
  if (quoteId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'revision not inserted: quote_id is NOT NULL and the quote does not exist',
      notes: `quoteid = ${JSON.stringify(row.quoteid)}`,
    })
    return
  }

  const declared = helpers.enumOf('revision_type', REVISION_TYPES)
  if (declared === null && helpers.text('revision_type') !== null) {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity,
      sourceKey,
      action: "stored 'import': the legacy label is not one of the target's revision types",
      notes: `revision_type = ${JSON.stringify(row.revision_type)}`,
    })
  }

  const createdAt = helpers.timestamp('created_time')
  const [inserted] = await tx
    .insert(tjxQuoteRevisions)
    .values({
      quoteId,
      // The legacy revision id is unique and increases per quote, so it orders the
      // history the same way the panel showed it.
      saveSeq: helpers.int('revision_id') ?? 1,
      revisionType: declared ?? 'import',
      revisedBy: await resolveUser(tx, helpers, helpers.int('revised_by_user')),
      dataQuote: asObject(helpers.text('data_quote')),
      // The legacy revision has no rooms blob: rooms were part of the quote blob.
      dataRooms: [],
      dataFixtures: asArray(helpers.text('data_fixtures')),
      dataParts: asArray(helpers.text('data_parts')),
      dataSpecialParts: asArray(helpers.text('data_soparts')),
      ...(createdAt === null ? {} : { createdAt: instantOf(createdAt) }),
    })
    .returning({ id: tjxQuoteRevisions.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'tjx_quote_revisions',
    targetKey: String(inserted!.id),
  })
}

/* --------------------------- fixture parts --------------------------- */

async function transformFixturePart(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const fixtureId = await resolveFixture(tx, helpers.int('fixtureid'))
  if (fixtureId === null) {
    // `fixtureid` is NOT NULL. The master table (`tjx_fixture`) is not in the
    // manifest, so a fixture that the master import has not created yet is an
    // orphan line, not a fixture invented from a part number.
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'part not inserted: fixture_id is NOT NULL and app.tjx_fixtures has no row with that legacy id',
      notes: `fixtureid = ${JSON.stringify(row.fixtureid)}`,
    })
    return
  }

  const partNo = helpers.text('partno')
  if (partNo === null) {
    await helpers.exception({
      exceptionClass: 'unresolved_part_line',
      entity,
      sourceKey,
      action: 'part not inserted: part_no is NOT NULL',
      notes: `partno = ${JSON.stringify(row.partno)}`,
    })
    return
  }

  const declared = helpers.enumOf('parttype', PART_TYPES)
  if (declared === null && helpers.text('parttype') !== null) {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity,
      sourceKey,
      action: "stored '': part_type must be Ballast, Lamp or empty",
      notes: `parttype = ${JSON.stringify(row.parttype)}`,
    })
  }

  // Both factors are NOT NULL with a check. A blank keeps the column default and
  // a non-positive value cannot be stored, so it is reported and replaced by the
  // default rather than silently breaking the check.
  const markup = helpers.money('markup')
  const ratio = helpers.money('part_ratio_perfixture')
  if (markup === null || Number(markup) <= 0) {
    await helpers.exception({
      exceptionClass: markup === null ? 'blank_money' : 'unknown_enum',
      entity,
      sourceKey,
      action: 'markup stored 1 (the column default): the source value is blank or not positive',
      notes: `markup = ${JSON.stringify(row.markup)}`,
    })
  }
  if (ratio === null || Number(ratio) < 0) {
    await helpers.exception({
      exceptionClass: ratio === null ? 'blank_money' : 'unknown_enum',
      entity,
      sourceKey,
      action: 'ratio_per_fixture stored 1 (the column default): the source value is blank or negative',
      notes: `part_ratio_perfixture = ${JSON.stringify(row.part_ratio_perfixture)}`,
    })
  }

  const [inserted] = await tx
    .insert(tjxFixtureParts)
    .values({
      legacyId: helpers.int('id'),
      fixtureId,
      partNo,
      partType: declared ?? '',
      markup: markup !== null && Number(markup) > 0 ? markup : '1',
      ratioPerFixture: ratio !== null && Number(ratio) >= 0 ? ratio : '1',
    })
    .returning({ id: tjxFixtureParts.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'tjx_fixture_parts',
    targetKey: String(inserted!.id),
  })
}

/* ---------------------- subcontractor invoices ----------------------- */

async function transformSubInvoice(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const quoteId = await resolveQuote(tx, helpers, helpers.int('quoteid'))
  const workOrder = await resolveWorkOrder(tx, helpers, helpers.int('workordernumber'))
  const subcontractorId = workOrder?.subcontractorId ?? null

  if (quoteId === null || workOrder === null || subcontractorId === null) {
    // Three NOT NULL FKs and the legacy header names only two of the parents: the
    // subcontractor has to come from the work order, which is exactly why a
    // missing parent stops the row instead of being invented.
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action:
        'invoice not inserted: quote, work order and subcontractor are all NOT NULL and one does not resolve',
      notes: `quoteid = ${JSON.stringify(row.quoteid)}, workordernumber = ${JSON.stringify(row.workordernumber)}, work order subcontractor = ${JSON.stringify(subcontractorId)}`,
    })
    return
  }

  const createdAt = helpers.timestamp('date_created')
  let invoiceNumber = helpers.text('invoice_number')
  if (invoiceNumber === null) {
    // The document number is NOT NULL and unique. A draft that never got a number
    // still holds totals worth keeping, so it gets a deterministic legacy number
    // and the gap is listed (the same rule POs use for a missing number).
    invoiceNumber = `TJX-LEGACY-${sourceKey}`
    await helpers.exception({
      exceptionClass: 'missing_po_number',
      entity,
      sourceKey,
      action: `migrated with the generated number ${invoiceNumber} so the series stays unique`,
      notes: `invoice_number = ${JSON.stringify(row.invoice_number)}`,
    })
  }

  let invoiceDate = helpers.date('invoice_date')
  if (invoiceDate === null) {
    const fallback = createdAt === null ? null : businessDate(new Date(createdAt.replace(' ', 'T')))
    if (fallback !== null) {
      invoiceDate = fallback
      await helpers.exception({
        exceptionClass: 'zero_date',
        entity,
        sourceKey,
        action: 'invoice_date stored as the document creation date: the source has no usable date',
        notes: `invoice_date = ${JSON.stringify(row.invoice_date)}, date_created = ${JSON.stringify(row.date_created)}`,
      })
    } else {
      await helpers.exception({
        exceptionClass: 'zero_date',
        entity,
        sourceKey,
        action: 'invoice not inserted: invoice_date is NOT NULL and the source has neither a date nor a creation stamp',
        notes: `invoice_date = ${JSON.stringify(row.invoice_date)}`,
      })
      return
    }
  }

  const [inserted] = await tx
    .insert(tjxSubInvoices)
    .values({
      legacyId: helpers.int('id'),
      quoteId,
      workOrderId: workOrder.id,
      subcontractorId,
      invoiceNumber,
      invoiceDate,
      taxCode: helpers.text('tax_code'),
      appliedTaxRate: await appliedRate(context),
      subtotalAmount: await moneyOrDefault(context, 'subtotal_amount', '0'),
      taxAmount: await moneyOrDefault(context, 'tax_amount', '0'),
      taxGst: await moneyOrDefault(context, 'tax_gst', '0'),
      taxPst: await moneyOrDefault(context, 'tax_pst', '0'),
      totalAmount: await moneyOrDefault(context, 'total_amount', '0'),
      notes: helpers.text('notes'),
      subNotes: helpers.text('sub_notes'),
      chkProjectReading: helpers.flag('chk_project_reading') === 1,
      chkProjectPhotos: helpers.flag('chk_project_photos') === 1,
      chkProjectSignoff: helpers.flag('chk_project_signoff') === 1,
      isSubmitted: helpers.flag('is_submitted') === 1,
      rejectedCount: helpers.int('rejected_count') ?? 0,
      createdBy: await resolveUser(tx, helpers, helpers.int('createdby')),
      importedAt: new Date(),
      ...(createdAt === null ? {} : { createdAt: instantOf(createdAt) }),
    })
    .returning({ id: tjxSubInvoices.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'tjx_sub_invoices',
    targetKey: String(inserted!.id),
  })
}

/* ------------------------ subcontractor rates ------------------------ */

async function transformSubcontractorRate(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const subcontractorId = await resolveSubcontractor(tx, helpers, helpers.int('subid'))
  if (subcontractorId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'rate not inserted: subcontractor_id is NOT NULL and subid does not resolve',
      notes: `subid = ${JSON.stringify(row.subid)}`,
    })
    return
  }

  const partNo = helpers.text('partno')
  if (partNo === null) {
    await helpers.exception({
      exceptionClass: 'unresolved_part_line',
      entity,
      sourceKey,
      action: 'rate not inserted: part_no is NOT NULL',
      notes: `partno = ${JSON.stringify(row.partno)}`,
    })
    return
  }

  const cost = helpers.money('installcostperunit')
  if (cost === null) {
    await helpers.exception({
      exceptionClass: 'blank_money',
      entity,
      sourceKey,
      action: 'install_cost_per_unit stored 0: the column is NOT NULL and the source value is blank',
      notes: `installcostperunit = ${JSON.stringify(row.installcostperunit)}`,
    })
  }

  const [inserted] = await tx
    .insert(tjxSubcontractorRates)
    .values({
      legacyId: helpers.int('id'),
      subcontractorId,
      partNo,
      installCostPerUnit: cost ?? '0',
    })
    .returning({ id: tjxSubcontractorRates.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'tjx_subcontractor_rates',
    targetKey: String(inserted!.id),
  })
}

/* --------------------------- room and fixture masters ------------------ */

/**
 * Room and fixture masters are the catalogue every quote copies from. They are
 * migrated here so a historical quote can resolve its room and fixture names;
 * `legacyId` is what the per-quote rows join on.
 */
async function transformRoom(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const name = helpers.text('roomname')
  if (name === null) {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity,
      sourceKey,
      action: 'room not inserted: name is NOT NULL',
      notes: `roomname = ${JSON.stringify(row.roomname)}`,
    })
    return
  }

  // Room names are unique ignoring case. Two legacy rooms with one name (2026-11
  // dump: "Utility Rooms", ids 18 and 27) are one room here: the second is mapped
  // onto the first, so quotes that used either still find their room.
  const legacyId = helpers.int('id')
  const [sameName] = await tx
    .select({ id: tjxRooms.id, legacyId: tjxRooms.legacyId })
    .from(tjxRooms)
    .where(sql`lower(${tjxRooms.name}) = lower(${name})`)
    .limit(1)
  if (sameName && sameName.legacyId !== legacyId) {
    await helpers.exception({
      exceptionClass: 'duplicate_master_name',
      entity,
      sourceKey,
      action: `mapped onto the existing room ${sameName.id} (legacy id ${sameName.legacyId}) instead of creating a second room with the same name`,
      notes: `roomname = ${JSON.stringify(row.roomname)}`,
    })
    await helpers.remember({
      entity,
      sourceTable: context.table,
      sourceKey,
      targetTable: 'tjx_rooms',
      targetKey: String(sameName.id),
    })
    return
  }

  const [inserted] = await tx
    .insert(tjxRooms)
    .values({ legacyId, name, sortOrder: helpers.int('sortorder') ?? 0 })
    .returning({ id: tjxRooms.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'tjx_rooms',
    targetKey: String(inserted!.id),
  })
}

async function transformFixtureMaster(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const name = helpers.text('fixturename')
  if (name === null) {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity,
      sourceKey,
      action: 'fixture not inserted: name is NOT NULL',
      notes: `fixturename = ${JSON.stringify(row.fixturename)}`,
    })
    return
  }

  const [inserted] = await tx
    .insert(tjxFixtures)
    .values({ legacyId: helpers.int('id'), name, sortOrder: helpers.int('sortorder') ?? 0 })
    .returning({ id: tjxFixtures.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'tjx_fixtures',
    targetKey: String(inserted!.id),
  })
}

/**
 * `tjx_rooms_template` has no header row: it is the list of rooms in the one
 * template the panel offered, so it becomes the app's single default template.
 */
async function transformRoomTemplate(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const [template] = await tx
    .insert(tjxRoomTemplates)
    // Not the default: the ERP already seeds one (only one default may exist), and a
    // template the migration invents must not take that role from the owner's choice.
    .values({ name: 'Legacy room template', isDefault: false })
    // The name's unique index is on lower(name), which ON CONFLICT (name) cannot name.
    .onConflictDoNothing()
    .returning({ id: tjxRoomTemplates.id })
  const templateId =
    template?.id ??
    (
      await tx
        .select({ id: tjxRoomTemplates.id })
        .from(tjxRoomTemplates)
        .where(sql`lower(${tjxRoomTemplates.name}) = lower('Legacy room template')`)
        .limit(1)
    )[0]?.id
  if (templateId === undefined) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'template entry skipped: the legacy room template could not be created or found',
      notes: `roomid = ${JSON.stringify(row.roomid)}`,
    })
    return
  }

  const roomId = await resolveRoom(tx, helpers, helpers.int('roomid'))
  if (roomId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'template entry skipped: the room does not exist',
      notes: `roomid = ${JSON.stringify(row.roomid)}`,
    })
    return
  }

  // A room can be listed twice and two entries can share a position; both are
  // unique in the target, so a repeat is skipped and recorded, never an error.
  const placed = await tx
    .insert(tjxRoomTemplateRooms)
    .values({ templateId, roomId, sortOrder: helpers.int('sortorder') ?? 0 })
    .onConflictDoNothing()
    .returning({ id: tjxRoomTemplateRooms.id })
  if (placed.length === 0) {
    await helpers.exception({
      exceptionClass: 'dated_duplicate_skipped',
      entity,
      sourceKey,
      action: 'template entry skipped: the room, or its position, is already in the template',
      notes: `roomid = ${JSON.stringify(row.roomid)}, sortorder = ${JSON.stringify(row.sortorder)}`,
    })
  }

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'tjx_room_template_rooms',
    targetKey: `${templateId}:${roomId}`,
  })
}

/**
 * A room resolves through the crosswalk first, because two legacy rooms can share
 * one name and the second is mapped onto the first; only then by legacy id.
 */
async function resolveRoom(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('tjx_room', 'tjx_room', String(legacyId))
  if (mapped !== null && Number.isFinite(Number(mapped))) return Number(mapped)
  const [row] = await tx
    .select({ id: tjxRooms.id })
    .from(tjxRooms)
    .where(eq(tjxRooms.legacyId, legacyId))
    .limit(1)
  return row?.id ?? null
}

async function resolveRoomName(tx: Tx, legacyId: number | null): Promise<string | null> {
  if (legacyId === null) return null
  const [row] = await tx
    .select({ name: tjxRooms.name })
    .from(tjxRooms)
    .where(eq(tjxRooms.legacyId, legacyId))
    .limit(1)
  return row?.name ?? null
}

async function resolveFixtureName(tx: Tx, legacyId: number | null): Promise<string | null> {
  if (legacyId === null) return null
  const [row] = await tx
    .select({ name: tjxFixtures.name })
    .from(tjxFixtures)
    .where(eq(tjxFixtures.legacyId, legacyId))
    .limit(1)
  return row?.name ?? null
}

/** Positional order inside a quote room or a subcontractor invoice. */
async function nextOrder(tx: Tx, table: 'quote_fixtures' | 'sub_invoice_fixtures', id: number) {
  const rows =
    table === 'quote_fixtures'
      ? await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(tjxQuoteFixtures)
          .where(eq(tjxQuoteFixtures.quoteRoomId, id))
      : await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(tjxSubInvoiceFixtures)
          .where(eq(tjxSubInvoiceFixtures.subInvoiceId, id))
  return Number(rows[0]?.count ?? 0)
}

/**
 * Per-quote rooms and their fixture quantities.
 *
 * The legacy row names a room *master* id; the forward model needs a per-quote
 * room row whose name comes from that master. Both targets are ordered by a
 * counter because the legacy `sortorder` is per row and would collide with the
 * unique order indexes.
 */
async function transformQuoteFixture(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const quoteId = await resolveQuote(tx, helpers, helpers.int('quoteid'))
  const roomId = helpers.int('roomid')
  const roomMasterId = await resolveRoom(tx, helpers, roomId)
  const fixtureMasterId = await resolveFixture(tx, helpers.int('fixtureid'))
  const fixtureName = await resolveFixtureName(tx, helpers.int('fixtureid'))
  const quantity = helpers.money('totalfixtures')

  if (quoteId === null || roomMasterId === null || quantity === null || Number(quantity) <= 0) {
    await helpers.exception({
      exceptionClass:
        quoteId === null || roomMasterId === null
          ? 'orphan_line'
          : quantity === null
            ? 'blank_money'
            : 'unknown_enum',
      entity,
      sourceKey,
      action:
        'row not inserted: quote, room and a positive fixture quantity are required (quote_room_id and quantity are NOT NULL)',
      notes: `quoteid = ${JSON.stringify(row.quoteid)}, roomid = ${JSON.stringify(row.roomid)}, totalfixtures = ${JSON.stringify(row.totalfixtures)}`,
    })
    return
  }

  const roomName = (await resolveRoomName(tx, roomId)) ?? ''
  const roomKey = `${helpers.int('quoteid')}:${roomId}`
  let quoteRoomId = intOf(await helpers.targetKey('quote_room', context.table, roomKey))
  if (quoteRoomId === null) {
    const [existing] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(tjxQuoteRooms)
      .where(eq(tjxQuoteRooms.quoteId, quoteId))
    const [room] = await tx
      .insert(tjxQuoteRooms)
      .values({
        quoteId,
        roomId: roomMasterId,
        roomName,
        sortOrder: Number(existing?.count ?? 0),
      })
      .returning({ id: tjxQuoteRooms.id })
    quoteRoomId = room!.id
    await helpers.remember({
      entity: 'quote_room',
      sourceTable: context.table,
      sourceKey: roomKey,
      targetTable: 'tjx_quote_rooms',
      targetKey: String(quoteRoomId),
    })
  }

  const sortOrder = await nextOrder(tx, 'quote_fixtures', quoteRoomId)
  const [inserted] = await tx
    .insert(tjxQuoteFixtures)
    .values({
      quoteId,
      quoteRoomId,
      fixtureId: fixtureMasterId,
      fixtureName: fixtureName ?? '',
      quantity,
      sortOrder,
    })
    .returning({ id: tjxQuoteFixtures.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'tjx_quote_fixtures',
    targetKey: String(inserted!.id),
  })
}

/* ------------------------------ quote lines -------------------------- */

/** `qty * price` in cents, the same two-decimal rule the panel used. */
function product(qty: string | null, price: string | null): string | null {
  if (qty === null || price === null) return null
  const cents = Math.round(Number(qty) * 100) * Math.round(Number(price) * 100)
  if (!Number.isFinite(cents)) return null
  return (cents / 10_000).toFixed(2)
}

async function transformQuotePrice(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const quoteId = await resolveQuote(tx, helpers, helpers.int('quoteid'))
  const partNo = helpers.text('partno')
  const price = helpers.money('price')
  if (quoteId === null || partNo === null || price === null) {
    await helpers.exception({
      exceptionClass: quoteId === null || partNo === null ? 'orphan_line' : 'blank_money',
      entity,
      sourceKey,
      action: 'price row not inserted: quote, part number and a parsed price are required',
      notes: `quoteid = ${JSON.stringify(row.quoteid)}, partno = ${JSON.stringify(row.partno)}, price = ${JSON.stringify(row.price)}`,
    })
    return
  }

  const [inserted] = await tx
    .insert(tjxQuotePrices)
    .values({
      quoteId,
      partNo,
      price,
      previousPrice: helpers.money('last_price'),
      source: 'imported',
    })
    .returning({ id: tjxQuotePrices.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'tjx_quote_prices',
    targetKey: String(inserted!.id),
  })
}

async function transformQuotePart(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const quoteId = await resolveQuote(tx, helpers, helpers.int('quoteid'))
  const partNo = helpers.text('partno')
  const price = helpers.money('price')
  const qtyWithMarkup = helpers.money('qty')
  const qtyWithoutMarkup = helpers.money('without_markup_qty') ?? qtyWithMarkup
  if (quoteId === null || partNo === null || price === null || qtyWithMarkup === null) {
    await helpers.exception({
      exceptionClass: quoteId === null || partNo === null ? 'orphan_line' : 'blank_money',
      entity,
      sourceKey,
      action: 'quote part not inserted: quote, part number, quantity and price are NOT NULL',
      notes: `quoteid = ${JSON.stringify(row.quoteid)}, partno = ${JSON.stringify(row.partno)}, qty = ${JSON.stringify(row.qty)}, price = ${JSON.stringify(row.price)}`,
    })
    return
  }

  const [inserted] = await tx
    .insert(tjxQuoteParts)
    .values({
      quoteId,
      partNo,
      qtyWithMarkup,
      qtyWithoutMarkup: qtyWithoutMarkup ?? qtyWithMarkup,
      unitPrice: price,
      lineSubtotal: product(qtyWithMarkup, price) ?? '0',
      lineSubtotalWithoutMarkup: product(qtyWithoutMarkup, price) ?? '0',
      sortOrder: helpers.int('sortorder') ?? 0,
      origin: 'legacy',
    })
    .returning({ id: tjxQuoteParts.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'tjx_quote_parts',
    targetKey: String(inserted!.id),
  })
}

async function transformQuoteSpecialPart(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const quoteId = await resolveQuote(tx, helpers, helpers.int('quoteid'))
  const name = helpers.text('name')
  const quantity = helpers.money('qty')
  const price = helpers.money('price')
  if (quoteId === null || name === null || quantity === null || price === null) {
    await helpers.exception({
      exceptionClass: quoteId === null || name === null ? 'orphan_line' : 'blank_money',
      entity,
      sourceKey,
      action: 'special part not inserted: quote, name, quantity and price are NOT NULL',
      notes: `quoteid = ${JSON.stringify(row.quoteid)}, name = ${JSON.stringify(row.name)}, qty = ${JSON.stringify(row.qty)}, price = ${JSON.stringify(row.price)}`,
    })
    return
  }

  const [inserted] = await tx
    .insert(tjxQuoteSpecialParts)
    .values({
      quoteId,
      name,
      quantity,
      unitPrice: price,
      lineSubtotal: product(quantity, price) ?? '0',
      sortOrder: helpers.int('sortorder') ?? 0,
    })
    .returning({ id: tjxQuoteSpecialParts.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'tjx_quote_special_parts',
    targetKey: String(inserted!.id),
  })
}

/** Additional work orders beyond the quote's primary one. */
async function transformExtraWorkOrder(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const quoteId = await resolveQuote(tx, helpers, helpers.int('quoteid'))
  const workOrder = await resolveWorkOrder(tx, helpers, helpers.int('woid'))
  if (quoteId === null || workOrder === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'link not created: quote and work order must both exist (work_order_id is NOT NULL)',
      notes: `quoteid = ${JSON.stringify(row.quoteid)}, woid = ${JSON.stringify(row.woid)}`,
    })
    return
  }

  const [inserted] = await tx
    .insert(tjxQuoteWorkOrders)
    .values({
      quoteId,
      workOrderId: workOrder.id,
      isPrimary: false,
      sortOrder: helpers.int('sortorder') ?? 0,
    })
    .onConflictDoNothing({ target: [tjxQuoteWorkOrders.quoteId, tjxQuoteWorkOrders.workOrderId] })
    .returning({ id: tjxQuoteWorkOrders.id })

  const linkId =
    inserted?.id ??
    (
      await tx
        .select({ id: tjxQuoteWorkOrders.id })
        .from(tjxQuoteWorkOrders)
        .where(
          sql`${tjxQuoteWorkOrders.quoteId} = ${quoteId} and ${tjxQuoteWorkOrders.workOrderId} = ${workOrder.id}`,
        )
        .limit(1)
    )[0]?.id
  if (linkId === undefined) return

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'tjx_quote_work_orders',
    targetKey: String(linkId),
  })
}

/* ------------------------ subcontractor invoice detail ---------------- */

async function resolveSubInvoice(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('tjx_sub_invoice', 'tjx_sub_invoice', String(legacyId))
  const candidate = intOf(mapped)
  if (candidate === null) return null
  const [row] = await selectIdMemo(tx, tjxSubInvoices.id, candidate)
  return row?.id ?? null
}

async function transformSubInvoiceFixture(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const subInvoiceId = await resolveSubInvoice(tx, helpers, helpers.int('invoiceid'))
  if (subInvoiceId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'fixture line not inserted: sub_invoice_id is NOT NULL and the invoice does not exist',
      notes: `invoiceid = ${JSON.stringify(row.invoiceid)}`,
    })
    return
  }

  const roomName =
    helpers.text('otherroom') ?? (await resolveRoomName(tx, helpers.int('roomid'))) ?? ''
  const fixtureName = (await resolveFixtureName(tx, helpers.int('fixtureid'))) ?? ''
  const quotedQuantity = helpers.money('totalfixtures') ?? '0'
  const installedQuantity = helpers.money('installedqty_totalfixtures') ?? '0'
  const quoteFixtureLegacyId = helpers.int('tjx_quote_fixture_rowid')
  const quoteFixtureId =
    quoteFixtureLegacyId === null
      ? null
      : intOf(
          await helpers.targetKey(
            'tjx_quote_fixture',
            'tjx_quote_fixtures',
            String(quoteFixtureLegacyId),
          ),
        )

  const [inserted] = await tx
    .insert(tjxSubInvoiceFixtures)
    .values({
      subInvoiceId,
      quoteFixtureId,
      roomName,
      fixtureName,
      quotedQuantity,
      installedQuantity,
      discrepancyNotes: helpers.text('discrepancy_notes'),
      sortOrder: await nextOrder(tx, 'sub_invoice_fixtures', subInvoiceId),
    })
    .returning({ id: tjxSubInvoiceFixtures.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'tjx_sub_invoice_fixtures',
    targetKey: String(inserted!.id),
  })
}

async function transformSubInvoiceRevision(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const subInvoiceId = await resolveSubInvoice(tx, helpers, helpers.int('invoiceid'))
  if (subInvoiceId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'revision not inserted: sub_invoice_id is NOT NULL and the invoice does not exist',
      notes: `invoiceid = ${JSON.stringify(row.invoiceid)}`,
    })
    return
  }

  const declared = helpers.enumOf('revision_type', SUB_INVOICE_REVISION_TYPES)
  if (declared === null && helpers.text('revision_type') !== null) {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity,
      sourceKey,
      action: "stored 'import': the legacy label is not one of the target's revision types",
      notes: `revision_type = ${JSON.stringify(row.revision_type)}`,
    })
  }

  const createdAt = instantOf(helpers.timestamp('created_time'))
  const [inserted] = await tx
    .insert(tjxSubInvoiceRevisions)
    .values({
      subInvoiceId,
      // The legacy revision id increases over time, so it orders the history even
      // though it is not a per-invoice sequence.
      revisionNo: helpers.int('revision_id') ?? 0,
      revisionType: declared ?? 'import',
      revisedBy: await resolveUser(tx, helpers, helpers.int('revised_by_user')),
      dataInvoice: asObject(helpers.text('data_invoice')),
      dataFixtures: asArray(helpers.text('data_fixtures')),
      dataParts: asArray(helpers.text('data_parts')),
      ...(createdAt === undefined ? {} : { createdAt }),
    })
    .returning({ id: tjxSubInvoiceRevisions.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'tjx_sub_invoice_revisions',
    targetKey: String(inserted!.id),
  })
}

/* ------------------------- work-order lines -------------------------- */

/**
 * `tjx_wo_parts` / `tjx_wo_soparts` are the TJX panel's copy of work-order
 * lines. The forward model has no TJX work-order part table on purpose: the lines
 * belong to the work order, so they land in the Work Orders tables.
 */
async function transformWorkOrderPart(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const workOrder = await resolveWorkOrder(tx, helpers, helpers.int('woid'))
  const partNo = helpers.text('partno')
  const qty = helpers.money('qty')
  const price = helpers.money('price')
  if (workOrder === null || partNo === null || qty === null || price === null) {
    await helpers.exception({
      exceptionClass: workOrder === null || partNo === null ? 'orphan_line' : 'blank_money',
      entity,
      sourceKey,
      action: 'line not inserted: work order, part number, quantity and price are NOT NULL',
      notes: `woid = ${JSON.stringify(row.woid)}, partno = ${JSON.stringify(row.partno)}, qty = ${JSON.stringify(row.qty)}, price = ${JSON.stringify(row.price)}`,
    })
    return
  }

  const [inserted] = await tx
    .insert(workOrderParts)
    .values({ workOrderId: workOrder.id, partNo, qty, price })
    .returning({ id: workOrderParts.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'work_order_parts',
    targetKey: String(inserted!.id),
  })
}

async function transformWorkOrderSpecialPart(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const workOrder = await resolveWorkOrder(tx, helpers, helpers.int('woid'))
  const name = helpers.text('name')
  const qty = helpers.money('qty')
  const price = helpers.money('price')
  if (workOrder === null || name === null || qty === null || price === null) {
    await helpers.exception({
      exceptionClass: workOrder === null || name === null ? 'orphan_line' : 'blank_money',
      entity,
      sourceKey,
      action: 'line not inserted: work order, name, quantity and price are NOT NULL',
      notes: `woid = ${JSON.stringify(row.woid)}, name = ${JSON.stringify(row.name)}, qty = ${JSON.stringify(row.qty)}, price = ${JSON.stringify(row.price)}`,
    })
    return
  }

  const [inserted] = await tx
    .insert(workOrderSpecialParts)
    .values({ workOrderId: workOrder.id, name, qty, price })
    .returning({ id: workOrderSpecialParts.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'work_order_special_parts',
    targetKey: String(inserted!.id),
  })
}

/* ---------------------------- not migrated --------------------------- */

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
    action: 'not migrated: no target row can exist without an invented parent',
    notes: reason,
  })
}

/* ------------------------------ transformer --------------------------- */

export const transformer: GroupTransformer = {
  group: GROUP,

  async transform(context) {
    switch (context.table) {
      case 'tjx_quote':
        return transformQuote(context)
      case 'tjx_quote_revisions':
        return transformRevision(context)
      case 'tjx_quote_fixtures':
        return transformQuoteFixture(context)
      case 'tjx_fixture_parts':
        return transformFixturePart(context)
      case 'tjx_sub_invoice':
        return transformSubInvoice(context)
      case 'tjx_subcontractor_rates':
        return transformSubcontractorRate(context)
      case 'tjx_room':
        return transformRoom(context)
      case 'tjx_fixture':
        return transformFixtureMaster(context)
      case 'tjx_rooms_template':
        return transformRoomTemplate(context)
      case 'tjx_prices_per_quote':
        return transformQuotePrice(context)
      case 'tjx_quote_parts':
        return transformQuotePart(context)
      case 'tjx_quote_soparts':
        return transformQuoteSpecialPart(context)
      case 'tjx_quote_extra_workorders':
        return transformExtraWorkOrder(context)
      case 'tjx_sub_invoice_fixtures':
        return transformSubInvoiceFixture(context)
      case 'tjx_sub_invoice_revisions':
        return transformSubInvoiceRevision(context)
      case 'tjx_wo_parts':
        return transformWorkOrderPart(context)
      case 'tjx_wo_soparts':
        return transformWorkOrderSpecialPart(context)
      case 'tjx_fixture_per_quote':
        return recordNotMigrated(
          context,
          'flat per-quote fixture copy; the rooms and quantities are rebuilt from tjx_quote_fixtures and every save is in the tjx_quote_revisions JSON, so a flat copy would duplicate them',
        )
      case 'tjx_fixture_parts_per_quote':
        return recordNotMigrated(
          context,
          'per-quote fixture-part override; it hangs off the flat per-quote fixture rows that are not migrated, and the same override is inside the tjx_quote_revisions JSON',
        )
      case 'tjx_quote_grid_types':
        return recordNotMigrated(
          context,
          'lookup labels for ceiling grid codes 1-4; the quote stores the raw code and the module owns the labels, so there is no lookup table to load',
        )
      case 'tjx_quote_payterms':
        return recordNotMigrated(
          context,
          'lookup labels for payment-term codes 1/3/4/5; the quote stores the raw code and the module owns the labels',
        )
      case 'tjx_quote_lastused_sharedpart':
        return recordNotMigrated(
          context,
          'editor convenience cache of the last shared part used on a quote; it is not a business record and rebuilding it would invent history',
        )
      case 'tjx_quote_downloads':
        return recordNotMigrated(
          context,
          'file-server paths of exported quote PDFs; there is no hash or size to write into app.generated_documents, so the files are re-exported on demand',
        )
      default:
        throw new Error(`${GROUP}: no mapping for table ${context.table}`)
    }
  },

  unmapped: {
    'tjx_quote.is_submitted':
      'a flag with no target boolean: app.tjx_quotes.submitted_at is a timestamp and the legacy row records no submission time',
    'tjx_quote.tjxquote_folder_attach_path':
      'path on the old file server; documents are re-uploaded, not linked',
    'tjx_quote_fixtures.sortorder':
      'legacy per-row order; the target orders fixture rows inside a quote room with a counter because its unique index would reject duplicate values',
    'tjx_quote_parts.fixtured_partno':
      'the fixture part a quote part was derived from; app.tjx_quote_parts has no link column and the part number is what invoices use',
    'tjx_fixture_per_quote.*':
      'flat per-quote fixture copy; see the table-level not_migrated exception',
    'tjx_fixture_parts_per_quote.*':
      'per-quote fixture-part override; see the table-level not_migrated exception',
    'tjx_quote_grid_types.*': 'lookup labels; see the table-level not_migrated exception',
    'tjx_quote_payterms.*': 'lookup labels; see the table-level not_migrated exception',
    'tjx_quote_lastused_sharedpart.*':
      'editor cache; see the table-level not_migrated exception',
    'tjx_quote_downloads.*':
      'file-server paths with no hash or size; see the table-level not_migrated exception',
    'tjx_sub_invoice.tax_total':
      'the combined tax total; tax_gst, tax_pst and tax_amount carry the breakdown, a fourth total would be a duplicate',
    'tjx_sub_invoice.id': 'the legacy row id becomes legacy_id on app.tjx_sub_invoices',
    'tjx_sub_invoice_fixtures.roomid':
      'resolved through the room master to a display name; app.tjx_sub_invoice_fixtures stores the name, not a room FK',
    'tjx_sub_invoice_fixtures.fixtureid':
      'resolved through the fixture master to a display name; the target stores the name',
    'tjx_sub_invoice_fixtures.quoted_roomid': 'no target column; the quote fixture link carries the quoted side',
    'tjx_sub_invoice_fixtures.quoted_fixtureid': 'no target column; the quote fixture link carries the quoted side',
    'tjx_sub_invoice_fixtures.woid': 'no target column; the invoice itself is already linked to the work order',
    'tjx_sub_invoice_revisions.workordernumber':
      'no target column; the revision belongs to the invoice, which already names the work order',
    'tjx_sub_invoice_revisions.data_soparts':
      'no target column on app.tjx_sub_invoice_revisions; special-part lines live on the invoice itself',
    'tjx_wo_parts.partno_used_infixutre':
      'the fixture part the line came from; app.work_order_parts has no link column',
    'tjx_wo_parts.sortorder': 'no target column; the legacy id order is preserved',
    'tjx_wo_soparts.sortorder': 'no target column; the legacy id order is preserved',
  },

  parity: [
    {
      group: GROUP,
      label: 'quotes: row count',
      // The legacy `tjx_quote.status` vocabulary is 1/3/4/5; the app state
      // machine has the same four codes. A row with status 2 cannot be stored
      // (status is NOT NULL with a check) and is recorded as unknown_enum.
      oldSql: `select count(*)::int as rows from migration."stg_tjx_quote"
where (case when status ~ '^[0-9]+$' then status::int end) in (1, 3, 4, 5)`,
      newSql: `select count(*)::int as rows
from app.tjx_quotes q
join migration.row_map r
  on r.entity = 'tjx_quote' and r.target_table = 'tjx_quotes' and r.target_key = q.id::text`,
    },
    {
      group: GROUP,
      label: 'quotes: posted total amount',
      oldSql: `select coalesce(sum(nullif(regexp_replace(total_amount, '[^0-9.-]', '', 'g'), '')::numeric), 0) as total
from migration."stg_tjx_quote"
where (case when status ~ '^[0-9]+$' then status::int end) in (1, 3, 4, 5)`,
      newSql: `select coalesce(sum(q.total_amount), 0)::numeric as total
from app.tjx_quotes q
join migration.row_map r
  on r.entity = 'tjx_quote' and r.target_table = 'tjx_quotes' and r.target_key = q.id::text`,
    },
    {
      group: GROUP,
      label: 'quotes: count grouped by a status bucket (approved = 4)',
      oldSql: 'select count(*)::int as rows from migration."stg_tjx_quote" where status::int = 4',
      newSql: 'select count(*)::int as rows from app.tjx_quotes where status = 4',
    },
    {
      group: GROUP,
      label: 'quote revisions kept as snapshots',
      // A revision whose quote was not inserted has no parent (quote_id is NOT
      // NULL) and is recorded as orphan_line rather than attached to a guess.
      oldSql: `select count(*)::int as rows
from migration."stg_tjx_quote_revisions" r
where exists (
  select 1 from migration."stg_tjx_quote" q
  where q.id = r.quoteid
    and (case when q.status ~ '^[0-9]+$' then q.status::int end) in (1, 3, 4, 5)
)`,
      newSql: `select count(*)::int as rows
from app.tjx_quote_revisions r
join migration.row_map m
  on m.entity = 'tjx_quote_revision'
 and m.target_table = 'tjx_quote_revisions'
 and m.target_key = r.id::text`,
    },
    {
      group: GROUP,
      label: 'subcontractor invoices: total amount',
      // The header names its quote; a quote that was not inserted leaves the
      // invoice without a NOT NULL parent, and it is recorded as orphan_line.
      oldSql: `select coalesce(sum(nullif(regexp_replace(total_amount, '[^0-9.-]', '', 'g'), '')::numeric), 0) as total
from migration."stg_tjx_sub_invoice" i
where exists (
  select 1 from migration."stg_tjx_quote" q
  where q.id = i.quoteid
    and (case when q.status ~ '^[0-9]+$' then q.status::int end) in (1, 3, 4, 5)
)`,
      newSql: `select coalesce(sum(i.total_amount), 0)::numeric as total
from app.tjx_sub_invoices i
join migration.row_map r
  on r.entity = 'tjx_sub_invoice'
 and r.target_table = 'tjx_sub_invoices'
 and r.target_key = i.id::text`,
    },
  ],
}
