/**
 * Group 13 — Bell quoting (the `bell_*` tables of the 2026-11 dump).
 *
 * Bell mirrors the TJX model: rooms and fixtures as masters, then quotes with
 * their rooms, fixture lines, parts, prices, special parts and revision history.
 * These tables arrived after the legacy schema contract was written, and they
 * were first loaded by a one-off script from the older restored copy. This group
 * replaces that script: the same rules, but inside the harness, so a run is
 * staged, crosswalked, reported and repeatable, and everything it drops is an
 * exception instead of a log line.
 *
 * Rules carried over from the script (all of them are data decisions):
 *  - a quote, room or fixture keeps its legacy id in `legacy_id`; the other rows
 *    are keyed by what they belong to (quote and part number, quote and save
 *    sequence), so a re-run adopts rows that already exist instead of doubling them;
 *  - the legacy system never deleted child rows with their quote: AUTO_INCREMENT
 *    on `bell_quote` reaches 5065 while 58 quotes remain, so most child rows belong
 *    to quotes that no longer exist. Those are `orphan_line` exceptions;
 *  - a part number is stored upper-case and a (quote, part) pair is stored once;
 *  - a form slot with no fixture or no quantity is not a line (the room it sat in
 *    is kept);
 *  - values outside what the target accepts (a markup of 0, a tax rate above 1, a
 *    status outside 1/3/4/5) are defaulted and recorded.
 *
 * New in the harness version: a quote is linked to its site (and the site's
 * customer) and to its work order when they exist, which the script could not do
 * because it ran before any sites or work orders were loaded.
 *
 * A quote that has been edited in the app (version above 1) is not overwritten.
 */
import { and, eq, sql } from 'drizzle-orm'
import type { Tx } from '@cls/db'
import {
  bellFixtureParts,
  bellFixtures,
  bellFootCandleReadings,
  bellQuoteDownloads,
  bellQuoteFixtureParts,
  bellQuoteFixtures,
  bellQuoteParts,
  bellQuotePrices,
  bellQuoteRevisions,
  bellQuoteRooms,
  bellQuoteSpecialParts,
  bellQuoteWorkOrders,
  bellQuotes,
  bellRoomTemplateRooms,
  bellRoomTemplates,
  bellRooms,
  sites,
  workOrders,
} from '@cls/db/schema'
import type { GroupTransformer, ParityAnchor, TransformContext, TransformHelpers } from '../types'
import { instantOf } from './invoicing-rga'

const GROUP = 'bell'

/** Codes the target accepts (check constraints on `app.bell_quotes`). */
const QUOTE_STATUSES = new Set([1, 3, 4, 5])
const CEILING_GRIDS = new Set([1, 2, 3, 4])
const PAYMENT_TERMS = new Set([1, 3, 4, 5])
const PART_TYPES = new Set(['Ballast', 'Lamp'])
const REVISION_TYPES: Record<string, string> = { 'INSERT QUOTE': 'insert', 'UPDATE QUOTE': 'update' }

/** The manifest entity for each staged table. */
const ENTITY: Record<string, string> = {
  bell_room: 'bell_room',
  bell_fixture: 'bell_fixture',
  bell_fixture_parts: 'bell_fixture_part',
  bell_rooms_template: 'bell_room_template_room',
  bell_quote: 'bell_quote',
  bell_quote_fixtures: 'bell_quote_fixture',
  bell_prices_per_quote: 'bell_quote_price',
  bell_quote_parts: 'bell_quote_part',
  bell_quote_soparts: 'bell_quote_special_part',
  bell_quote_revisions: 'bell_quote_revision',
  bell_quote_downloads: 'bell_quote_download',
  bell_foot_candle_readings: 'bell_foot_candle_reading',
  bell_quote_extra_workorders: 'bell_quote_work_order',
  bell_fixture_per_quote: 'bell_fixture_per_quote',
  bell_fixture_parts_per_quote: 'bell_fixture_part_per_quote',
}

function entityFor(table: string): string {
  return ENTITY[table] ?? table
}

