import { afterAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '@cls/db'
import { loadSource, rowHash, sourceKey, stagedRows, transformGroups } from './runner'
import { MANIFEST_VERSION, stagingTable } from './manifest'
import type { LegacySource, SourceTable } from './types'
import { databaseConfigured } from './testing'

const DUMP_ID = 'sha256:runner-test'
const db = getDb()

function fakeSource(tables: SourceTable[]): LegacySource {
  return {
    async listTables() {
      return tables.map((table) => table.table)
    },
    async readTable(name) {
      return tables.find((table) => table.table === name) ?? { table: name, columns: [], rows: [] }
    },
  }
}

const customerTable: SourceTable = {
  table: 'customer',
  columns: ['id', 'name', 'cname', 'cemail1'],
  rows: [
    { rowNo: 1, values: { id: '1', name: 'A & B Lighting', cname: 'Ann', cemail1: 'a@example.com' } },
    { rowNo: 2, values: { id: '2', name: 'Caf\u00e9 \u00c9clairage', cname: null, cemail1: null } },
    { rowNo: 3, values: { id: '3', name: "O'Brien", cname: "Pat", cemail1: 'b@example.com' } },
  ],
}

const usersTable: SourceTable = {
  table: 'users',
  columns: ['id', 'username', 'email'],
  rows: [
    { rowNo: 1, values: { id: '10', username: 'gene', email: 'gene@example.com' } },
    { rowNo: 2, values: { id: '11', username: 'gene', email: 'other@example.com' } },
  ],
}

describe('rowHash', () => {
  it('does not depend on column order', () => {
    expect(rowHash({ a: '1', b: '2' })).toBe(rowHash({ b: '2', a: '1' }))
  })

  it('distinguishes null from empty string', () => {
    expect(rowHash({ a: null })).not.toBe(rowHash({ a: '' }))
  })
})

describe('sourceKey', () => {
  it('uses the primary key columns from the manifest', () => {
    const table = { table: 'customer', entity: 'customer', primaryKey: ['id'], fixtureRows: 0 }
    expect(sourceKey(table, { id: '42' })).toBe('42')
  })
})

describe.skipIf(!databaseConfigured())('transformGroups', () => {
  const dumpId = 'sha256:runner-transform-test'
  const source = fakeSource([
    {
      table: 'wo_status',
      columns: ['id', 'name'],
      rows: [1, 2, 3].map((id, index) => ({
        rowNo: index + 1,
        values: { id: String(id), name: `Runner status ${id}` },
      })),
    },
  ])

  afterAll(async () => {
    await db.execute(sql`delete from migration.row_map where dump_id = ${dumpId}`)
    await db.execute(sql`delete from migration.exceptions where source_key in ('1', '2', '3') and entity = 'wo_status'`)
    await db.execute(sql`delete from migration.runs where dump_id = ${dumpId}`)
    await db.execute(sql`delete from migration.dump_objects where dump_id = ${dumpId}`)
    await db.execute(sql`delete from migration.dump_manifests where dump_id = ${dumpId}`)
    await db.execute(
      sql.raw(`delete from migration."${stagingTable('wo_status')}" where "_dump_id" = '${dumpId}'`),
    )
  })

  it('maps a group, then replays it without a second row or a new error', async () => {
    await loadSource(db, source, dumpId)
    const first = await transformGroups(db, { dumpId, groups: ['lookups'], gitSha: 'test' })
    const second = await transformGroups(db, {
      dumpId,
      groups: ['lookups'],
      gitSha: 'test',
      phase: 'verify',
    })

    expect(first[0]?.status).toBe('passed')
    expect(second[0]?.status).toBe('passed')
    const entity = first[0]?.entities.find((entry) => entry.entity === 'wo_status')
    expect(entity).toMatchObject({ sourceRows: 3, transformed: 3, errors: 0 })

    const mapped = (await db.execute(
      sql`select count(*)::int as value from migration.row_map where entity = 'wo_status' and dump_id = ${dumpId}`,
    )) as unknown as Array<{ value: number }>
    expect(Number(mapped[0]?.value)).toBe(3)

    const runs = (await db.execute(
      sql`select phase, status from migration.runs where dump_id = ${dumpId} order by started_at`,
    )) as unknown as Array<{ phase: string; status: string }>
    expect(runs.map((run) => run.phase)).toEqual(['transform', 'verify'])
    expect(runs.every((run) => run.status === 'passed')).toBe(true)
  }, 60_000)
})

describe.skipIf(!databaseConfigured())('loadSource', () => {
  afterAll(async () => {
    for (const table of ['customer', 'users']) {
      await db.execute(sql.raw(`delete from migration."${stagingTable(table)}" where "_dump_id" = '${DUMP_ID}'`))
    }
    await db.execute(sql`delete from migration.dump_objects where dump_id = ${DUMP_ID}`)
    await db.execute(sql`delete from migration.dump_manifests where dump_id = ${DUMP_ID}`)
  })

  it('stages every row as text, twice, with the same checksum', async () => {
    const source = fakeSource([customerTable, usersTable])
    const first = await loadSource(db, source, DUMP_ID)
    const second = await loadSource(db, source, DUMP_ID)

    expect(first.totalRows).toBe(5)
    expect(second.totalRows).toBe(5)

    const byTable = new Map(first.tables.map((table) => [table.table, table]))
    const byTableAgain = new Map(second.tables.map((table) => [table.table, table]))
    expect(byTableAgain.get('customer')?.checksum).toBe(byTable.get('customer')?.checksum)
    expect(byTable.get('customer')?.rows).toBe(3)

    const rows = await stagedRows(db, 'customer', DUMP_ID)
    expect(rows).toHaveLength(3)
    // Reload replaces, never appends.
    expect(rows.map((row) => row._row_no)).toEqual([1, 2, 3])
    expect(rows[0]?.cname).toBe('Ann')
    expect(rows[1]?.cemail1).toBeNull()
    expect(rows[1]?.name).toBe('Caf\u00e9 \u00c9clairage')
    expect(rows[2]?.name).toBe("O'Brien")
    expect(rows[0]?._source_pk).toBe('1')
  }, 30_000)

  it('never stages legacy credentials, but still hashes the real value', async () => {
    const secretUsers: SourceTable = {
      table: 'users',
      columns: ['id', 'username', 'password', 'mailing_password', 'cls_mailing_password'],
      rows: [
        { rowNo: 1, values: { id: '10', username: 'gene', password: 'a3f1md5placeholder', mailing_password: 'smtp-secret', cls_mailing_password: 'smtp-secret-2' } },
      ],
    }
    const first = await loadSource(db, fakeSource([secretUsers]), DUMP_ID)
    const [row] = await stagedRows(db, 'users', DUMP_ID)
    expect(row?.username).toBe('gene')
    expect(row?.password).toBeNull()
    expect(row?.mailing_password).toBeNull()
    expect(row?.cls_mailing_password).toBeNull()

    // The checksum comes from the real values, so a changed password is still a changed dump.
    const changed = { ...secretUsers, rows: [{ rowNo: 1, values: { ...secretUsers.rows[0]!.values, password: 'different' } }] }
    const second = await loadSource(db, fakeSource([changed]), DUMP_ID)
    expect(second.tables.find((t) => t.table === 'users')?.checksum).not.toBe(
      first.tables.find((t) => t.table === 'users')?.checksum,
    )
  }, 30_000)

  it('records the manifest version and per-table object rows', async () => {
    const source = fakeSource([customerTable, usersTable])
    await loadSource(db, source, DUMP_ID)
    const objects = (await db.execute(
      sql`select table_name, status, checksum, staged_rows from migration.dump_objects where dump_id = ${DUMP_ID} and status = 'loaded' order by table_name`,
    )) as unknown as Array<{ table_name: string; status: string; checksum: string; staged_rows: number }>
    expect(objects.map((row) => row.table_name)).toEqual(['customer', 'users'])
    expect(objects.every((row) => row.status === 'loaded')).toBe(true)
    expect(objects.every((row) => row.checksum.length === 64)).toBe(true)

    const manifests = (await db.execute(
      sql`select manifest_version from migration.dump_manifests where dump_id = ${DUMP_ID}`,
    )) as unknown as Array<{ manifest_version: string }>
    expect(manifests[0]?.manifest_version).toBe(MANIFEST_VERSION)
  }, 30_000)
})
