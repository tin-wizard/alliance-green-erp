/**
 * Staging rows for the user-migration tests.
 *
 * The rows are inserted through the same all-text staging contract the loader
 * writes, so the planner is tested against the shape it will actually see.
 */
import { sql } from 'drizzle-orm'
import type { Db } from '@cls/db'

interface StagedUserRow {
  id: string
  username: string
  email: string | null
  isEnabled: string
  subid: string | null
}

const USERS: StagedUserRow[] = [
  { id: '9001', username: 'active', email: 'active@example.com', isEnabled: '1', subid: null },
  { id: '9002', username: 'retired', email: 'retired@example.com', isEnabled: '0', subid: null },
  { id: '9003', username: 'dupuser', email: 'dup1@example.com', isEnabled: '1', subid: null },
  { id: '9009', username: 'DUPUSER', email: 'dup2@example.com', isEnabled: '1', subid: null },
  { id: '9004', username: 'noemail', email: '  ', isEnabled: '1', subid: null },
  { id: '9005', username: 'shared1', email: 'shared@example.com', isEnabled: '1', subid: null },
  { id: '9008', username: 'shared2', email: 'Shared@Example.com', isEnabled: '1', subid: null },
  { id: '9006', username: 'novendor', email: 'novendor@example.com', isEnabled: '1', subid: '77' },
  { id: '9007', username: 'withvendor', email: 'withvendor@example.com', isEnabled: '1', subid: '88' },
]

export async function stagedUsersDump(db: Db, dumpId: string): Promise<void> {
  let rowNo = 0
  for (const row of USERS) {
    rowNo += 1
    await db.execute(sql`
      insert into migration."stg_users"
        ("_row_no", "_source_pk", "_row_hash", "_dump_id", "id", "username", "email", "is_enabled", "subid")
      values
        (${rowNo}, ${row.id}, ${`hash-${row.id}`}, ${dumpId}, ${row.id}, ${row.username}, ${row.email}, ${row.isEnabled}, ${row.subid})
    `)
  }

  // One vendor exists (88); 77 does not. The planner must tell them apart.
  await db.execute(sql`
    insert into migration."stg_subcontractor"
      ("_row_no", "_source_pk", "_row_hash", "_dump_id", "id", "name")
    values
      (1, '88', 'hash-88', ${dumpId}, '88', 'Real Vendor')
  `)
}