function num(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function upper(value: string | null): string | null {
  return value === null ? null : value.toUpperCase()
}

async function alreadyMapped(context: TransformContext): Promise<boolean> {
  return (
    (await context.helpers.targetKey(entityFor(context.table), context.table, context.sourceKey)) !==
    null
  )
}

async function rememberRow(
  context: TransformContext,
  targetTable: string,
  targetKey: string | number,
): Promise<void> {
  await context.helpers.remember({
    entity: entityFor(context.table),
    sourceTable: context.table,
    sourceKey: context.sourceKey,
    targetTable,
    targetKey: String(targetKey),
  })
}

/** The app id a legacy master or quote was given, or null when it was not loaded. */
async function appId(
  helpers: TransformHelpers,
  entity: string,
  sourceTable: string,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey(entity, sourceTable, String(legacyId))
  return mapped === null ? null : Number.parseInt(mapped, 10)
}

async function orphan(
  context: TransformContext,
  action: string,
  notes: string,
): Promise<void> {
  await context.helpers.exception({
    exceptionClass: 'orphan_line',
    entity: entityFor(context.table),
    sourceKey: context.sourceKey,
    action,
    notes,
  })
}

/** A table whose rows are folded into another table's rows: one decision, not one per row. */
async function foldedInto(context: TransformContext, into: string): Promise<void> {
  await context.helpers.exception({
    exceptionClass: 'not_migrated',
    entity: entityFor(context.table),
    sourceKey: context.table,
    action: `folded into ${into}: its rows become columns and child rows of that table`,
    notes: 'whole-table decision; the staged rows are the evidence',
  })
}

/* -------------------------------- masters -------------------------------- */

async function transformRoom(context: TransformContext): Promise<void> {
  const { tx, helpers } = context
  const legacyId = helpers.int('id')
  if (legacyId === null) throw new Error(`bell_room.id is not an integer: ${JSON.stringify(context.row.id)}`)
  const values = {
    legacyId,
    name: helpers.text('roomname') ?? `Room ${legacyId}`,
    sortOrder: helpers.int('sortorder') ?? 0,
  }
  const [row] = await tx
    .insert(bellRooms)
    .values(values)
    .onConflictDoUpdate({ target: bellRooms.legacyId, set: { name: values.name, sortOrder: values.sortOrder } })
    .returning({ id: bellRooms.id })
  await rememberRow(context, 'bell_rooms', row!.id)
}

async function transformFixture(context: TransformContext): Promise<void> {
  const { tx, helpers } = context
  const legacyId = helpers.int('id')
  if (legacyId === null) throw new Error(`bell_fixture.id is not an integer: ${JSON.stringify(context.row.id)}`)
  const values = {
    legacyId,
    name: helpers.text('fixturename') ?? `Fixture ${legacyId}`,
    sortOrder: helpers.int('sortorder') ?? 0,
  }
  const [row] = await tx
    .insert(bellFixtures)
    .values(values)
    .onConflictDoUpdate({ target: bellFixtures.legacyId, set: { name: values.name, sortOrder: values.sortOrder } })
    .returning({ id: bellFixtures.id })
  await rememberRow(context, 'bell_fixtures', row!.id)
}

/** Markup and ratio defaults, recorded when they change what the source said. */
async function factorsOf(
  context: TransformContext,
): Promise<{ markup: string; ratio: string }> {
  const { helpers } = context
  const markup = num(helpers.text('markup'))
  const ratio = num(helpers.text('part_ratio_perfixture'))
  if (markup === null || markup <= 0) {
    await helpers.exception({
      exceptionClass: 'zero_amount',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'markup defaulted to 1: the target requires a markup above 0',
      notes: `markup = ${JSON.stringify(context.row.markup)}`,
    })
  }
  return {
    markup: String(markup !== null && markup > 0 ? markup : 1),
    ratio: String(ratio !== null && ratio >= 0 ? ratio : 1),
  }
}

async function transformFixturePart(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const fixtureLegacy = helpers.int('fixtureid')
  const fixtureId = await appId(helpers, 'bell_fixture', 'bell_fixture', fixtureLegacy)
  const partNo = upper(helpers.text('partno'))
  if (fixtureId === null || partNo === null) {
    await orphan(
      context,
      'row not inserted: no fixture or no part number',
      `fixtureid = ${JSON.stringify(context.row.fixtureid)}, partno = ${JSON.stringify(context.row.partno)}`,
    )
    return
  }
  const type = helpers.text('parttype') ?? ''
  const { markup, ratio } = await factorsOf(context)
  const [inserted] = await tx
    .insert(bellFixtureParts)
    .values({
      legacyId: helpers.int('id'),
      fixtureId,
      partNo,
      partType: PART_TYPES.has(type) ? type : '',
      markup,
      ratioPerFixture: ratio,
    })
    .onConflictDoNothing()
    .returning({ id: bellFixtureParts.id })
  if (inserted) {
    await rememberRow(context, 'bell_fixture_parts', inserted.id)
    return
  }
  // The (fixture, part) pair already exists: either an earlier legacy row of the
  // same pair (a duplicate) or a row from a previous load. Point at it either way.
  const [existing] = await tx
    .select({ id: bellFixtureParts.id })
    .from(bellFixtureParts)
    .where(and(eq(bellFixtureParts.fixtureId, fixtureId), eq(bellFixtureParts.partNo, partNo)))
    .limit(1)
  if (existing) await rememberRow(context, 'bell_fixture_parts', existing.id)
  await helpers.exception({
    exceptionClass: 'duplicate_master_name',
    entity: entityFor(context.table),
    sourceKey: context.sourceKey,
    action: 'not inserted again: the (fixture, part) pair already exists',
    notes: `fixtureid = ${fixtureLegacy}, partno = ${partNo}`,
  })
}

/** The one default template the legacy `bell_rooms_template` list becomes. */
async function defaultTemplateId(tx: Tx): Promise<number> {
  const [existing] = await tx
    .select({ id: bellRoomTemplates.id })
    .from(bellRoomTemplates)
    .where(sql`lower(${bellRoomTemplates.name}) = 'bell default'`)
    .limit(1)
  if (existing) return existing.id
  const [created] = await tx
    .insert(bellRoomTemplates)
    .values({ name: 'Bell default', isDefault: true, notes: 'Migrated from bell_rooms_template' })
    .returning({ id: bellRoomTemplates.id })
  return created!.id
}

async function transformTemplateRoom(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const roomLegacy = helpers.int('roomid')
  const roomId = await appId(helpers, 'bell_room', 'bell_room', roomLegacy)
  if (roomId === null) {
    await orphan(context, 'row not inserted: the room is not loaded', `roomid = ${JSON.stringify(context.row.roomid)}`)
    return
  }
  const templateId = await defaultTemplateId(tx)
  // Order within the template: by the legacy sort order, then by dump order. A
  // table with no primary key is keyed by its row number, which is the source key.
  const rowNo = Number(context.sourceKey)
  const [rank] = (await tx.execute(sql`
    select count(*)::int as before
    from migration.stg_bell_rooms_template t
    where t._dump_id = ${context.dumpId}
      and (coalesce(nullif(t.sortorder, '')::int, 0), t._row_no)
        < (${helpers.int('sortorder') ?? 0}::int, ${rowNo}::int)
  `)) as unknown as Array<{ before: number }>
  // A room already on the template (a previous load) is adopted, not added again.
  const [existing] = await tx
    .select({ id: bellRoomTemplateRooms.id })
    .from(bellRoomTemplateRooms)
    .where(and(eq(bellRoomTemplateRooms.templateId, templateId), eq(bellRoomTemplateRooms.roomId, roomId)))
    .limit(1)
  if (existing) {
    await rememberRow(context, 'bell_room_template_rooms', existing.id)
    return
  }
  let [inserted] = await tx
    .insert(bellRoomTemplateRooms)
    .values({ templateId, roomId, sortOrder: rank?.before ?? 0 })
    .onConflictDoNothing()
    .returning({ id: bellRoomTemplateRooms.id })
  if (!inserted) {
    // The position is taken by another room: go to the end of the template.
    const [last] = (await tx.execute(sql`
      select coalesce(max(sort_order), -1)::int as last from app.bell_room_template_rooms where template_id = ${templateId}
    `)) as unknown as Array<{ last: number }>
    ;[inserted] = await tx
      .insert(bellRoomTemplateRooms)
      .values({ templateId, roomId, sortOrder: (last?.last ?? -1) + 1 })
      .returning({ id: bellRoomTemplateRooms.id })
  }
  await rememberRow(context, 'bell_room_template_rooms', inserted!.id)
}

/* --------------------------------- quotes --------------------------------- */

async function resolveSite(tx: Tx, helpers: TransformHelpers, legacyId: number | null): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('site', 'sites', String(legacyId))
  const candidate = mapped === null ? legacyId : Number.parseInt(mapped, 10)
  const [row] = await tx.select({ id: sites.id }).from(sites).where(eq(sites.id, candidate)).limit(1)
  return row?.id ?? null
}

