import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '@cls/db'
import { committedStagingDdl, stagingDdl } from './ddl'
import { ALL_TABLES, SKIPPED_DATED_DUPLICATES, stagingTable } from './manifest'
import { databaseConfigured } from './testing'

describe('staging DDL', () => {
  it('matches the manifest exactly', () => {
    expect(committedStagingDdl()).toBe(stagingDdl())
  })

  it('creates one all-text table per manifest table', () => {
    const ddl = stagingDdl()
    const created = [...ddl.matchAll(/CREATE TABLE IF NOT EXISTS "migration"\."(stg_[a-z0-9_]+)"/g)].map(
      (match) => match[1],
    )
    expect(new Set(created)).toEqual(new Set(ALL_TABLES.map((table) => stagingTable(table.table))))
    expect(created.length).toBe(ALL_TABLES.length)
  })

  it('never stages a dated duplicate', () => {
    const ddl = stagingDdl()
    for (const table of SKIPPED_DATED_DUPLICATES) {
      expect(ddl).not.toContain(`"${stagingTable(table)}"`)
      expect(ddl).toContain(`-- skipped: ${table}`)
    }
  })

  it('keeps every legacy column, including the ones we do not map', () => {
    const ddl = stagingDdl()
    expect(ddl).toContain('"password" text')
    expect(ddl).toContain('"mailing_password" text')
    expect(ddl).toContain('"subid" text')
  })
})

describe.skipIf(!databaseConfigured())('staging tables in the database', () => {
  it('exist for every manifest table', async () => {
    const db = getDb()
    const rows = (await db.execute(sql`
      select table_name from information_schema.tables
      where table_schema = 'migration' and table_name like 'stg_%'
    `)) as unknown as Array<{ table_name: string }>
    const present = new Set(rows.map((row) => row.table_name))
    const missing = ALL_TABLES.map((table) => stagingTable(table.table)).filter(
      (table) => !present.has(table),
    )
    expect(missing).toEqual([])
  }, 30_000)
})
