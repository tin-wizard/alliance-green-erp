/**
 * Group 11 mapping rules.
 *
 * The interesting decisions here are the ones the legacy data cannot answer: a
 * status outside the target's check list, a fixture part whose master row was
 * never migrated, and a table (`tjx_quote_fixtures`) that has no honest target at
 * all. Each of those is a recorded decision, not a guess.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb, type Tx } from '@cls/db'
import {
  migrationExceptions,
  migrationRowMap,
  tjxFixtureParts,
  tjxQuoteRevisions,
  tjxQuotes,
} from '@cls/db/schema'
import { runTransformerRow, databaseConfigured } from '../testing'
import { transformer } from './tjx'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 })

const db = getDb()
const RUN = `g11-${Date.now()}-${Math.floor(Math.random() * 100_000)}`
// Legacy ids the real dump never issues, so a loaded room or fixture cannot collide.
const ID_BASE = 2_100_000_000 + Math.floor(Math.random() * 40_000_000)
const ROOM_ID = String(ID_BASE)
const FIXTURE_ID = String(ID_BASE + 1)
const QUOTE_FIXTURE_ID = String(ID_BASE + 2)
const GROUP = 'tjx'
const QUOTE_ID_BASE = 9_600_000 + Math.floor(Math.random() * 10_000)

const parentKeys: string[] = []
const POLICY_SKIP_KEYS = ['tjx_quote_lastused_sharedpart:all']

function key(name: string): string {
  return `${RUN}-${name}`
}

function nextQuoteId(): string {
  const id = String(QUOTE_ID_BASE + parentKeys.length + 1)
  parentKeys.push(id)
  return id
}

async function inTransaction(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await db.transaction(async (tx) => {
    await fn(tx)
  })
}

async function exceptionsFor(sourceKey: string) {
  return db
    .select()
    .from(migrationExceptions)
    .where(eq(migrationExceptions.sourceKey, sourceKey))
}

async function targetKey(sourceKey: string): Promise<string | null> {
  const [row] = await db
    .select({ targetKey: migrationRowMap.targetKey })
    .from(migrationRowMap)
    .where(eq(migrationRowMap.sourceKey, sourceKey))
    .limit(1)
  return row?.targetKey ?? null
}

afterAll(async () => {
  const deleteKeys = [...parentKeys, ...POLICY_SKIP_KEYS]
  // Parents are keyed by their legacy id, exactly as the runner stages them, so
  // the crosswalk — not a run prefix — is what finds them again.
  await db.execute(sql`
    delete from app.tjx_quotes where id in (
      select target_key::int from migration.row_map
      where target_table = 'tjx_quotes'
        and (source_key like ${`${RUN}-%`} or ${inArray(migrationRowMap.sourceKey, deleteKeys)})
    )`)
  await db.execute(sql`
    delete from app.tjx_fixture_parts where id in (
      select target_key::int from migration.row_map
      where target_table = 'tjx_fixture_parts' and source_key like ${`${RUN}-%`}
    )`)
  await db.execute(sql`
    delete from app.tjx_quote_rooms where id in (
      select target_key::int from migration.row_map
      where target_table = 'tjx_quote_rooms' and source_key like ${`${RUN}-%`}
    )`)
  await db.execute(sql`
    delete from app.tjx_fixtures where id in (
      select target_key::int from migration.row_map
      where target_table = 'tjx_fixtures' and source_key like ${`${RUN}-%`}
    )`)
  await db.execute(sql`
    delete from app.tjx_room_template_rooms where room_id in (
      select target_key::int from migration.row_map
      where target_table = 'tjx_rooms' and source_key like ${`${RUN}-%`}
    )`)
  await db.execute(sql`
    delete from app.tjx_rooms where id in (
      select target_key::int from migration.row_map
      where target_table = 'tjx_rooms' and source_key like ${`${RUN}-%`}
    )`)
  await db
    .delete(migrationRowMap)
    .where(sql`${migrationRowMap.sourceKey} like ${`${RUN}-%`} or ${inArray(migrationRowMap.sourceKey, deleteKeys)}`)
  await db
    .delete(migrationExceptions)
    .where(
      sql`${migrationExceptions.sourceKey} like ${`${RUN}-%`} or ${inArray(migrationExceptions.sourceKey, deleteKeys)}`,
    )
})

describe.skipIf(!databaseConfigured())(`${GROUP} transformer`, () => {
  it('maps a quote with its raw status and both total triplets', async () => {
    const quoteId = nextQuoteId()
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'tjx_quote',
        sourceKey: quoteId,
        row: {
          id: quoteId,
          status: '4',
          payment_terms: '1',
          ceiling_grid_type: '2',
          quote_type: 'Gen 1',
          appliedtaxrate: '0.13',
          subtotal_amount: '100.00',
          tax_amount: '13.00',
          total_amount: '113.00',
          withoutmarkup_subtotal_amount: '90.00',
          withoutmarkup_tax_amount: '11.70',
          withoutmarkup_total_amount: '101.70',
          due_date: '2025-02-15',
          date_created: '2025-01-02 09:00:00',
          notes: 'fixture program',
        },
      }),
    )

    const [row] = await db
      .select()
      .from(tjxQuotes)
      .where(eq(tjxQuotes.id, Number(await targetKey(quoteId))))
    expect(row?.legacyId).toBe(Number(quoteId))
    expect(row?.status).toBe(4)
    expect(row?.paymentTermsCode).toBe(1)
    expect(row?.ceilingGridType).toBe(2)
    expect(row?.appliedTaxRate).toBe('0.13000')
    expect(row?.subtotalAmount).toBe('100.00')
    expect(row?.totalAmount).toBe('113.00')
    expect(row?.withoutMarkupTotalAmount).toBe('101.70')
    expect(row?.dueDate).toBe('2025-02-15')
    expect(row?.importedAt).not.toBeNull()
    // 09:00 Toronto on 2 January is 14:00 UTC: the wall clock is preserved.
    expect(row?.createdAt.toISOString()).toBe('2025-01-02T14:00:00.000Z')
  })

  it('does not invent a status outside the target check list', async () => {
    const sourceKey = key('quote-bad-status')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'tjx_quote',
        sourceKey,
        row: { id: '999', status: '9', subtotal_amount: '1.00', total_amount: '1.00' },
      }),
    )

    expect(await targetKey(sourceKey)).toBeNull()
    const exceptions = await exceptionsFor(sourceKey)
    expect(exceptions.map((row) => row.exceptionClass)).toContain('unknown_enum')
  })

  it('records one policy skip per unmapped table, not one per row', async () => {
    for (const id of ['1', '2', '3']) {
      await inTransaction((tx) =>
        runTransformerRow(tx, transformer, {
          group: GROUP,
          table: 'tjx_quote_lastused_sharedpart',
          sourceKey: key(`shared-${id}`),
          row: { quoteid: '5', used_partcode: 'A1', main_partcode: 'A0' },
        }),
      )
    }

    const rows = await db
      .select()
      .from(migrationExceptions)
      .where(
        and(
          eq(migrationExceptions.exceptionClass, 'not_migrated'),
          eq(migrationExceptions.sourceKey, 'tjx_quote_lastused_sharedpart:all'),
        ),
      )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.entity).toBe('tjx_quote_last_used_shared_part')
    expect(Number(rows[0]?.rowCount)).toBeGreaterThan(0)
    expect(rows[0]?.notes).toContain('editor')
  })

  it('reports a fixture part whose master fixture was not migrated', async () => {
    const sourceKey = key('fixture-part')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'tjx_fixture_parts',
        sourceKey,
        row: { id: '7001', fixtureid: '424242', partno: `${RUN}-FP`, markup: '1.5', parttype: 'Lamp' },
      }),
    )

    expect(await targetKey(sourceKey)).toBeNull()
    const exceptions = await exceptionsFor(sourceKey)
    expect(exceptions.map((row) => row.exceptionClass)).toContain('orphan_line')
    const rows = await db
      .select()
      .from(tjxFixtureParts)
      .where(eq(tjxFixtureParts.partNo, `${RUN}-FP`))
    expect(rows).toHaveLength(0)
  })

  it('maps a second room with the same name onto the first, and quotes still find it', async () => {
    const name = `${RUN} Utility Rooms`
    const firstLegacy = String(ID_BASE + 10)
    const secondLegacy = String(ID_BASE + 11)
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'tjx_room',
        sourceKey: key('room-a'),
        row: { id: firstLegacy, roomname: name, sortorder: '1' },
      }),
    )
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'tjx_room',
        sourceKey: key('room-b'),
        // Same name, different case and spacing: still one room.
        row: { id: secondLegacy, roomname: `  ${name.toUpperCase()}  `, sortorder: '2' },
      }),
    )
    const first = await targetKey(key('room-a'))
    expect(first).not.toBeNull()
    expect(await targetKey(key('room-b'))).toBe(first)
    const classes = (await exceptionsFor(key('room-b'))).map((row) => row.exceptionClass)
    expect(classes).toContain('duplicate_master_name')
    const rooms = await db.execute(
      sql`select count(*)::int as n from app.tjx_rooms where lower(name) = lower(${name})`,
    ) as unknown as Array<{ n: number }>
    expect(rooms[0]?.n).toBe(1)
  })

  it('a repeated room-template entry is skipped and recorded, not an error', async () => {
    const legacyRoom = String(ID_BASE + 10)
    for (const name of ['tpl-1', 'tpl-2']) {
      await inTransaction((tx) =>
        runTransformerRow(tx, transformer, {
          group: GROUP,
          table: 'tjx_rooms_template',
          sourceKey: key(name),
          row: { roomid: legacyRoom, sortorder: '5' },
        }),
      )
    }
    expect(await targetKey(key('tpl-1'))).not.toBeNull()
    const classes = (await exceptionsFor(key('tpl-2'))).map((row) => row.exceptionClass)
    expect(classes).toContain('dated_duplicate_skipped')
  })

  it('rebuilds a quote room from the room master and keeps the fixture quantity', async () => {
    const quoteId = nextQuoteId()
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'tjx_quote',
        sourceKey: quoteId,
        row: { id: quoteId, status: '1', subtotal_amount: '0', total_amount: '0' },
      }),
    )

    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'tjx_room',
        sourceKey: key('room-1'),
        row: { id: ROOM_ID, roomname: `${RUN} Suite`, sortorder: '1' },
      }),
    )
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'tjx_fixture',
        sourceKey: key('fixture-1'),
        row: { id: FIXTURE_ID, fixturename: `${RUN} Troffer`, sortorder: '1' },
      }),
    )

    const fixtureRowKey = key('quote-fixture-1')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'tjx_quote_fixtures',
        sourceKey: fixtureRowKey,
        row: { id: QUOTE_FIXTURE_ID, quoteid: quoteId, roomid: ROOM_ID, fixtureid: FIXTURE_ID, totalfixtures: '6' },
      }),
    )

    const quoteRoomKey = await db.execute(
      sql`select target_key from migration.row_map where entity = 'quote_room' and source_key = ${`${quoteId}:${ROOM_ID}`} limit 1`,
    ) as unknown as Array<{ target_key: string }>
    expect(quoteRoomKey).toHaveLength(1)

    const quoteFixtureTarget = await targetKey(fixtureRowKey)
    expect(quoteFixtureTarget).not.toBeNull()
    const [fixtureRow] = await db.execute(
      sql`select quote_id, quote_room_id, fixture_id, fixture_name, quantity, sort_order from app.tjx_quote_fixtures where id = ${Number(quoteFixtureTarget)}`,
    ) as unknown as Array<{
      quote_id: number
      quote_room_id: number
      fixture_id: number | null
      fixture_name: string
      quantity: string
      sort_order: number
    }>
    expect(fixtureRow?.fixture_name).toBe(`${RUN} Troffer`)
    expect(fixtureRow?.quantity).toBe('6.000')
    expect(fixtureRow?.sort_order).toBe(0)

    const [room] = await db.execute(
      sql`select room_name from app.tjx_quote_rooms where id = ${fixtureRow!.quote_room_id}`,
    ) as unknown as Array<{ room_name: string }>
    expect(room?.room_name).toBe(`${RUN} Suite`)
  })

  it('keeps a revision snapshot as JSON, even when the legacy blob is not JSON', async () => {
    const quoteId = nextQuoteId()
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'tjx_quote',
        sourceKey: quoteId,
        row: { id: quoteId, status: '1', subtotal_amount: '0', total_amount: '0' },
      }),
    )

    const revisionKey = key('revision-1')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'tjx_quote_revisions',
        sourceKey: revisionKey,
        row: {
          revision_id: '8801',
          quoteid: quoteId,
          revision_type: 'save',
          created_time: '2025-03-04 11:15:00',
          data_quote: '{"id":42}',
          data_parts: '[{"partNo":"A1"}]',
          data_soparts: 'not-json-at-all',
        },
      }),
    )

    const mapped = await targetKey(revisionKey)
    expect(mapped).not.toBeNull()
    const [row] = await db
      .select()
      .from(tjxQuoteRevisions)
      .where(eq(tjxQuoteRevisions.id, Number(mapped)))
    expect(row?.revisionType).toBe('import')
    expect(row?.dataQuote).toEqual({ id: 42 })
    expect(row?.dataParts).toEqual([{ partNo: 'A1' }])
    // Evidence is kept rather than dropping a blob we cannot parse.
    expect(row?.dataSpecialParts).toEqual([{ raw: 'not-json-at-all' }])
    expect(row?.dataRooms).toEqual([])
    expect(row?.saveSeq).toBe(8801)

    const classes = (await exceptionsFor(revisionKey)).map((entry) => entry.exceptionClass)
    expect(classes).toContain('unknown_enum')
  })
})