async function transformQuote(context: TransformContext): Promise<void> {
  const { tx, helpers } = context
  const legacyId = helpers.int('id')
  if (legacyId === null) throw new Error(`bell_quote.id is not an integer: ${JSON.stringify(context.row.id)}`)
  const entity = entityFor(context.table)

  const status = helpers.int('status') ?? 1
  if (!QUOTE_STATUSES.has(status)) {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity,
      sourceKey: context.sourceKey,
      action: 'stored status 1: the target accepts 1, 3, 4 and 5',
      notes: `status = ${JSON.stringify(context.row.status)}`,
    })
  }
  const grid = helpers.int('ceiling_grid_type')
  const terms = helpers.int('payment_terms')
  const rate = num(helpers.text('appliedtaxrate'))
  let appliedTaxRate: string | null = null
  if (rate !== null) {
    if (rate >= 0 && rate <= 1) appliedTaxRate = String(rate)
    else {
      await helpers.exception({
        exceptionClass: 'blank_tax',
        entity,
        sourceKey: context.sourceKey,
        action: 'stored a NULL tax rate: the target accepts 0 to 1',
        notes: `appliedtaxrate = ${JSON.stringify(context.row.appliedtaxrate)}`,
      })
    }
  }
  const quoteType = helpers.text('quote_type') === 'Legacy' ? 'Legacy' : 'LED'
  const due = helpers.date('due_date')
  const created = instantOf(helpers.timestamp('date_created'))

  const siteId = await resolveSite(tx, helpers, helpers.int('site'))
  let customerId: number | null = null
  if (siteId !== null) {
    const [site] = await tx.select({ customerId: sites.customerId }).from(sites).where(eq(sites.id, siteId)).limit(1)
    customerId = site?.customerId ?? null
  } else if (helpers.int('site') !== null) {
    await orphan(
      context,
      'stored without a site link: no app.sites row exists',
      `site = ${JSON.stringify(context.row.site)}`,
    )
  }

  const money = (column: string): string => helpers.money(column) ?? '0'
  const values: typeof bellQuotes.$inferInsert = {
    legacyId,
    siteId,
    customerId,
    status: QUOTE_STATUSES.has(status) ? status : 1,
    quoteType,
    ceilingGridType: grid !== null && CEILING_GRIDS.has(grid) ? grid : null,
    isTypeMaintenance: helpers.flag('is_type_maintenance') === 1,
    paymentTermsCode: terms !== null && PAYMENT_TERMS.has(terms) ? terms : null,
    dueDate: due,
    workOrderNumber: helpers.text('workordernumber'),
    attachFolderPath: helpers.text('bellquote_folder_attach_path'),
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
    appliedTaxRate,
    subtotalAmount: money('subtotal_amount'),
    taxAmount: money('tax_amount'),
    totalAmount: money('total_amount'),
    withoutMarkupSubtotalAmount: money('withoutmarkup_subtotal_amount'),
    withoutMarkupTaxAmount: money('withoutmarkup_tax_amount'),
    withoutMarkupTotalAmount: money('withoutmarkup_total_amount'),
    notes: helpers.text('notes'),
    pdfNotes: helpers.text('pdf_notes'),
    revisionNotes: helpers.text('revision_notes'),
    revisionNo: helpers.int('revision_no') ?? 0,
    ...(created === undefined ? {} : { createdAt: created }),
  }
  const { legacyId: _key, ...updates } = values
  const [row] = await tx
    .insert(bellQuotes)
    .values(values)
    .onConflictDoUpdate({ target: bellQuotes.legacyId, set: updates, setWhere: eq(bellQuotes.version, 1) })
    .returning({ id: bellQuotes.id })
  const quoteId =
    row?.id ??
    (await tx.select({ id: bellQuotes.id }).from(bellQuotes).where(eq(bellQuotes.legacyId, legacyId)).limit(1))[0]!.id
  await rememberRow(context, 'bell_quotes', quoteId)

  // The work-order link: the quote keeps the number as text either way.
  const woNumber = helpers.int('workordernumber')
  if (woNumber !== null) {
    const [wo] = await tx.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.id, woNumber)).limit(1)
    if (wo) {
      await tx
        .insert(bellQuoteWorkOrders)
        .values({ quoteId, workOrderId: wo.id, isPrimary: true, sortOrder: 0 })
        .onConflictDoNothing()
    }
  }
}

