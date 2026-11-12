/**
 * Group 6 — work orders.
 *
 * Pinned here: the placeholder work orders are quarantined, `workorder.customer`
 * is believed before `workorder.site` and the fallback is recorded, a secondary key
 * that disagrees with `id` blocks the row, an unknown status is stored as Active
 * with an exception, and blank money on a line is recorded rather than silently
 * zeroed.
 */
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { getDb } from '@cls/db'
import { getConfig } from '@cls/core/env.server'
import {
  localWorkOrderHours,
  localWorkOrderTechs,
  migrationExceptions,
  migrationRowMap,
  sites,
  subcontractors,
  users,
  workOrderHours,
  workOrderNotes,
  workOrderParts,
  workOrderReports,
  workOrderRevisions,
  workOrders,
  workOrderSpecialParts,
  workOrderTax,
} from '@cls/db/schema'
import { runTransformerRow } from '../testing'
import { transformer } from './work-orders'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

const configured = (() => {
  try {
    return Boolean(process.env.DATABASE_URL ?? getConfig().databaseUrl)
  } catch {
    return Boolean(process.env.DATABASE_URL)
  }
})()

const marker = `wo${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const dumpId = `test-dump-${marker}`

const base = 1_600_000_000 + Math.floor(Math.random() * 900_000)
const siteId = base
const orphanSiteId = base + 900
const subcontractorId = base + 1
const legacyUserId = base + 2
const userId = crypto.randomUUID()

const mainWorkOrder = base + 100
const fallbackWorkOrder = base + 101
const placeholderIds = ['99999999', '44444444', '0']

// Every work order this file may create, so a failed test cannot leave one behind.
const workOrderIds = [mainWorkOrder, fallbackWorkOrder, base + 102, base + 103, base + 104]

async function transform(table: string, sourceKey: string, row: Record<string, string | null>) {
  await getDb().transaction(async (tx) => {
    await runTransformerRow(tx, transformer, {
      group: 'work-orders',
      table,
      sourceKey,
      row,
      dumpId,
    })
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

function workOrderRow(id: number, overrides: Record<string, string | null> = {}) {
  return {
    id: String(id),
    site: String(siteId),
    servicetype: '1',
    priority: '3',
    dne: '0',
    status: '1',
    datetaken: '2025-01-15',
    expcompletion: '2025-02-01',
    servicerequired: 'Replace two ballasts',
    notes: 'Access through the loading dock',
    subcontractor: String(subcontractorId),
    completiondate: '2025-01-20 16:30:00',
    securitycode: '4321',
    customerpo: 'PO-77',
    local: '0',
    tech: String(legacyUserId),
    tech_2: '',
    tech_labour_rate: '85.00',
    invdate: '2025-02-03',
    calc_inv_date: '0000-00-00',
    customer: String(siteId),
    wo_folder_attach_path: '/mnt/old/wo/1234',
    printed: '',
    batched: '',
    schannel: '0',
    schannel_redone: '',
    sgsales_done: '1',
    sgpurch_done: '0',
    forced_enable_sc_transfer: '',
    ready_for_calc_timespan: '',
    closeout_tech: '',
    closeout_tech_2: '',
    is_marked_red: '1',
    is_marked_green: '0',
    is_marked_critical: '1',
    is_project_wo: '0',
    customer_quote_id: '88',
    is_tjx_quote: '0',
    is_pma_order: '0',
    is_pma_bckup: '',
    stock_updated: '1',
    marked_invoiced_time: '',
    enable_sale_stock_upd_btn: '0',
    only_portal_stock_updated: '1',
    assigned_dispatch_id: '',
    pma_order_category: '',
    primary_workorder: '',
    add_to_local_modify_once: '0',
    sc_primary_status: '',
    sc_extended_status: '',
    ...overrides,
  }
}

afterAll(async () => {
  if (!configured) return
  const db = getDb()
  await db.delete(localWorkOrderTechs).where(inArray(localWorkOrderTechs.workOrderId, workOrderIds))
  await db.delete(localWorkOrderHours).where(inArray(localWorkOrderHours.workOrderId, workOrderIds))
  await db.delete(workOrderHours).where(inArray(workOrderHours.workOrderId, workOrderIds))
  await db.delete(workOrderParts).where(inArray(workOrderParts.workOrderId, workOrderIds))
  await db
    .delete(workOrderSpecialParts)
    .where(inArray(workOrderSpecialParts.workOrderId, workOrderIds))
  await db.delete(workOrderTax).where(inArray(workOrderTax.workOrderId, workOrderIds))
  await db.delete(workOrderReports).where(inArray(workOrderReports.workOrderId, workOrderIds))
  await db.delete(workOrderNotes).where(inArray(workOrderNotes.workOrderId, workOrderIds))
  await db.delete(workOrderRevisions).where(inArray(workOrderRevisions.workOrderId, workOrderIds))
  await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds))
  await db.delete(sites).where(eq(sites.id, siteId))
  await db.delete(subcontractors).where(eq(subcontractors.id, subcontractorId))
  await db.delete(users).where(eq(users.legacyId, legacyUserId))
  await db.delete(migrationRowMap).where(like(migrationRowMap.sourceKey, `%${marker}%`))
  await db.delete(migrationExceptions).where(like(migrationExceptions.sourceKey, `%${marker}%`))
  // The whole-table skip is keyed by table name, so it is not covered by the marker.
  await db
    .delete(migrationExceptions)
    .where(
      and(
        eq(migrationExceptions.exceptionClass, 'not_migrated'),
        eq(migrationExceptions.entity, 'undispatched_workorders'),
      ),
    )
})

describe.skipIf(!configured)('work-orders group', () => {
  test('a header keeps its number, site precedence and money flags', async () => {
    const db = getDb()
    await db.insert(sites).values({ id: siteId, name: `Site ${marker}` })
    await db.insert(subcontractors).values({ id: subcontractorId, name: `Sub ${marker}` })
    await db.insert(users).values({
      id: userId,
      email: `${marker}@example.test`,
      username: `tech-${marker}`,
      displayName: 'Tech',
      legacyId: legacyUserId,
    })

    const sourceKey = `workorder:${marker}:${mainWorkOrder}`
    await transform('workorder', sourceKey, workOrderRow(mainWorkOrder))

    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, mainWorkOrder))
    expect(row?.siteId).toBe(siteId)
    expect(row?.status).toBe(1)
    expect(row?.subcontractorId).toBe(subcontractorId)
    expect(row?.dateTaken).toBe('2025-01-15')
    expect(row?.expectedCompletion).toBe('2025-02-01')
    // Read the timestamps back as Postgres renders them: the wall clock is kept,
    // so the check does not depend on the reader's timezone.
    const [stamped] = (await db.execute(
      sql`select to_char(invoiced_at, 'YYYY-MM-DD') as invoiced, to_char(completed_at, 'YYYY-MM-DD HH24:MI:SS') as completed from app.work_orders where id = ${mainWorkOrder}`,
    )) as unknown as Array<{ invoiced: string; completed: string }>
    expect(stamped?.invoiced).toBe('2025-02-03')
    expect(stamped?.completed).toBe('2025-01-20 16:30:00')
    expect(row?.isMarkedRed).toBe(true)
    expect(row?.isMarkedCritical).toBe(true)
    expect(row?.sageSalesDone).toBe(true)
    expect(row?.onlyPortalStockUpdated).toBe(true)
    const crosswalk = await db
      .select()
      .from(migrationRowMap)
      .where(eq(migrationRowMap.sourceKey, sourceKey))
    expect(crosswalk[0]?.targetTable).toBe('work_orders')
  })

  test('placeholder work orders are quarantined', async () => {
    const db = getDb()
    for (const placeholder of placeholderIds) {
      const sourceKey = `workorder:${marker}:ph${placeholder}`
      await transform('workorder', sourceKey, workOrderRow(Number(placeholder)))
      const quarantined = await exceptionFor('placeholder_work_order', 'work_order', sourceKey)
      expect(quarantined?.migrationAction).toContain('owner ops')
      const rows = await db
        .select({ id: workOrders.id })
        .from(workOrders)
        .where(eq(workOrders.id, Number(placeholder)))
      expect(rows).toHaveLength(0)
    }
  })

  test('workorder.site is used only when customer does not resolve, and that is recorded', async () => {
    const db = getDb()
    const sourceKey = `workorder:${marker}:${fallbackWorkOrder}`
    await transform(
      'workorder',
      sourceKey,
      workOrderRow(fallbackWorkOrder, { customer: String(orphanSiteId) }),
    )

    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, fallbackWorkOrder))
    expect(row?.siteId).toBe(siteId)
    const fallback = await exceptionFor('orphan_workorder_site', 'work_order', sourceKey)
    expect(fallback?.migrationAction).toContain('workorder.site')
  })

  test('an unresolved site keeps the raw id instead of losing the work order', async () => {
    const db = getDb()
    const id = base + 102
    const sourceKey = `workorder:${marker}:rawsite`
    await transform(
      'workorder',
      sourceKey,
      workOrderRow(id, { customer: String(orphanSiteId), site: '' }),
    )

    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, id))
    expect(row?.siteId).toBe(orphanSiteId)
    const preserved = await exceptionFor('orphan_workorder_site', 'work_order', sourceKey)
    expect(preserved?.migrationAction).toContain('raw legacy site id')
    await db.delete(workOrders).where(eq(workOrders.id, id))
  })

  test('a secondary key that disagrees with id blocks the row', async () => {
    const db = getDb()
    const id = base + 103
    const sourceKey = `workorder:${marker}:mismatch`
    await transform('workorder', sourceKey, { ...workOrderRow(id), woid: String(id + 1) })

    const mismatch = await exceptionFor('woid_mismatch', 'work_order', sourceKey)
    expect(mismatch?.notes).toContain(String(id + 1))
    const rows = await db
      .select({ id: workOrders.id })
      .from(workOrders)
      .where(eq(workOrders.id, id))
    expect(rows).toHaveLength(0)
  })

  test('an unknown status is stored as Active with an unknown_enum exception', async () => {
    const db = getDb()
    const id = base + 104
    const sourceKey = `workorder:${marker}:status`
    await transform('workorder', sourceKey, workOrderRow(id, { status: '77' }))

    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, id))
    expect(row?.status).toBe(1)
    const unknown = await exceptionFor('unknown_enum', 'work_order', sourceKey)
    expect(unknown?.notes).toContain('77')
    await db.delete(workOrders).where(eq(workOrders.id, id))
  })

  test('a part line parses money and records a blank price', async () => {
    const db = getDb()
    const parsedKey = `wo_parts:${marker}:1`
    await transform('wo_parts', parsedKey, {
      id: '1',
      woid: String(mainWorkOrder),
      partno: 'LED-2X4',
      qty: '2.00',
      price: '$1,234.50',
    })
    const [parsed] = await db
      .select()
      .from(workOrderParts)
      .where(
        and(eq(workOrderParts.workOrderId, mainWorkOrder), eq(workOrderParts.partNo, 'LED-2X4')),
      )
    expect(parsed?.price).toBe('1234.50')
    expect(parsed?.qty).toBe('2.00')

    const blankKey = `wo_parts:${marker}:2`
    await transform('wo_parts', blankKey, {
      id: '2',
      woid: String(mainWorkOrder),
      partno: 'BALLAST-1',
      qty: '1.00',
      price: '   ',
    })
    const rows = await db
      .select()
      .from(workOrderParts)
      .where(
        and(eq(workOrderParts.workOrderId, mainWorkOrder), eq(workOrderParts.partNo, 'BALLAST-1')),
      )
    expect(rows[0]?.price).toBe('0.00')
    const blank = await exceptionFor('blank_money', 'work_order_part', blankKey)
    expect(blank?.migrationAction).toContain('NOT NULL')
  })

  test("a '---' part line is kept and recorded as an unresolved part", async () => {
    const db = getDb()
    const sourceKey = `wo_parts:${marker}:3`
    await transform('wo_parts', sourceKey, {
      id: '3',
      woid: String(mainWorkOrder),
      partno: '---',
      qty: '1.00',
      price: '10.00',
    })

    const [row] = await db
      .select()
      .from(workOrderParts)
      .where(and(eq(workOrderParts.workOrderId, mainWorkOrder), eq(workOrderParts.partNo, '---')))
    expect(row?.workOrderId).toBe(mainWorkOrder)
    const unresolved = await exceptionFor('unresolved_part_line', 'work_order_part', sourceKey)
    expect(unresolved?.notes).toContain('---')
  })

  test('a labour line with a zero date is dated from the work order', async () => {
    const db = getDb()
    const sourceKey = `wo_hours:${marker}:1`
    await transform('wo_hours', sourceKey, {
      id: '1',
      woid: String(mainWorkOrder),
      rate: '2',
      date: '0000-00-00',
      hours: '3.50',
      hourly_rate: '85.00',
    })

    const [row] = await db
      .select()
      .from(workOrderHours)
      .where(eq(workOrderHours.workOrderId, mainWorkOrder))
    expect(row?.lineDate).toBe('2025-01-15')
    expect(row?.rateCode).toBe(2)
    expect(row?.hourlyRate).toBe('85.00')
    const zero = await exceptionFor('zero_date', 'work_order_hour', sourceKey)
    expect(zero?.migrationAction).toContain('work order date')
  })

  test('a child whose work order does not exist is an orphan line', async () => {
    const db = getDb()
    const sourceKey = `wo_parts:${marker}:4`
    await transform('wo_parts', sourceKey, {
      id: '4',
      woid: String(base + 800),
      partno: 'NOPE',
      qty: '1.00',
      price: '1.00',
    })

    const rows = await db
      .select({ id: workOrderParts.id })
      .from(workOrderParts)
      .where(eq(workOrderParts.partNo, 'NOPE'))
    expect(rows).toHaveLength(0)
    const orphan = await exceptionFor('orphan_line', 'work_order_part', sourceKey)
    expect(orphan?.migrationAction).toContain('work_order_id')
  })

  test('work-order tax keeps the province and the applied rate', async () => {
    const db = getDb()
    await transform('wo_tax', `wo_tax:${marker}:1`, {
      id: '1',
      woid: String(mainWorkOrder),
      tax: '13.00',
      name: 'ON',
      tax_total: '160.49',
      tax_gst: '',
      tax_pst: '',
      appliedtaxrate: '0.13',
      appliedtaxrate_pst: '',
      appliedtaxrate_gst: '0.05',
    })

    const [row] = await db
      .select()
      .from(workOrderTax)
      .where(eq(workOrderTax.workOrderId, mainWorkOrder))
    expect(row?.taxProvince).toBe('ON')
    expect(row?.appliedTaxRate).toBe('0.13000')
    expect(row?.taxTotal).toBe('160.49')
  })

  test('a special part with the legacy -99999 quantity is not migrated', async () => {
    const db = getDb()
    const sourceKey = `wo_soparts:${marker}:1`
    await transform('wo_soparts', sourceKey, {
      id: '1',
      woid: String(mainWorkOrder),
      name: 'Removed fixture',
      qty: '-99999.00',
      price: '10.00',
      is_emergency_lighting: '0',
    })

    const rows = await db
      .select({ id: workOrderSpecialParts.id })
      .from(workOrderSpecialParts)
      .where(eq(workOrderSpecialParts.workOrderId, mainWorkOrder))
    expect(rows).toHaveLength(0)
    const deleted = await exceptionFor('legacy_deleted_line', 'work_order_special_part', sourceKey)
    expect(deleted?.migrationAction).toContain('-99999')
  })

  test('a table with no target is skipped once, with the decision written down', async () => {
    const db = getDb()
    await transform('undispatched_workorders', 'undispatched_workorders:1', {
      id: '1',
      location_id: '12',
      location_name: 'North plant',
      site_id: String(siteId),
      tracking_no: 'TRK-1',
      nte: '500.00',
      address: '1 Main St',
      province: 'ON',
      city: 'Toronto',
      category: 'HVAC',
      batch_id: '3',
      batch_type: 'bulk',
      created_timespan: '1700000000',
      is_imported: '1',
      re_updated: '0',
    })

    // Nothing is invented: the inbox row does not become a work order, and the
    // exception names the table once so the run report carries the decision.
    const rows = await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.id, 1))
    expect(rows).toHaveLength(0)
    const skipped = await exceptionFor(
      'not_migrated',
      'undispatched_workorders',
      'undispatched_workorders',
    )
    expect(skipped?.migrationAction).toContain('bulk-import inbox')
  })
})
