/**
 * Group 10 mapping rules: the money group.
 *
 * These tests pin the decisions that change a financial total — a posted snapshot
 * that disagrees with its lines, a blank tax that must not become a rate, and a
 * real `0.00` that must stay distinguishable from a blank — against a real
 * database, inside a transaction per test.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { getDb, type Tx } from '@cls/db'
import {
  invoiceLabourLines,
  invoicePartLines,
  migrationExceptions,
  migrationRowMap,
  rgaParts,
  rgas,
  salesInvoices,
  workOrders,
} from '@cls/db/schema'
import { runTransformerRow, databaseConfigured } from '../testing'
import { transformer } from './invoicing-rga'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 })

const db = getDb()
const RUN = `g10-${Date.now()}-${Math.floor(Math.random() * 100_000)}`
const GROUP = 'invoicing-rga'
const WORK_ORDER_BASE = 9_000_000 + Math.floor(Math.random() * 100_000)
/** Parents are keyed by their legacy id, exactly as the runner stages them. */
const RGA_LEGACY_ID = String(9_500_000 + Math.floor(Math.random() * 10_000))

let workOrderSequence = 0
function nextWorkOrderId(): number {
  workOrderSequence += 1
  return WORK_ORDER_BASE + workOrderSequence
}

function key(name: string): string {
  return `${RUN}-${name}`
}

async function inTransaction(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await db.transaction(async (tx) => {
    await fn(tx)
  })
}

async function createWorkOrder(id: number): Promise<number> {
  await db.insert(workOrders).values({ id, siteId: 1, serviceRequired: `${RUN} test` })
  return id
}

async function exceptionsFor(sourceKey: string) {
  return db
    .select()
    .from(migrationExceptions)
    .where(eq(migrationExceptions.sourceKey, sourceKey))
}

async function invoiceFor(workOrderId: number) {
  const [row] = await db
    .select()
    .from(salesInvoices)
    .where(eq(salesInvoices.workOrderId, workOrderId))
  return row
}

async function targetKey(sourceKey: string): Promise<string | null> {
  const [row] = await db
    .select({ targetKey: migrationRowMap.targetKey })
    .from(migrationRowMap)
    .where(eq(migrationRowMap.sourceKey, sourceKey))
    .limit(1)
  return row?.targetKey ?? null
}

function createdWorkOrderIds(): number[] {
  return Array.from({ length: workOrderSequence }, (_value, index) => WORK_ORDER_BASE + index + 1)
}

afterAll(async () => {
  const workOrderIds = createdWorkOrderIds()
  const workOrderKeys = [...workOrderIds.map((id) => String(id)), RGA_LEGACY_ID]
  await db.delete(salesInvoices).where(inArray(salesInvoices.workOrderId, workOrderIds))
  await db.execute(sql`
    delete from app.rgas where id in (
      select target_key::bigint from migration.row_map
      where target_table = 'rgas'
        and (source_key = ${RGA_LEGACY_ID} or source_key like ${`${RUN}-%`})
    )`)
  await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds))
  await db
    .delete(migrationRowMap)
    .where(
      sql`${migrationRowMap.sourceKey} like ${`${RUN}-%`} or ${inArray(migrationRowMap.sourceKey, workOrderKeys)}`,
    )
  await db
    .delete(migrationExceptions)
    .where(
      sql`${migrationExceptions.sourceKey} like ${`${RUN}-%`} or ${inArray(migrationExceptions.sourceKey, workOrderKeys)}`,
    )
})