/** The room order of one quote: legacy sort order of its first row in the room. */
const roomOrderCache = new Map<string, Map<number, number>>()

async function roomOrder(tx: Tx, dumpId: string, quoteLegacy: number): Promise<Map<number, number>> {
  const key = `${dumpId}|${quoteLegacy}`
  const cached = roomOrderCache.get(key)
  if (cached) return cached
  const rows = (await tx.execute(sql`
    select coalesce(nullif(roomid, '')::int, 0) as room
    from migration.stg_bell_quote_fixtures
    where _dump_id = ${dumpId} and nullif(quoteid, '')::int = ${quoteLegacy}
    group by 1
    order by min(coalesce(nullif(sortorder, '')::int, 0)), min(_row_no)
  `)) as unknown as Array<{ room: number }>
  const order = new Map<number, number>()
  rows.forEach((row, index) => order.set(row.room, index))
  if (roomOrderCache.size > 200) roomOrderCache.clear()
  roomOrderCache.set(key, order)
  return order
}

async function transformQuoteFixture(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers, dumpId } = context
  const quoteLegacy = helpers.int('quoteid')
  const quoteId = await appId(helpers, 'bell_quote', 'bell_quote', quoteLegacy)
  if (quoteId === null || quoteLegacy === null) {
    await orphan(context, 'row not inserted: the quote no longer exists', `quoteid = ${JSON.stringify(context.row.quoteid)}`)
    return
  }

  // The room the slot sits in, created the first time the quote uses it.
  const roomLegacy = helpers.int('roomid') ?? 0
  const roomKey = `${quoteLegacy}|${roomLegacy}`
  const mappedRoom = await helpers.targetKey('bell_quote_room', 'bell_quote_fixtures', `room:${roomKey}`)
  let quoteRoomId: number | null = mappedRoom === null ? null : Number.parseInt(mappedRoom, 10)
  if (quoteRoomId === null) {
    const roomId = await appId(helpers, 'bell_room', 'bell_room', roomLegacy)
    const [room] =
      roomId === null
        ? []
        : await tx.select({ name: bellRooms.name }).from(bellRooms).where(eq(bellRooms.id, roomId)).limit(1)
    const order = (await roomOrder(tx, dumpId, quoteLegacy)).get(roomLegacy) ?? 0
    const [inserted] = await tx
      .insert(bellQuoteRooms)
      .values({ quoteId, roomId, roomName: room?.name ?? `Room ${roomLegacy}`, sortOrder: order })
      .onConflictDoNothing()
      .returning({ id: bellQuoteRooms.id })
    const resolved =
      inserted?.id ??
      (
        await tx
          .select({ id: bellQuoteRooms.id })
          .from(bellQuoteRooms)
          .where(and(eq(bellQuoteRooms.quoteId, quoteId), eq(bellQuoteRooms.sortOrder, order)))
          .limit(1)
      )[0]!.id
    quoteRoomId = resolved
    await helpers.remember({
      entity: 'bell_quote_room',
      sourceTable: 'bell_quote_fixtures',
      sourceKey: `room:${roomKey}`,
      targetTable: 'bell_quote_rooms',
      targetKey: String(resolved),
    })
  }

  const fixtureLegacy = helpers.int('fixtureid') ?? 0
  const quantity = num(helpers.text('totalfixtures'))
  if (fixtureLegacy === 0 || quantity === null || quantity <= 0) {
    await helpers.exception({
      exceptionClass: 'not_migrated',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'empty form slot skipped: no fixture or no quantity (the room is kept)',
      notes: `fixtureid = ${JSON.stringify(context.row.fixtureid)}, totalfixtures = ${JSON.stringify(context.row.totalfixtures)}`,
    })
    return
  }

  const fixtureId = await appId(helpers, 'bell_fixture', 'bell_fixture', fixtureLegacy)
  // The name the quote was saved with wins over today's master name.
  const [snapshot] = (await tx.execute(sql`
    select fixturename from migration.stg_bell_fixture_per_quote
    where _dump_id = ${dumpId} and nullif(quoteid, '')::int = ${quoteLegacy} and nullif(fixtureid, '')::int = ${fixtureLegacy}
    order by _row_no limit 1
  `)) as unknown as Array<{ fixturename: string | null }>
  let name = snapshot?.fixturename?.trim() || null
  if (name === null && fixtureId !== null) {
    const [master] = await tx.select({ name: bellFixtures.name }).from(bellFixtures).where(eq(bellFixtures.id, fixtureId)).limit(1)
    name = master?.name ?? null
  }

  const [line] = await tx
    .insert(bellQuoteFixtures)
    .values({
      quoteId,
      quoteRoomId,
      fixtureId,
      fixtureName: name ?? `Fixture ${fixtureLegacy}`,
      quantity: String(quantity),
      galleryFolderName: helpers.text('fix_gallery_folder_name'),
      sortOrder: helpers.int('sortorder') ?? 0,
    })
    .onConflictDoNothing()
    .returning({ id: bellQuoteFixtures.id })
  if (!line) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'row not inserted: another line already holds this position in the room',
      notes: `quoteid = ${quoteLegacy}, roomid = ${roomLegacy}, sortorder = ${JSON.stringify(context.row.sortorder)}`,
    })
    return
  }
  await rememberRow(context, 'bell_quote_fixtures', line.id)

  // The parts this fixture carried on this quote, first spelling of each part wins.
  const parts = (await tx.execute(sql`
    select partno, markup, parttype, part_ratio_perfixture
    from migration.stg_bell_fixture_parts_per_quote
    where _dump_id = ${dumpId} and nullif(quoteid, '')::int = ${quoteLegacy} and nullif(fixtureid, '')::int = ${fixtureLegacy}
    order by _row_no
  `)) as unknown as Array<{ partno: string | null; markup: string | null; parttype: string | null; part_ratio_perfixture: string | null }>
  const seen = new Set<string>()
  let order = 0
  for (const part of parts) {
    const partNo = upper(part.partno?.trim() || null)
    if (partNo === null || seen.has(partNo)) continue
    seen.add(partNo)
    const markup = num(part.markup?.trim() || null)
    const ratio = num(part.part_ratio_perfixture?.trim() || null)
    const type = part.parttype?.trim() ?? ''
    const [master] =
      fixtureId === null
        ? []
        : await tx
            .select({ id: bellFixtureParts.id })
            .from(bellFixtureParts)
            .where(and(eq(bellFixtureParts.fixtureId, fixtureId), eq(bellFixtureParts.partNo, partNo)))
            .limit(1)
    await tx
      .insert(bellQuoteFixtureParts)
      .values({
        quoteFixtureId: line.id,
        fixturePartId: master?.id ?? null,
        partNo,
        partType: PART_TYPES.has(type) ? type : '',
        markup: String(markup !== null && markup > 0 ? markup : 1),
        ratioPerFixture: String(ratio !== null && ratio >= 0 ? ratio : 1),
        sortOrder: order++,
      })
      .onConflictDoNothing()
  }
}

