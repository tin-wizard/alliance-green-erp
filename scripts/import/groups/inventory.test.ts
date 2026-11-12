/**
 * Group 9 mapping rules, pinned row by row against a real database.
 *
 * Each test commits real rows inside its own transaction, so the transformer sees
 * the same constraints and defaults the rehearsal will. Everything it creates is
 * deleted in `afterAll` through the crosswalk those rows were written with.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb, type Tx } from '@cls/db'
import {
  inventoryMovements,
  migrationExceptions,
  migrationRowMap,
  partStockAdjustments,
} from '@cls/db/schema'
import { runTransformerRow, databaseConfigured } from '../testing'
import { transformer } from './inventory'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 })

const db = getDb()
const RUN = `g9-${Date.now()}-${Math.floor(Math.random() * 100_000)}`
const GROUP = 'inventory'

function key(name: string): string {
  return `${RUN}-${name}`
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

/** The target key recorded for this run's source key, whatever the entity. */
async function targetKey(sourceKey: string): Promise<string | null> {
  const [row] = await db
    .select({ targetKey: migrationRowMap.targetKey })
    .from(migrationRowMap)
    .where(eq(migrationRowMap.sourceKey, sourceKey))
    .limit(1)
  return row?.targetKey ?? null
}

/**
 * A deliberate skip is one exception row per table, never one per source row.
 * The row is keyed by the table name so a replay upserts it instead of adding one.
 */
const POLICY_SKIP_TABLES = [
  'parts_inventory:all',
  'parts_purchased_inventory:all',
  'parts_purchasing_log:all',
  'parts_selling_log:all',
]

async function notMigratedRows(table: string) {
  return db
    .select()
    .from(migrationExceptions)
    .where(
      and(
        eq(migrationExceptions.exceptionClass, 'not_migrated'),
        eq(migrationExceptions.sourceKey, `${table}:all`),
      ),
    )
}

afterAll(async () => {
  await db.execute(sql`
    delete from app.inventory_movements where id in (
      select target_key::bigint from migration.row_map
      where target_table = 'inventory_movements' and source_key like ${`${RUN}-%`}
    )`)
  await db.execute(sql`
    delete from app.part_stock_adjustments where id in (
      select target_key::bigint from migration.row_map
      where target_table = 'part_stock_adjustments' and source_key like ${`${RUN}-%`}
    )`)
  await db.delete(migrationRowMap).where(sql`${migrationRowMap.sourceKey} like ${`${RUN}-%`}`)
  await db.delete(migrationExceptions).where(sql`${migrationExceptions.sourceKey} like ${`${RUN}-%`}`)
  // The policy skips are keyed by table name, not by this run's prefix.
  await db.delete(migrationExceptions).where(inArray(migrationExceptions.sourceKey, POLICY_SKIP_TABLES))
})

