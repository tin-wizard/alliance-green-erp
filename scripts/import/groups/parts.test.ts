/**
 * Group 4 — parts and rate cards.
 *
 * Pinned here: the business key keeps its case, blank money is NULL, a rate row
 * with no part is an orphan line, and the work-order allocator is seeded above both
 * the legacy counter and the highest migrated number.
 */
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { getDb } from '@cls/db'
import { getConfig } from '@cls/core/env.server'
import {
  migrationExceptions,
  migrationRowMap,
  partGroups,
  partPriceHistory,
  parts,
  partSellingRates,
  partSupplierRates,
  sharedParts,
  workOrderNumberSeries,
  partSupplierModelRates,
} from '@cls/db/schema'
import { runTransformerRow } from '../testing'
import { transformer } from './parts'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

const configured = (() => {
  try {
    return Boolean(getConfig().databaseUrl)
  } catch {
    return false
  }
})()

const marker = `ps${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const dumpId = `test-dump-${marker}`

const base = 2_050_000_000 + Math.floor(Math.random() * 900_000)
const partId = base
const duplicatePartId = base + 1
const groupId = base + 2
const missingPartId = base + 3
const modelRateId = base + 4
const partNumber = `TEST-${marker}-AB`
const sharedPartCode = `SH-${marker}`
const stagedWorkOrderId = 5_500

let seriesBefore: { nextId: number; description: string } | null = null

async function transform(table: string, sourceKey: string, row: Record<string, string | null>) {
  await getDb().transaction(async (tx) => {
    await runTransformerRow(tx, transformer, { group: 'parts', table, sourceKey, row, dumpId })
  })
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

async function crosswalkFor(entity: string, sourceKey: string) {
  const [row] = await getDb()
    .select()
    .from(migrationRowMap)
    .where(and(eq(migrationRowMap.entity, entity), eq(migrationRowMap.sourceKey, sourceKey)))
    .limit(1)
  return row ?? null
}

afterAll(async () => {
  if (!configured) return
  const db = getDb()
  await db.delete(partSupplierRates).where(eq(partSupplierRates.partId, partId))
  await db.delete(partSellingRates).where(eq(partSellingRates.partId, partId))
  await db.delete(partSupplierModelRates).where(eq(partSupplierModelRates.id, modelRateId))
  await db.delete(partPriceHistory).where(eq(partPriceHistory.partId, partId))
  await db.delete(parts).where(inArray(parts.id, [partId, duplicatePartId]))
  await db.delete(partGroups).where(eq(partGroups.id, groupId))
  await db.delete(sharedParts).where(eq(sharedParts.partCode, sharedPartCode))
  await db.execute(sql`delete from migration."stg_workorder" where "_dump_id" = ${dumpId}`)
  await db.delete(migrationRowMap).where(like(migrationRowMap.sourceKey, `%${marker}%`))
  await db.delete(migrationExceptions).where(like(migrationExceptions.sourceKey, `%${marker}%`))
  if (seriesBefore) {
    // The series is global state; leave it exactly as this test found it.
    await db
      .update(workOrderNumberSeries)
      .set({
        nextId: seriesBefore.nextId,
        description: seriesBefore.description,
        updatedAt: new Date(),
      })
      .where(eq(workOrderNumberSeries.id, 2))
  }
})

describe.skipIf(!configured)('parts group', () => {
  test('a part keeps its number exactly and parses money', async () => {
    const sourceKey = `parts:${marker}:${partId}`
    await transform('parts', sourceKey, {
      id: String(partId),
      number: `  ${partNumber}  `,
      name: 'LED panel 2x4',
      cost: '$1,234.50',
      sell_price: '   ',
      sage_id: '8811',
      part_group_id: String(groupId),
      warranty: '3 years',
      labor_warranty: '90 days',
      purchased_quantity: '10.00',
      current_quantity: '7.50',
      sold_quantity: '2.50',
      installcostperunit: '12',
      install_profit_formula: 'cost*1.2',
      recycle_profit_formula: 'cost*0.5',
      saved_sage_price: '1.00',
      is_sage_saved: '1',
      part_popup_notes: 'Fragile',
      parent_partnumber: 'PARENT-1',
      cls_linked_partcode: 'CLS-9',
      active_in_sage: '1',
      subignore: '1',
      defaultsortorder: '4',
    })

    const [row] = await getDb().select().from(parts).where(eq(parts.id, partId))
    // Trim only: the case the user typed is the display value.
    expect(row?.partNumber).toBe(partNumber)
    expect(row?.cost).toBe('1234.50')
    // Blank money is NULL, never zero-filled.
    expect(row?.sellPrice).toBeNull()
    // Counters are copied exactly; the ledger drift is not corrected here.
    expect(row?.currentQuantity).toBe('7.50')
    expect(row?.purchasedQuantity).toBe('10.00')
    expect(row?.soldQuantity).toBe('2.50')
    expect(row?.installCostPerUnit).toBe('12.00')
    expect(row?.activeInSage).toBe(true)
    expect(row?.subignore).toBe(true)
    expect(row?.sageItemId).toBe(8811)
    expect(row?.notes).toBe('Fragile')

    expect((await crosswalkFor('part', sourceKey))?.targetKey).toBe(String(partId))
  })

  test('a part with no number is reported, not inserted', async () => {
    const sourceKey = `parts:${marker}:${missingPartId}`
    await transform('parts', sourceKey, {
      id: String(missingPartId),
      number: '   ',
      name: 'Nameless',
    })

    expect(await exceptionFor('unresolved_part_line', 'part', sourceKey)).not.toBeNull()
    const rows = await getDb().select().from(parts).where(eq(parts.id, missingPartId))
    expect(rows).toHaveLength(0)
  })

  test('two legacy rows claiming one part number fail loudly', async () => {
    await expect(
      transform('parts', `parts:${marker}:${duplicatePartId}`, {
        id: String(duplicatePartId),
        number: partNumber,
        name: 'Copycat',
      }),
    ).rejects.toThrow(/already belongs to part/)
  })

  test('a part group keeps its winner flag and sort order', async () => {
    await transform('parts_group', `parts_group:${marker}:${groupId}`, {
      id: String(groupId),
      name: `Group ${marker}`,
      sort_id: '3',
      is_winner: '1',
    })

    const [row] = await getDb().select().from(partGroups).where(eq(partGroups.id, groupId))
    expect(row?.name).toBe(`Group ${marker}`)
    expect(row?.sortOrder).toBe(3)
    expect(row?.isWinner).toBe(true)
  })

  test('a selling rate with no part is an orphan line', async () => {
    const sourceKey = `parts_selling_rates:${marker}:1`
    await transform('parts_selling_rates', sourceKey, {
      id: '1',
      part_code: `NOPE-${marker}`,
      list_id: '1',
      old_sell_price: '10.00',
      increase_percentage: '5',
      sell_price: '10.50',
      install_price: null,
      recycle_price: null,
      date_inserted: '2026-01-01 10:11:12',
    })

    expect(await exceptionFor('orphan_line', 'part_selling_rate', sourceKey)).not.toBeNull()
    const rows = await getDb()
      .select()
      .from(partSellingRates)
      .where(eq(partSellingRates.partId, partId))
    expect(rows).toHaveLength(0)
  })

  test('a supplier rate finds its part case-insensitively and prefers the parsed cost', async () => {
    const sourceKey = `parts_supplier_rates:${marker}:1`
    // Lower case on purpose: `parts.number` keeps its case, lookups do not.
    await transform('parts_supplier_rates', sourceKey, {
      id: '1',
      part_code: partNumber.toLowerCase(),
      list_id: '7',
      supplier_id: '42',
      sub_supplier_id: null,
      cost_price: '$99.99',
      cost_price_decimal: '88.50',
      last_cost_price: '80',
      date_inserted: '2026-02-03 08:00:00',
      markup: '12.5',
      sell_price: '100.00',
      last_sell_price: '95.00',
      install_price: '5.00',
      recycle_price: null,
      default_rate: '1',
      model_number_1: 'M1',
      model_number_2: null,
      model_number_3: null,
      supplier_warranty: '1 year',
    })

    const [row] = await getDb()
      .select()
      .from(partSupplierRates)
      .where(eq(partSupplierRates.partId, partId))
    expect(row).toBeDefined()
    expect(row?.costPrice).toBe('88.50')
    expect(row?.lastCostPrice).toBe('80.00')
    expect(row?.markup).toBe('12.50')
    expect(row?.defaultRate).toBe(true)
    expect(row?.modelNumber1).toBe('M1')
    expect(row?.dateInserted.toISOString()).toBe('2026-02-03T08:00:00.000Z')

    // Replaying the same source row updates it instead of adding a second one.
    await transform('parts_supplier_rates', sourceKey, {
      id: '1',
      part_code: partNumber,
      cost_price_decimal: '91.00',
    })
    const rows = await getDb()
      .select()
      .from(partSupplierRates)
      .where(eq(partSupplierRates.partId, partId))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.costPrice).toBe('91.00')
  })

  test('price history attaches to its part and refuses a missing one', async () => {
    const sourceKey = `parts_price_history:${marker}:1`
    await transform('parts_price_history', sourceKey, {
      id: '1',
      price_id: String(partId),
      field_name: 'sell_price',
      last_value: '10.00',
      new_value: '11.00',
      user_name: null,
      section_name: 'Parts',
      date_inserted: '2026-02-04 09:30:00',
    })

    const [row] = await getDb()
      .select()
      .from(partPriceHistory)
      .where(eq(partPriceHistory.partId, partId))
    expect(row?.fieldName).toBe('sell_price')
    expect(row?.newValue).toBe('11.00')
    expect(row?.changedAt.toISOString()).toBe('2026-02-04T09:30:00.000Z')

    const missingKey = `parts_price_history:${marker}:2`
    await transform('parts_price_history', missingKey, {
      id: '2',
      price_id: String(base + 902),
      field_name: 'cost',
      last_value: null,
      new_value: null,
    })
    expect(await exceptionFor('orphan_line', 'part_price_history', missingKey)).not.toBeNull()
  })

  test('a shared part mapping is an upsert on its code', async () => {
    const sourceKey = `shared_parts_list:${marker}:1`
    await transform('shared_parts_list', sourceKey, {
      partcode: sharedPartCode,
      main_partcode: 'MAIN-1',
    })
    await transform('shared_parts_list', sourceKey, {
      partcode: sharedPartCode,
      main_partcode: 'MAIN-2',
    })

    const rows = await getDb()
      .select()
      .from(sharedParts)
      .where(eq(sharedParts.partCode, sharedPartCode))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.mainPartCode).toBe('MAIN-2')
  })

  test('a requisition header has no forward table and is recorded as such', async () => {
    const sourceKey = `prf:${marker}:1`
    await transform('prf', sourceKey, {
      id: '1',
      woid: '100',
      description: 'Need 4 panels',
      tech: 'Tech One',
      date: '2026-01-05',
      notes: null,
      eta: '2026-01-09',
      status: 'open',
    })

    expect(await exceptionFor('not_migrated', 'prf', 'prf')).not.toBeNull()
    expect((await crosswalkFor('prf', sourceKey))?.targetTable).toBe('public.prf')
  })

  test('wo_next_pid seeds the allocator above the highest migrated number', async () => {
    const db = getDb()
    const [before] = await db
      .select({
        nextId: workOrderNumberSeries.nextId,
        description: workOrderNumberSeries.description,
      })
      .from(workOrderNumberSeries)
      .where(eq(workOrderNumberSeries.id, 2))
    expect(before).toBeDefined()
    seriesBefore = before!

    await db.execute(sql`
      insert into migration."stg_workorder"
        ("_row_no", "_source_pk", "_row_hash", "_dump_id", "id", "site", "status")
      values (1, ${String(stagedWorkOrderId)}, 'hash', ${dumpId}, ${String(stagedWorkOrderId)}, '1', '1')
    `)

    const sourceKey = `wo_next_pid:${marker}:2`
    await transform('wo_next_pid', sourceKey, {
      id: '2',
      next_id: '10',
      comments: 'Maintenance series',
    })

    const [applied] = (await db.execute(
      sql`select coalesce(max("id"), 0)::int as value from app.work_orders`,
    )) as unknown as Array<{ value: number }>
    const expected = Math.max(10, Number(applied!.value) + 1, stagedWorkOrderId + 1)

    const [after] = await db
      .select()
      .from(workOrderNumberSeries)
      .where(eq(workOrderNumberSeries.id, 2))
    expect(after?.nextId).toBe(expected)
    expect(after?.description).toBe('Maintenance series')
    // The allocator must not reissue a number a migrated work order already owns.
    expect(after!.nextId).toBeGreaterThan(stagedWorkOrderId)

    expect(await exceptionFor('series_seed', 'wo_next_pid', sourceKey)).not.toBeNull()
    expect((await crosswalkFor('wo_next_pid', sourceKey))?.targetKey).toBe('2')
  })

  test('a supplier model rate keeps its legacy id, price text and default flag', async () => {
    const sourceKey = `parts_supplier_model_rates:${marker}:${modelRateId}`
    await transform('parts_supplier_model_rates', sourceKey, {
      id: String(modelRateId),
      part_code: `MODEL-${marker}`,
      list_id: '7',
      supplier_id: '12',
      model_price: '$4.25',
      default_model: '1',
      model_number: 'ABC-123',
    })
    const [row] = await getDb()
      .select()
      .from(partSupplierModelRates)
      .where(eq(partSupplierModelRates.id, modelRateId))
    expect(row?.modelPrice).toBe('$4.25')
    expect(row?.defaultModel).toBe(true)
    expect(row?.modelNumber).toBe('ABC-123')
    expect(row?.supplierId).toBe(12)
  })
})