async function transformPrice(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const quoteId = await appId(helpers, 'bell_quote', 'bell_quote', helpers.int('quoteid'))
  if (quoteId === null) {
    await orphan(context, 'row not inserted: the quote no longer exists', `quoteid = ${JSON.stringify(context.row.quoteid)}`)
    return
  }
  const partNo = upper(helpers.text('partno'))
  const price = num(helpers.text('price'))
  if (partNo === null || price === null || price < 0) {
    await helpers.exception({
      exceptionClass: 'unparseable_money',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'row not inserted: no part number, or a missing or negative price',
      notes: `partno = ${JSON.stringify(context.row.partno)}, price = ${JSON.stringify(context.row.price)}`,
    })
    return
  }
  const last = num(helpers.text('last_price'))
  const [inserted] = await tx
    .insert(bellQuotePrices)
    .values({
      quoteId,
      partNo,
      price: price.toFixed(2),
      previousPrice: last !== null && last >= 0 ? last.toFixed(2) : null,
      source: 'imported',
    })
    .onConflictDoNothing()
    .returning({ id: bellQuotePrices.id })
  if (inserted) {
    await rememberRow(context, 'bell_quote_prices', inserted.id)
    return
  }
  await helpers.exception({
    exceptionClass: 'duplicate_master_name',
    entity: entityFor(context.table),
    sourceKey: context.sourceKey,
    action: 'not inserted again: the (quote, part) price already exists',
    notes: `quoteid = ${JSON.stringify(context.row.quoteid)}, partno = ${partNo}`,
  })
}