describe.skipIf(!databaseConfigured())(`${GROUP} transformer`, () => {
  it('keeps the posted snapshot and records the difference against the lines', async () => {
    const workOrderId = await createWorkOrder(nextWorkOrderId())
    const labourKey = key('hours-1')
    const snapshotKey = key('tax-1')

    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'inv_hours',
        sourceKey: labourKey,
        row: { id: '31', woid: String(workOrderId), rate: '85.00', date: '2024-06-01', hours: '2.00' },
      }),
    )
    const beforeSnapshot = await invoiceFor(workOrderId)
    expect(beforeSnapshot?.subtotalAmount).toBe('170.00')

    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'inv_tax',
        sourceKey: snapshotKey,
        row: {
          id: '32',
          woid: String(workOrderId),
          name: 'HST',
          appliedtaxrate: '0.13',
          calc_type: 'sub',
          tax_amount: '13.00',
          subtotal_amount: '999.00',
          total_amount: '1012.00',
        },
      }),
    )

    const invoice = await invoiceFor(workOrderId)
    // The document the customer received is what the invoice keeps (A5)…
    expect(invoice?.subtotalAmount).toBe('999.00')
    expect(invoice?.taxAmount).toBe('13.00')
    expect(invoice?.totalAmount).toBe('1012.00')
    expect(invoice?.appliedTaxRate).toBe('0.13000')
    // …and the disagreement is a recorded decision, carrying both numbers.
    const exceptions = await exceptionsFor(snapshotKey)
    const unbalanced = exceptions.find((row) => row.exceptionClass === 'unbalanced_totals')
    expect(unbalanced).toBeDefined()
    expect(unbalanced?.owner).toBeNull()
    expect(unbalanced?.notes ?? '').toContain('999.00')
    expect(unbalanced?.notes ?? '').toContain('170.00')
    // A posted snapshot that overrides the lines is stored as the override.
    expect(invoice?.manualSubtotalAmount).toBe('999.00')
    expect(invoice?.manualTaxAmount).toBe('13.00')
  })

  it('stores a blank tax as NULL, never as a default rate', async () => {
    const workOrderId = await createWorkOrder(nextWorkOrderId())
    const snapshotKey = key('tax-blank')

    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'inv_tax',
        sourceKey: snapshotKey,
        row: {
          id: '41',
          woid: String(workOrderId),
          name: '',
          appliedtaxrate: '',
          calc_type: '',
          tax_amount: '',
          subtotal_amount: '',
          total_amount: '',
        },
      }),
    )

    const invoice = await invoiceFor(workOrderId)
    expect(invoice).toBeDefined()
    expect(invoice?.taxAmount).toBe('0.00')
    expect(invoice?.appliedTaxRate).toBeNull()
    const classes = (await exceptionsFor(snapshotKey)).map((row) => row.exceptionClass)
    expect(classes).toContain('blank_tax')
    expect(classes).toContain('blank_money')
  })

  it('keeps a posted zero tax as a zero, distinguishable from a blank', async () => {
    const workOrderId = await createWorkOrder(nextWorkOrderId())
    const snapshotKey = key('tax-zero')

    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'inv_tax',
        sourceKey: snapshotKey,
        row: {
          id: '43',
          woid: String(workOrderId),
          appliedtaxrate: '0',
          calc_type: 'local',
          tax_amount: '0.00',
          subtotal_amount: '50.00',
          total_amount: '50.00',
        },
      }),
    )

    const invoice = await invoiceFor(workOrderId)
    expect(invoice?.taxAmount).toBe('0.00')
    // Same class, different fact: the note says the row is a real zero.
    const zeroRow = (await exceptionsFor(snapshotKey)).find(
      (row) => row.exceptionClass === 'blank_tax',
    )
    expect(zeroRow?.migrationAction).toContain('real zero')
  })

  it('distinguishes a blank RGA price from a posted 0.00', async () => {
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'rga',
        sourceKey: RGA_LEGACY_ID,
        row: {
          id: RGA_LEGACY_ID,
          status: '2',
          rga_type: '',
          request_date: '2024-07-01',
          supplier_id: '',
        },
      }),
    )
    const rgaId = await targetKey(RGA_LEGACY_ID)
    expect(rgaId).not.toBeNull()

    const blankKey = key('rga-part-blank')
    const zeroKey = key('rga-part-zero')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'rga_parts',
        sourceKey: blankKey,
        row: {
          id: '52',
          rgaid: RGA_LEGACY_ID,
          partno: `${RUN}-A`,
          qty: '1',
          price: '',
          return_qty: '1',
        },
      }),
    )
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'rga_parts',
        sourceKey: zeroKey,
        row: {
          id: '53',
          rgaid: RGA_LEGACY_ID,
          partno: `${RUN}-B`,
          qty: '1',
          price: '0.00',
          return_qty: '1',
        },
      }),
    )

    const blankClasses = (await exceptionsFor(blankKey)).map((row) => row.exceptionClass)
    const zeroClasses = (await exceptionsFor(zeroKey)).map((row) => row.exceptionClass)
    expect(blankClasses).toContain('blank_money')
    expect(blankClasses).not.toContain('zero_amount')
    expect(zeroClasses).toContain('zero_amount')
    expect(zeroClasses).not.toContain('blank_money')

    const lines = await db.select().from(rgaParts).where(eq(rgaParts.rgaId, Number(rgaId)))
    expect(lines).toHaveLength(2)
    // Both lines exist; only the source differed.
    expect(lines.every((line) => line.price === '0.00')).toBe(true)
  })

  it('does not guess an unknown RGA status', async () => {
    const sourceKey = key('rga-bad-status')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'rga',
        sourceKey,
        row: { id: '61', status: '9', rga_type: 'supplier', request_date: '2024-07-01' },
      }),
    )

    expect(await targetKey(sourceKey)).toBeNull()
    const exceptions = await exceptionsFor(sourceKey)
    expect(exceptions.map((row) => row.exceptionClass)).toContain('unknown_enum')
  })

  it('splits the legacy rga_type into the document kind and the replacement party', async () => {
    const sourceKey = key('rga-supplier')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'rga',
        sourceKey,
        row: {
          id: '62',
          status: '4',
          rga_type: 'supplier',
          request_date: '2024-07-02',
          rga_notes: 'return to vendor',
        },
      }),
    )

    const mapped = await targetKey(sourceKey)
    expect(mapped).not.toBeNull()
    const [row] = await db.select().from(rgas).where(eq(rgas.id, Number(mapped)))
    expect(row?.rgaType).toBe('rga')
    expect(row?.replacementType).toBe('supplier')
    expect(row?.rgaNotes).toBe('return to vendor')
  })

  it('reports an invoice line whose work order does not exist, and inserts nothing', async () => {
    const sourceKey = key('part-orphan')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'inv_parts',
        sourceKey,
        row: { id: '71', woid: '1', partno: `${RUN}-ORPHAN`, qty: '1', price: '10.00' },
      }),
    )

    expect(await targetKey(sourceKey)).toBeNull()
    const exceptions = await exceptionsFor(sourceKey)
    expect(exceptions.map((row) => row.exceptionClass)).toContain('orphan_line')
    const lines = await db
      .select()
      .from(invoicePartLines)
      .where(eq(invoicePartLines.partNo, `${RUN}-ORPHAN`))
    expect(lines).toHaveLength(0)
  })

  it('recomputes the header from the lines before any posted snapshot lands', async () => {
    const workOrderId = await createWorkOrder(nextWorkOrderId())
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'inv_hours',
        sourceKey: key('hours-2'),
        row: { id: '81', woid: String(workOrderId), rate: '100.00', date: '2024-08-01', hours: '1.50' },
      }),
    )

    const invoice = await invoiceFor(workOrderId)
    expect(invoice?.labourAmount).toBe('150.00')
    expect(invoice?.subtotalAmount).toBe('150.00')
    expect(invoice?.status).toBe('draft')
    const lines = await db
      .select()
      .from(invoiceLabourLines)
      .where(eq(invoiceLabourLines.invoiceId, invoice!.id))
    expect(lines[0]?.amount).toBe('150.00')
  })
})
