/**
 * "Does this row exist in `app`?" without asking the database twice.
 *
 * Every transformer confirms a resolved parent (a site, a subcontractor, a work
 * order) with `select id from <table> where id = ?`. Over a network that is one
 * round trip per row for an answer that is the same for every row sharing the
 * parent. A positive answer is remembered for the life of one entity's run;
 * a miss is never remembered, so a parent created later is still found.
 *
 * The memo is cleared when an entity starts (and before every unit-test row),
 * so it can only ever be as stale as one table's transform.
 */
import { eq, getTableName } from 'drizzle-orm'
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { Tx } from '@cls/db'

const seen = new Set<string>()

export function clearExistsMemo(): void {
  seen.clear()
}

/** Drop-in for `tx.select({ id }).from(table).where(eq(id, value)).limit(1)`. */
export async function selectIdMemo<C extends AnyPgColumn>(
  tx: Tx,
  column: C,
  id: C['_']['data'],
): Promise<Array<{ id: C['_']['data'] }>> {
  const table = column.table as PgTable
  const key = `${getTableName(table)}\u0000${String(id)}`
  if (seen.has(key)) return [{ id }]
  const rows = (await tx.select({ id: column }).from(table).where(eq(column, id)).limit(1)) as Array<{
    id: C['_']['data']
  }>
  if (rows.length > 0) seen.add(key)
  return rows
}