async function transformQuotePart(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const quoteId = await appId(helpers, 'bell_quote', 'bell_quote', helpers.int('quoteid'))
  if (quoteId === null) {
    await orphan(context, 'row not inserted: the quote no longer exists', `quoteid = ${JSON.stringify(context.row.quoteid)}`)
    return
  }
  const partNo = upper(helpers.text('partno'))
  const qty = num(helpers.text('qty'))
  const price = num(helpers.text('price'))
  if (partNo === null || qty === null || qty < 0 || price === null || price < 0) {
    await helpers.exception({
      exceptionClass: 'unparseable_money',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'row not inserted: no part number, or a missing or negative quantity or price',
      notes: `partno = ${JSON.stringify(context.row.partno)}, qty = ${JSON.stringify(context.row.qty)}, price = ${JSON.stringify(context.row.price)}`,
    })
    return
  }
  const without = num(helpers.text('without_markup_qty'))
  if (without === null) {
    await helpers.exception({
      exceptionClass: 'blank_money',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'quantity without markup defaulted to the quantity with markup',
      notes: `without_markup_qty = ${JSON.stringify(context.row.without_markup_qty)}`,
    })
  }
  const withoutQty = without ?? qty
  const [inserted] = await tx
    .insert(bellQuoteParts)
    .values({
      quoteId,
      partNo,
      qtyWithMarkup: String(qty),
      qtyWithoutMarkup: String(withoutQty),
      unitPrice: price.toFixed(2),
      lineSubtotal: (qty * price).toFixed(2),
      lineSubtotalWithoutMarkup: (withoutQty * price).toFixed(2),
      sortOrder: helpers.int('sortorder') ?? 0,
      origin: 'legacy',
    })
    .onConflictDoNothing()
    .returning({ id: bellQuoteParts.id })
  if (inserted) {
    await rememberRow(context, 'bell_quote_parts', inserted.id)
    return
  }
  await helpers.exception({
    exceptionClass: 'duplicate_master_name',
    entity: entityFor(context.table),
    sourceKey: context.sourceKey,
    action: 'not inserted again: the (quote, part) line already exists',
    notes: `quoteid = ${JSON.stringify(context.row.quoteid)}, partno = ${partNo}`,
  })
}