describe.skipIf(!databaseConfigured())(`${GROUP} transformer`, () => {
  it('maps a manual adjustment, keeping the wall-clock time as recorded', async () => {
    const sourceKey = key('adj-1')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'parts_inventory_adjustment',
        sourceKey,
        row: {
          id: '1',
          partno: `${RUN}-PART-A`,
          qty: '4',
          price: '$12.50',
          date_created: '2024-05-03 10:00:00',
          adjustment_type: 'global',
          notes: 'cycle count',
          is_log_deleted: '0',
          inserted_datetime: '2024-05-04 08:00:00',
          workordernumber: '',
          site: '',
          subcontractor: '',
          mass_adjustment_number: '7',
        },
      }),
    )

    const mapped = await targetKey(sourceKey)
    expect(mapped).not.toBeNull()

    const [row] = await db
      .select()
      .from(partStockAdjustments)
      .where(eq(partStockAdjustments.id, Number(mapped)))
    expect(row?.partNo).toBe(`${RUN}-PART-A`)
    expect(row?.qty).toBe('4.00')
    expect(row?.price).toBe('12.50')
    expect(row?.adjustmentType).toBe('global')
    expect(row?.notes).toBe('cycle count')
    expect(row?.isLogDeleted).toBe(false)
    expect(row?.massAdjustmentNumber).toBe(7)
    // 10:00 Toronto on 3 May is 14:00 UTC: the wall clock is preserved, not the
    // machine's timezone.
    expect(row?.createdAt.toISOString()).toBe('2024-05-03T14:00:00.000Z')
  })

  it('reports an adjustment with no quantity instead of zero-filling it', async () => {
    const sourceKey = key('adj-blank')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'parts_inventory_adjustment',
        sourceKey,
        row: { id: '2', partno: `${RUN}-PART-B`, qty: '   ', price: '', adjustment_type: 'global' },
      }),
    )

    expect(await targetKey(sourceKey)).toBeNull()
    const exceptions = await exceptionsFor(sourceKey)
    expect(exceptions.map((row) => row.exceptionClass)).toContain('blank_money')
  })

  it('is idempotent: replaying the same adjustment does not insert twice', async () => {
    const sourceKey = key('adj-repeat')
    const input = {
      group: GROUP,
      table: 'parts_inventory_adjustment',
      sourceKey,
      row: { id: '3', partno: `${RUN}-PART-C`, qty: '1', adjustment_type: 'global' },
    }
    await inTransaction((tx) => runTransformerRow(tx, transformer, input))
    await inTransaction((tx) => runTransformerRow(tx, transformer, input))

    const rows = await db
      .select()
      .from(partStockAdjustments)
      .where(eq(partStockAdjustments.partNo, `${RUN}-PART-C`))
    expect(rows).toHaveLength(1)
  })

  it('maps a sale movement with the legacy price text parsed to numeric', async () => {
    const sourceKey = key('move-sale')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'parts_salepurchase_log',
        sourceKey,
        row: {
          id: '11',
          woid_poid: '555',
          invoice_id: '',
          invoice_number: '',
          partno: `${RUN}-PART-D`,
          qty: '2',
          price: '$1,234.50',
          date_created: '2025-02-01 09:30:00',
          transaction_type: 'Sale',
          notes: 'sold on WO 555',
          is_log_deleted: '0',
          is_includeed_in_stock_management: '1',
        },
      }),
    )

    const mapped = await targetKey(sourceKey)
    const [row] = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.id, Number(mapped)))
    expect(row?.movementType).toBe('sale')
    expect(row?.transactionType).toBe('Sale')
    expect(row?.qty).toBe('2.00')
    expect(row?.price).toBe('1234.50')
    // No invoice columns, so the ambiguous woid_poid is the work-order reference.
    expect(row?.referenceType).toBe('work_order')
    expect(row?.referenceId).toBe('555')
    expect(row?.documentType).toBeNull()
    expect(row?.isIncludedInStockManagement).toBe(true)
  })

  it('refuses a ledger row whose transaction type is not a movement', async () => {
    const sourceKey = key('move-bad')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'parts_salepurchase_log',
        sourceKey,
        row: { id: '12', woid_poid: '1', partno: `${RUN}-PART-E`, qty: '1', transaction_type: 'Transfer' },
      }),
    )

    expect(await targetKey(sourceKey)).toBeNull()
    const exceptions = await exceptionsFor(sourceKey)
    expect(exceptions.map((row) => row.exceptionClass)).toContain('unknown_enum')
  })

  it('records one policy skip per unmapped table, not one per row', async () => {
    for (const id of ['21', '22', '23']) {
      await inTransaction((tx) =>
        runTransformerRow(tx, transformer, {
          group: GROUP,
          table: 'parts_selling_log',
          sourceKey: key(`sell-${id}`),
          row: { id, woid: '900', partno: `${RUN}-PART-F`, qty: '1', price: '5.00' },
        }),
      )
    }

    const rows = await notMigratedRows("parts_selling_log")
    expect(rows).toHaveLength(1)
    expect(rows[0]?.entity).toBe('part_selling_log')
    expect(Number(rows[0]?.rowCount)).toBeGreaterThan(0)
  })
})
