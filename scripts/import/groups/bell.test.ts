/**
 * Bell group, against the real Postgres. Each test works on ids far above any
 * legacy id and cleans up after itself, so it can run beside real Bell data.
 */
import { afterAll, describe, expect, test } from 'vitest'
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { getDb } from '@cls/db'
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
  bellQuotes,
  bellRoomTemplateRooms,
  bellRooms,
  migrationExceptions,
  migrationRowMap,
} from '@cls/db/schema'
import { runTransformerRow } from '../testing'
import { transformer } from './bell'

const configured = (() => {
  try {
    return Boolean(process.env.DATABASE_URL)
  } catch {
    return false
  }
})()

const marker = `bl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const dumpId = `test-dump-${marker}`

// Legacy ids are small integers; these sit far above them and are unique per run.
const base = 1_900_000_000 + Math.floor(Math.random() * 90_000) * 10
const ROOM_A = base + 1
const ROOM_B = base + 2
const FIXTURE = base + 3
const QUOTE = base + 4
/** Part numbers are stored upper-case, so the test compares against that spelling. */
const PART = `LED-${marker}`.toUpperCase()
const GONE_QUOTE = base + 5
const ids = { rooms: [ROOM_A, ROOM_B], fixtures: [FIXTURE], quotes: [QUOTE] }

async function transform(table: string, sourceKey: string, row: Record<string, string | null>) {
  await getDb().transaction(async (tx) => {
    await runTransformerRow(tx, transformer, { group: 'bell', table, sourceKey, row, dumpId })
  })
}

/** A staged row, so the transformer's reads of sibling staging tables find it. */
async function stage(table: string, rowNo: number, values: Record<string, string>) {
  const columns = Object.keys(values)
  const db = getDb()
  await db.execute(
    sql`insert into ${sql.raw(`migration."${table}"`)} ("_row_no", "_source_pk", "_row_hash", "_dump_id", ${sql.join(
      columns.map((column) => sql.identifier(column)),
      sql`, `,
    )}) values (${rowNo}, ${String(rowNo)}, ${'hash'}, ${dumpId}, ${sql.join(
      columns.map((column) => sql`${values[column]}`),
      sql`, `,
    )})`,
  )
}

async function exceptionFor(exceptionClass: string, entity: string, sourceKey: string) {
  const [row] = await getDb()
    .select()
    .from(migrationExceptions)
    .where(
      and(
        eq(migrationExceptions.exceptionClass, exceptionClass),
        eq(migrationExceptions.entity, entity),
        eq(migrationExceptions.sourceKey, sourceKey),
      ),
    )
    .limit(1)
  return row ?? null
}

async function quoteRow() {
  const [row] = await getDb().select().from(bellQuotes).where(eq(bellQuotes.legacyId, QUOTE))
  return row
}

afterAll(async () => {
  if (!configured) return
  const db = getDb()
  const quoteIds = (
    await db.select({ id: bellQuotes.id }).from(bellQuotes).where(inArray(bellQuotes.legacyId, ids.quotes))
  ).map((row) => row.id)
  if (quoteIds.length > 0) await db.delete(bellQuotes).where(inArray(bellQuotes.id, quoteIds))
  const roomIds = (
    await db.select({ id: bellRooms.id }).from(bellRooms).where(inArray(bellRooms.legacyId, ids.rooms))
  ).map((row) => row.id)
  if (roomIds.length > 0) {
    await db.delete(bellRoomTemplateRooms).where(inArray(bellRoomTemplateRooms.roomId, roomIds))
    await db.delete(bellRooms).where(inArray(bellRooms.id, roomIds))
  }
  await db.delete(bellFixtures).where(inArray(bellFixtures.legacyId, ids.fixtures))
  await db.delete(migrationRowMap).where(eq(migrationRowMap.dumpId, dumpId))
  // Only this run's exceptions: the marker is in every source key but the quote's own id.
  await db
    .delete(migrationExceptions)
    .where(
      and(
        like(migrationExceptions.entity, 'bell\\_%'),
        sql`(${migrationExceptions.sourceKey} like ${`%${marker}%`} or ${migrationExceptions.sourceKey} = ${String(QUOTE)})`,
      ),
    )
  for (const table of [
    'stg_bell_quote_fixtures',
    'stg_bell_fixture_per_quote',
    'stg_bell_fixture_parts_per_quote',
    'stg_bell_rooms_template',
  ]) {
    await db.execute(sql`delete from ${sql.raw(`migration."${table}"`)} where "_dump_id" = ${dumpId}`)
  }
})

describe.skipIf(!configured)('bell group', () => {
  test('masters, then a quote with its rooms, lines, parts and history', async () => {
    const db = getDb()
    await transform('bell_room', String(ROOM_A), { id: String(ROOM_A), roomname: `Hall ${marker}`, sortorder: '1' })
    await transform('bell_room', String(ROOM_B), { id: String(ROOM_B), roomname: `Office ${marker}`, sortorder: '2' })
    await transform('bell_fixture', String(FIXTURE), {
      id: String(FIXTURE),
      fixturename: `Troffer ${marker}`,
      sortorder: '1',
    })
    // markup 0 is outside what the target accepts: defaulted to 1 and recorded.
    await transform('bell_fixture_parts', `${marker}-p1`, {
      id: `${base + 6}`,
      partno: ` led-${marker} `,
      fixtureid: String(FIXTURE),
      markup: '0',
      parttype: 'Lamp',
      part_ratio_perfixture: '2',
    })
    // The same (fixture, part) again: a duplicate, recorded, and still pointing at the first.
    await transform('bell_fixture_parts', `${marker}-p2`, {
      id: `${base + 7}`,
      partno: PART,
      fixtureid: String(FIXTURE),
      markup: '1.5',
      parttype: 'Lamp',
      part_ratio_perfixture: '2',
    })
    const [master] = await db
      .select()
      .from(bellFixtureParts)
      .where(eq(bellFixtureParts.partNo, PART))
    expect(master?.markup).toBe('1.0000')
    expect(master?.partType).toBe('Lamp')
    expect(await exceptionFor('zero_amount', 'bell_fixture_part', `${marker}-p1`)).not.toBeNull()
    expect(await exceptionFor('duplicate_master_name', 'bell_fixture_part', `${marker}-p2`)).not.toBeNull()

    await transform('bell_quote', String(QUOTE), {
      id: String(QUOTE),
      status: '3',
      quote_type: 'Legacy',
      ceiling_grid_type: '9', // not a grid the target knows
      payment_terms: '4',
      appliedtaxrate: '13', // a percentage, not a rate between 0 and 1
      due_date: '2026-03-04',
      subtotal_amount: '$1,000.00',
      tax_amount: '130.00',
      total_amount: '1130.00',
      date_created: '2025-02-03 10:30:00',
    })
    const quote = await quoteRow()
    expect(quote?.status).toBe(3)
    expect(quote?.quoteType).toBe('Legacy')
    expect(quote?.ceilingGridType).toBeNull()
    expect(quote?.paymentTermsCode).toBe(4)
    expect(quote?.appliedTaxRate).toBeNull()
    expect(quote?.totalAmount).toBe('1130.00')
    expect(quote?.dueDate).toBe('2026-03-04')
    expect(await exceptionFor('blank_tax', 'bell_quote', String(QUOTE))).not.toBeNull()

    // The staged siblings the line transform reads.
    await stage('stg_bell_fixture_per_quote', 1, {
      id: '1',
      fixtureid: String(FIXTURE),
      quoteid: String(QUOTE),
      fixturename: `Troffer as quoted ${marker}`,
      sortorder: '1',
    })
    await stage('stg_bell_fixture_parts_per_quote', 1, {
      id: '1',
      partno: `led-${marker}`,
      quoteid: String(QUOTE),
      fixtureid: String(FIXTURE),
      markup: '1.2',
      parttype: 'Lamp',
      part_ratio_perfixture: '2',
    })
    // A second spelling of the same part on the same quote line: stored once.
    await stage('stg_bell_fixture_parts_per_quote', 2, {
      id: '2',
      partno: PART,
      quoteid: String(QUOTE),
      fixtureid: String(FIXTURE),
      markup: '1.3',
      parttype: 'Lamp',
      part_ratio_perfixture: '2',
    })
    for (const [rowNo, room, order] of [
      [1, ROOM_B, '1'],
      [2, ROOM_A, '2'],
      [3, ROOM_A, '3'],
    ] as const) {
      await stage('stg_bell_quote_fixtures', rowNo, {
        id: String(rowNo),
        roomid: String(room),
        fixtureid: String(FIXTURE),
        totalfixtures: '4',
        quoteid: String(QUOTE),
        sortorder: order,
      })
    }
    // Room B comes first in the legacy sort order, so it is the quote's first room.
    await transform('bell_quote_fixtures', `${marker}-f1`, {
      id: `${base + 10}`,
      roomid: String(ROOM_B),
      fixtureid: String(FIXTURE),
      totalfixtures: '4',
      quoteid: String(QUOTE),
      sortorder: '1',
    })
    await transform('bell_quote_fixtures', `${marker}-f2`, {
      id: `${base + 11}`,
      roomid: String(ROOM_A),
      fixtureid: String(FIXTURE),
      totalfixtures: '4',
      quoteid: String(QUOTE),
      sortorder: '2',
    })
    // An empty form slot: the room is kept, no line is made, the decision is recorded.
    await transform('bell_quote_fixtures', `${marker}-f3`, {
      id: `${base + 12}`,
      roomid: String(ROOM_A),
      fixtureid: '0',
      totalfixtures: '',
      quoteid: String(QUOTE),
      sortorder: '3',
    })
    // A line for a quote the old system deleted.
    await transform('bell_quote_fixtures', `${marker}-f4`, {
      id: `${base + 13}`,
      roomid: String(ROOM_A),
      fixtureid: String(FIXTURE),
      totalfixtures: '1',
      quoteid: String(GONE_QUOTE),
      sortorder: '1',
    })

    const quoteId = quote!.id
    const rooms = await db.select().from(bellQuoteRooms).where(eq(bellQuoteRooms.quoteId, quoteId))
    expect(rooms.sort((a, b) => a.sortOrder - b.sortOrder).map((room) => room.roomName)).toEqual([
      `Office ${marker}`,
      `Hall ${marker}`,
    ])
    const lines = await db.select().from(bellQuoteFixtures).where(eq(bellQuoteFixtures.quoteId, quoteId))
    expect(lines).toHaveLength(2)
    // The name the quote was saved with beats today's master name.
    expect(lines.every((line) => line.fixtureName === `Troffer as quoted ${marker}`)).toBe(true)
    const lineParts = await db
      .select()
      .from(bellQuoteFixtureParts)
      .where(eq(bellQuoteFixtureParts.quoteFixtureId, lines[0]!.id))
    expect(lineParts.map((part) => part.partNo)).toEqual([PART])
    expect(await exceptionFor('not_migrated', 'bell_quote_fixture', `${marker}-f3`)).not.toBeNull()
    expect(await exceptionFor('orphan_line', 'bell_quote_fixture', `${marker}-f4`)).not.toBeNull()

    // Prices, parts, special parts.
    await transform('bell_prices_per_quote', `${marker}-pr1`, {
      id: '1',
      quoteid: String(QUOTE),
      partno: `led-${marker}`,
      price: '12.5',
      last_price: '11',
    })
    await transform('bell_prices_per_quote', `${marker}-pr2`, {
      id: '2',
      quoteid: String(QUOTE),
      partno: PART,
      price: '99',
      last_price: '',
    })
    await transform('bell_prices_per_quote', `${marker}-pr3`, {
      id: '3',
      quoteid: String(GONE_QUOTE),
      partno: 'X',
      price: '1',
      last_price: '',
    })
    const prices = await db.select().from(bellQuotePrices).where(eq(bellQuotePrices.quoteId, quoteId))
    expect(prices).toHaveLength(1)
    expect(prices[0]).toMatchObject({ partNo: PART, price: '12.50', previousPrice: '11.00', source: 'imported' })
    expect(await exceptionFor('duplicate_master_name', 'bell_quote_price', `${marker}-pr2`)).not.toBeNull()
    expect(await exceptionFor('orphan_line', 'bell_quote_price', `${marker}-pr3`)).not.toBeNull()

    await transform('bell_quote_parts', `${marker}-qp1`, {
      id: '1',
      quoteid: String(QUOTE),
      partno: `led-${marker}`,
      qty: '8',
      without_markup_qty: '',
      price: '12.5',
      sortorder: '1',
    })
    const [part] = await db.select().from(bellQuoteParts).where(eq(bellQuoteParts.quoteId, quoteId))
    // No without-markup quantity: the quantity is used, and it is recorded.
    expect(part).toMatchObject({ qtyWithMarkup: '8.000', qtyWithoutMarkup: '8.000', unitPrice: '12.50', origin: 'legacy' })
    expect(part?.lineSubtotal).toBe('100.00')
    expect(await exceptionFor('blank_money', 'bell_quote_part', `${marker}-qp1`)).not.toBeNull()

    await transform('bell_quote_soparts', `${marker}-sp1`, {
      id: '1',
      quoteid: String(QUOTE),
      name: 'Rental lift',
      qty: '2',
      price: '75',
      sortorder: '1',
    })
    const [special] = await db.select().from(bellQuoteSpecialParts).where(eq(bellQuoteSpecialParts.quoteId, quoteId))
    expect(special).toMatchObject({ name: 'Rental lift', unitPrice: '75.00', lineSubtotal: '150.00' })

    // Revisions keep their JSON when it is JSON, and say so when it is not.
    await transform('bell_quote_revisions', `${marker}-r1`, {
      revision_id: `${base + 20}`,
      quoteid: String(QUOTE),
      created_time: '2025-02-03 10:31:00',
      revision_type: 'INSERT QUOTE',
      data_quote: '{"id": 1}',
      data_fixtures: '[{"fixtureid": 1}]',
      data_parts: '[]',
      data_soparts: 'not json',
    })
    const [revision] = await db.select().from(bellQuoteRevisions).where(eq(bellQuoteRevisions.quoteId, quoteId))
    expect(revision?.revisionType).toBe('insert')
    expect(revision?.dataQuote).toEqual({ id: 1 })
    expect(revision?.dataFixtures).toEqual([{ fixtureid: 1 }])
    expect(revision?.dataSpecialParts).toEqual([{ raw: 'not json' }])
    const bad = await exceptionFor('unparseable_json', 'bell_quote_revision', `${marker}-r1`)
    expect(bad?.notes).toContain('data_soparts')

    await transform('bell_quote_downloads', `${marker}-d1`, {
      id: '1',
      quoteid: String(QUOTE),
      filename: 'quote.pdf',
      downloadbyname: 'Ann',
      foldername: '',
      datecreated: '2025-02-04 09:00:00',
      download_revision_notes: '',
    })
    const [download] = await db.select().from(bellQuoteDownloads).where(eq(bellQuoteDownloads.quoteId, quoteId))
    expect(download).toMatchObject({ fileName: 'quote.pdf', downloadedByName: 'Ann', folderName: null })

    await transform('bell_foot_candle_readings', `${marker}-fc1`, {
      id: '1',
      quoteid: String(QUOTE),
      fr_reading: '10',
      sortorder: '1',
    })
    const [reading] = await db
      .select()
      .from(bellFootCandleReadings)
      .where(eq(bellFootCandleReadings.quoteId, quoteId))
    expect(reading?.frReading).toBe('10')
  }, 120_000)

  test('a second run does not double rows, and an edited quote is not overwritten', async () => {
    const db = getDb()
    const before = await quoteRow()
    expect(before).toBeDefined()
    // The quote is edited in the app.
    await db.update(bellQuotes).set({ version: 2, notes: 'edited in the app' }).where(eq(bellQuotes.id, before!.id))
    await transform('bell_quote', String(QUOTE), {
      id: String(QUOTE),
      status: '4',
      notes: 'from the source',
      total_amount: '5.00',
    })
    const after = await quoteRow()
    expect(after?.notes).toBe('edited in the app')
    expect(after?.status).toBe(3)

    // A child row that is mapped is not inserted again.
    await transform('bell_quote_downloads', `${marker}-d1`, {
      id: '1',
      quoteid: String(QUOTE),
      filename: 'quote.pdf',
      downloadbyname: 'Ann',
      foldername: '',
      datecreated: '2025-02-04 09:00:00',
      download_revision_notes: '',
    })
    const downloads = await db.select().from(bellQuoteDownloads).where(eq(bellQuoteDownloads.quoteId, before!.id))
    expect(downloads).toHaveLength(1)
  }, 60_000)

  test('the rows folded into quote lines are one recorded decision', async () => {
    await transform('bell_fixture_per_quote', 'bell_fixture_per_quote', { id: '1' })
    const folded = await exceptionFor('not_migrated', 'bell_fixture_per_quote', 'bell_fixture_per_quote')
    expect(folded?.migrationAction).toContain('folded into bell_quote_fixtures')
    await getDb()
      .delete(migrationExceptions)
      .where(
        and(
          eq(migrationExceptions.entity, 'bell_fixture_per_quote'),
          eq(migrationExceptions.sourceKey, 'bell_fixture_per_quote'),
        ),
      )
  })

  test('the unmapped record names what has no home, and an unknown table is refused', async () => {
    expect(transformer.unmapped?.['bell_quote.createdby']).toContain('legacy user')
    await expect(
      transform('bell_nonexistent', '1', { id: '1' }),
    ).rejects.toThrow(/no handler/)
  })
})