async function transformSpecialPart(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const quoteId = await appId(helpers, 'bell_quote', 'bell_quote', helpers.int('quoteid'))
  if (quoteId === null) {
    await orphan(context, 'row not inserted: the quote no longer exists', `quoteid = ${JSON.stringify(context.row.quoteid)}`)
    return
  }
  const name = helpers.text('name')
  const qty = num(helpers.text('qty'))
  const price = num(helpers.text('price'))
  if (name === null || qty === null || qty <= 0 || price === null || price < 0) {
    await helpers.exception({
      exceptionClass: 'unparseable_money',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'row not inserted: no name, or a missing or non-positive quantity, or a missing or negative price',
      notes: `name = ${JSON.stringify(context.row.name)}, qty = ${JSON.stringify(context.row.qty)}, price = ${JSON.stringify(context.row.price)}`,
    })
    return
  }
  const [inserted] = await tx
    .insert(bellQuoteSpecialParts)
    .values({
      quoteId,
      name,
      quantity: String(qty),
      unitPrice: price.toFixed(2),
      lineSubtotal: (qty * price).toFixed(2),
      sortOrder: helpers.int('sortorder') ?? 0,
    })
    .returning({ id: bellQuoteSpecialParts.id })
  await rememberRow(context, 'bell_quote_special_parts', inserted!.id)
}

/* ------------------------------ history rows ------------------------------ */

/** A saved-quote snapshot column: parsed when it is JSON, kept verbatim when it is not. */
function snapshotOf(
  raw: string | null,
  array: boolean,
): { value: Record<string, unknown> | Record<string, unknown>[]; ok: boolean } {
  if (raw === null) return { value: array ? [] : {}, ok: true }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (array && Array.isArray(parsed)) return { value: parsed as Record<string, unknown>[], ok: true }
    if (!array && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { value: parsed as Record<string, unknown>, ok: true }
    }
  } catch {
    // Not JSON: fall through to the verbatim copy.
  }
  return { value: array ? [{ raw }] : { raw }, ok: false }
}

async function transformRevision(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const quoteId = await appId(helpers, 'bell_quote', 'bell_quote', helpers.int('quoteid'))
  if (quoteId === null) {
    await orphan(context, 'row not inserted: the quote no longer exists', `quoteid = ${JSON.stringify(context.row.quoteid)}`)
    return
  }
  const type = REVISION_TYPES[(helpers.text('revision_type') ?? '').toUpperCase()] ?? 'import'
  if (type === 'import') {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'stored revision type import: the legacy type is not insert or update',
      notes: `revision_type = ${JSON.stringify(context.row.revision_type)}`,
    })
  }
  const quote = snapshotOf(helpers.text('data_quote'), false)
  const fixtures = snapshotOf(helpers.text('data_fixtures'), true)
  const parts = snapshotOf(helpers.text('data_parts'), true)
  const special = snapshotOf(helpers.text('data_soparts'), true)
  const bad = [
    quote.ok ? null : 'data_quote',
    fixtures.ok ? null : 'data_fixtures',
    parts.ok ? null : 'data_parts',
    special.ok ? null : 'data_soparts',
  ].filter((column): column is string => column !== null)
  if (bad.length > 0) {
    await helpers.exception({
      exceptionClass: 'unparseable_json',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'kept verbatim as {"raw": ...}: the column is not the JSON shape the target expects',
      notes: bad.join(', '),
    })
  }
  const created = instantOf(helpers.timestamp('created_time'))
  const [inserted] = await tx
    .insert(bellQuoteRevisions)
    .values({
      quoteId,
      saveSeq: helpers.int('revision_id') ?? 1,
      revisionType: type,
      dataQuote: quote.value as Record<string, unknown>,
      dataRooms: [],
      dataFixtures: fixtures.value as Record<string, unknown>[],
      dataParts: parts.value as Record<string, unknown>[],
      dataSpecialParts: special.value as Record<string, unknown>[],
      ...(created === undefined ? {} : { createdAt: created }),
    })
    .onConflictDoNothing()
    .returning({ id: bellQuoteRevisions.id })
  if (inserted) await rememberRow(context, 'bell_quote_revisions', inserted.id)
}

async function transformDownload(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const quoteId = await appId(helpers, 'bell_quote', 'bell_quote', helpers.int('quoteid'))
  if (quoteId === null) {
    await orphan(context, 'row not inserted: the quote no longer exists', `quoteid = ${JSON.stringify(context.row.quoteid)}`)
    return
  }
  const created = instantOf(helpers.timestamp('datecreated'))
  const [inserted] = await tx
    .insert(bellQuoteDownloads)
    .values({
      quoteId,
      fileName: helpers.text('filename') ?? '(unnamed)',
      folderName: helpers.text('foldername'),
      downloadedByName: helpers.text('downloadbyname'),
      revisionNotes: helpers.text('download_revision_notes'),
      ...(created === undefined ? {} : { createdAt: created }),
    })
    .returning({ id: bellQuoteDownloads.id })
  await rememberRow(context, 'bell_quote_downloads', inserted!.id)
}

async function transformReading(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const quoteId = await appId(helpers, 'bell_quote', 'bell_quote', helpers.int('quoteid'))
  if (quoteId === null) {
    await orphan(context, 'row not inserted: the quote no longer exists', `quoteid = ${JSON.stringify(context.row.quoteid)}`)
    return
  }
  const [inserted] = await tx
    .insert(bellFootCandleReadings)
    .values({
      quoteId,
      sortOrder: helpers.int('sortorder') ?? 0,
      frReading: helpers.text('fr_reading'),
      fcReading: helpers.text('fc_reading'),
      flReading: helpers.text('fl_reading'),
      crReading: helpers.text('cr_reading'),
      cReading: helpers.text('c_reading'),
      clReading: helpers.text('cl_reading'),
      brReading: helpers.text('br_reading'),
      bcReading: helpers.text('bc_reading'),
      blReading: helpers.text('bl_reading'),
      ftrReading: helpers.text('ftr_reading'),
      ftrStallReading: helpers.text('ftr_stall_reading'),
    })
    .returning({ id: bellFootCandleReadings.id })
  await rememberRow(context, 'bell_foot_candle_readings', inserted!.id)
}

/** Extra work orders beyond the quote's own: a link row, when the work order exists. */
async function transformExtraWorkOrder(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const quoteId = await appId(helpers, 'bell_quote', 'bell_quote', helpers.int('quoteid'))
  const woId = helpers.int('woid')
  const [wo] =
    woId === null ? [] : await tx.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.id, woId)).limit(1)
  if (quoteId === null || !wo) {
    await orphan(
      context,
      'row not inserted: the quote or the work order no longer exists',
      `quoteid = ${JSON.stringify(context.row.quoteid)}, woid = ${JSON.stringify(context.row.woid)}`,
    )
    return
  }
  const [inserted] = await tx
    .insert(bellQuoteWorkOrders)
    .values({ quoteId, workOrderId: wo.id, isPrimary: false, sortOrder: helpers.int('sortorder') ?? 0 })
    .onConflictDoNothing()
    .returning({ id: bellQuoteWorkOrders.id })
  if (inserted) await rememberRow(context, 'bell_quote_work_orders', inserted.id)
}

/* -------------------------------- transformer ------------------------------ */

const parity: ParityAnchor[] = [
  {
    group: GROUP,
    label: 'bell quotes',
    oldSql: 'select count(*)::int as value from migration."stg_bell_quote"',
    newSql: 'select count(*)::int as value from app.bell_quotes',
  },
  {
    group: GROUP,
    label: 'bell quote totals',
    oldSql:
      "select coalesce(sum(nullif(regexp_replace(total_amount, '[^0-9.-]', '', 'g'), '')::numeric), 0)::numeric(14, 2) as value from migration.\"stg_bell_quote\"",
    newSql: 'select coalesce(sum(total_amount), 0)::numeric(14, 2) as value from app.bell_quotes',
  },
  {
    group: GROUP,
    label: 'bell rooms and fixtures',
    oldSql:
      'select (select count(*) from migration."stg_bell_room") + (select count(*) from migration."stg_bell_fixture") as value',
    newSql: 'select (select count(*) from app.bell_rooms) + (select count(*) from app.bell_fixtures) as value',
  },
]

export const transformer: GroupTransformer = {
  group: GROUP,

  async transform(context) {
    switch (context.table) {
      case 'bell_room':
        return transformRoom(context)
      case 'bell_fixture':
        return transformFixture(context)
      case 'bell_fixture_parts':
        return transformFixturePart(context)
      case 'bell_rooms_template':
        return transformTemplateRoom(context)
      case 'bell_quote':
        return transformQuote(context)
      case 'bell_fixture_per_quote':
      case 'bell_fixture_parts_per_quote':
        return foldedInto(context, 'bell_quote_fixtures')
      case 'bell_quote_fixtures':
        return transformQuoteFixture(context)
      case 'bell_prices_per_quote':
        return transformPrice(context)
      case 'bell_quote_parts':
        return transformQuotePart(context)
      case 'bell_quote_soparts':
        return transformSpecialPart(context)
      case 'bell_quote_revisions':
        return transformRevision(context)
      case 'bell_quote_downloads':
        return transformDownload(context)
      case 'bell_foot_candle_readings':
        return transformReading(context)
      case 'bell_quote_extra_workorders':
        return transformExtraWorkOrder(context)
      default:
        throw new Error(`bell group has no handler for table ${context.table}`)
    }
  },

  unmapped: {
    'bell_quote.createdby': 'legacy user id; the new quote has created_by from the app session, not a legacy mapping',
    'bell_quote.is_submitted': 'derived: status and the submitted timestamp carry it in the new model',
    'bell_quote_revisions.revised_by_user': 'legacy user name; revisions carry a user id only for app-made saves',
    'bell_quote_parts.fixtured_partno': 'the fixture the part came from; the new line is keyed by quote and part',
    'bell_quote_extra_workorders.is_project_workorder': 'no equivalent: the link row only records the work order',
  },

  parity,
}
