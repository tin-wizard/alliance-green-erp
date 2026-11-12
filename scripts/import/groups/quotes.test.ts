/**
 * Group 7 — quotes.
 *
 * Pinned here: a customer quote keeps the number on the customer's PDF, a
 * standalone quote takes the next free number and keeps its crosswalk, a legacy
 * tax amount that disagrees with the recomputed total is recorded for finance, a
 * line whose header is missing is an orphan, and the revision chain gets exactly
 * one chain end.
 */
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { getDb } from '@cls/db'
import { getConfig } from '@cls/core/env.server'
import {
  migrationExceptions,
  migrationRowMap,
  quotePackingParts,
  quotePackingSlips,
  quotePackingSpecialParts,
  quoteParts,
  quotes,
  quoteSpecialParts,
  sites,
} from '@cls/db/schema'
import { runTransformerRow } from '../testing'
import { transformer } from './quotes'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

const configured = (() => {
  try {
    return Boolean(process.env.DATABASE_URL ?? getConfig().databaseUrl)
  } catch {
    return Boolean(process.env.DATABASE_URL)
  }
})()

const marker = `qt${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const dumpId = `test-dump-${marker}`

const base = 1_700_000_000 + Math.floor(Math.random() * 900_000)
const siteId = base
const customerQuoteId = base + 10
const unbalancedQuoteId = base + 11
const standaloneLegacyId = 7
const orphanLineQuoteId = base + 12
const noSiteQuoteId = base + 13
const parentRevisionId = base + 14
const childRevisionId = base + 15
const slipLegacyId = base + 40

const createdQuoteIds: number[] = [
  customerQuoteId,
  unbalancedQuoteId,
  orphanLineQuoteId,
  parentRevisionId,
  childRevisionId,
]

async function transform(table: string, sourceKey: string, row: Record<string, string | null>) {
  await getDb().transaction(async (tx) => {
    await runTransformerRow(tx, transformer, { group: 'quotes', table, sourceKey, row, dumpId })
  })
}

/** Seed a staging row the transformer reads to recompute a quote. */
async function stage(table: string, rowNo: number, values: Record<string, string>) {
  const columns = Object.keys(values)
  await getDb().execute(sql`
    insert into ${sql.raw(`migration."stg_${table}"`)}
      ("_row_no", "_source_pk", "_row_hash", "_dump_id", ${sql.join(
        columns.map((column) => sql.raw(`"${column}"`)),
        sql`, `,
      )})
    values (${rowNo}, ${String(rowNo)}, 'hash', ${dumpId}, ${sql.join(
      columns.map((column) => sql`${values[column] ?? ''}`),
      sql`, `,
    )})
  `)
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

async function crosswalkFor(entity: string, sourceTable: string, sourceKey: string) {
  const [row] = await getDb()
    .select()
    .from(migrationRowMap)
    .where(
      and(
        eq(migrationRowMap.entity, entity),
        eq(migrationRowMap.sourceTable, sourceTable),
        eq(migrationRowMap.sourceKey, sourceKey),
      ),
    )
    .limit(1)
  return row ?? null
}

function customerQuoteRow(id: number, overrides: Record<string, string | null> = {}) {
  return {
    id: String(id),
    workordernumber: '5555',
    site: String(siteId),
    ShipCntc: 'Dana',
    ShipStrt1: '1 Main St',
    ShipStrt2: '',
    ShipCity: 'Toronto',
    ShipPrvSt: 'ON',
    ShipPstZp: 'M5V 1A1',
    is_address_updated: '1',
    report: 'Replace fixtures',
    status: '1',
    payment_terms: '2',
    notes: 'Call ahead',
    appliedtaxrate: '0.13',
    tax_code: 'ON',
    tax_amount: '65.00',
    createdby: '',
    due_date: '2025-03-01',
    is_due_date_tbd: '0',
    date_approved: '',
    date_created: '2025-01-02',
    is_revision: '0',
    revision_quote_id: '',
    revision_id: '0',
    ...overrides,
  }
}

afterAll(async () => {
  if (!configured) return
  const db = getDb()
  if (createdQuoteIds.length > 0) {
    const slipIds = db
      .select({ id: quotePackingSlips.id })
      .from(quotePackingSlips)
      .where(inArray(quotePackingSlips.quoteId, createdQuoteIds))
    await db.delete(quotePackingParts).where(inArray(quotePackingParts.packingSlipId, slipIds))
    await db
      .delete(quotePackingSpecialParts)
      .where(inArray(quotePackingSpecialParts.packingSlipId, slipIds))
    await db.delete(quotePackingSlips).where(inArray(quotePackingSlips.quoteId, createdQuoteIds))
    await db.delete(quoteParts).where(inArray(quoteParts.quoteId, createdQuoteIds))
    await db.delete(quoteSpecialParts).where(inArray(quoteSpecialParts.quoteId, createdQuoteIds))
    await db.delete(quotes).where(inArray(quotes.id, createdQuoteIds))
  }
  await db.delete(sites).where(eq(sites.id, siteId))
  for (const table of [
    'customer_quote',
    'customer_quote_hours',
    'customer_quote_parts',
    'customer_quote_soparts',
    'customer_qo_packing_slip',
    'customer_qo_packing_soparts',
    'standalone_quote',
  ]) {
    await db.execute(
      sql`delete from ${sql.raw(`migration."stg_${table}"`)} where "_dump_id" = ${dumpId}`,
    )
  }
  await db.delete(migrationRowMap).where(like(migrationRowMap.sourceKey, `%${marker}%`))
  await db.delete(migrationExceptions).where(like(migrationExceptions.sourceKey, `%${marker}%`))
  // The header crosswalk above is keyed by the legacy id, so it is not matched by
  // the marker; the whole-table skip is keyed by table name for the same reason.
  await db
    .delete(migrationRowMap)
    .where(
      and(
        eq(migrationRowMap.sourceTable, 'customer_quote'),
        eq(migrationRowMap.sourceKey, String(customerQuoteId)),
      ),
    )
  await db
    .delete(migrationRowMap)
    .where(
      and(
        eq(migrationRowMap.sourceTable, 'customer_qo_packing_slip'),
        eq(migrationRowMap.sourceKey, String(slipLegacyId)),
      ),
    )
  await db
    .delete(migrationExceptions)
    .where(
      and(
        eq(migrationExceptions.exceptionClass, 'not_migrated'),
        eq(migrationExceptions.entity, 'calcquote_hours'),
      ),
    )
})

describe.skipIf(!configured)('quotes group', () => {
  test('a customer quote keeps its number and stores the legacy tax as manual', async () => {
    const db = getDb()
    await db.insert(sites).values({ id: siteId, name: `Site ${marker}` })

    // The header crosswalk is keyed by the legacy id, as the runner keys it, so a
    // child row can resolve its parent.
    const sourceKey = String(customerQuoteId)
    await transform('customer_quote', sourceKey, customerQuoteRow(customerQuoteId))

    const [row] = await db.select().from(quotes).where(eq(quotes.id, customerQuoteId))
    expect(row?.kind).toBe('customer')
    expect(row?.siteId).toBe(siteId)
    expect(row?.status).toBe(1)
    // The number the customer saw is the number that survives.
    expect(row?.workOrderNumber).toBe(5555)
    expect(row?.manualTaxAmount).toBe('65.00')
    expect(row?.appliedTaxRate).toBe('0.13000')
    expect(row?.dueDate).toBe('2025-03-01')
    expect(row?.dateCreated).toBe('2025-01-02')
    expect(row?.isLastRevision).toBe(true)
    expect(await crosswalkFor('quote', 'customer_quote', sourceKey)).not.toBeNull()
  })

  test('a legacy tax amount that disagrees with the recomputed total is recorded', async () => {
    const db = getDb()
    await stage('customer_quote_parts', 1, {
      id: '9001',
      cust_qoid: String(unbalancedQuoteId),
      partno: 'LED-2X4',
      qty: '2',
      price: '50.00',
    })

    const sourceKey = `customer_quote:${marker}:${unbalancedQuoteId}`
    await transform(
      'customer_quote',
      sourceKey,
      customerQuoteRow(unbalancedQuoteId, { tax_amount: '999.00' }),
    )

    const [row] = await db.select().from(quotes).where(eq(quotes.id, unbalancedQuoteId))
    // The legacy figure is kept; nothing is silently rewritten.
    expect(row?.manualTaxAmount).toBe('999.00')
    const unbalanced = await exceptionFor('unbalanced_totals', 'customer_quote', sourceKey)
    expect(unbalanced?.notes).toContain('subtotal = 100.00')
    expect(unbalanced?.notes).toContain('999.00')
  })

  test('a standalone quote takes the next free number and keeps its crosswalk', async () => {
    const db = getDb()
    const before = (
      await db.select({ max: sql<number>`coalesce(max(id), 0)::int` }).from(quotes)
    )[0]!.max

    const sourceKey = `standalone_quote:${marker}:${standaloneLegacyId}`
    await transform('standalone_quote', sourceKey, {
      id: String(standaloneLegacyId),
      workordernumber: '',
      site: String(siteId),
      ShipCntc: '',
      ShipStrt1: '',
      ShipStrt2: '',
      ShipCity: '',
      ShipPrvSt: '',
      ShipPstZp: '',
      is_address_updated: '0',
      pdf_notes: 'Net 30',
      status: '2',
      reference_wo_number: 'WO-9',
      notes: '',
      appliedtaxrate: '',
      tax_code: '',
      tax_amount: '',
      createdby: '',
      date_approved: '',
      date_created: '2025-02-02',
      is_revision: '0',
      revision_quote_id: '',
      revision_id: '0',
      created_from_local: '1',
      is_deleted: '0',
    })

    const crosswalk = await crosswalkFor('quote', 'standalone_quote', sourceKey)
    const allocated = Number(crosswalk?.targetKey)
    createdQuoteIds.push(allocated)
    // A second id space: the standalone quote cannot take a number a customer
    // quote already owns.
    expect(allocated).toBeGreaterThan(before)
    const [row] = await db.select().from(quotes).where(eq(quotes.id, allocated))
    expect(row?.kind).toBe('standalone')
    expect(row?.status).toBe(2)
    expect(row?.pdfNotes).toBe('Net 30')
    expect(row?.createdFromLocal).toBe(true)
    expect(row?.referenceWoNumber).toBe('WO-9')
  })

  test('a line whose quote does not exist is an orphan line', async () => {
    const db = getDb()
    const sourceKey = `customer_quote_parts:${marker}:1`
    await transform('customer_quote_parts', sourceKey, {
      id: '9002',
      cust_qoid: String(orphanLineQuoteId),
      partno: 'X',
      qty: '1',
      price: '1.00',
    })

    const orphan = await exceptionFor('orphan_line', 'customer_quote_part', sourceKey)
    expect(orphan?.migrationAction).toContain('quote_id')
    const rows = await db
      .select({ id: quoteParts.id })
      .from(quoteParts)
      .where(eq(quoteParts.quoteId, orphanLineQuoteId))
    expect(rows).toHaveLength(0)
  })

  test('a quote with no site is not inserted', async () => {
    const db = getDb()
    const sourceKey = `customer_quote:${marker}:${noSiteQuoteId}`
    await transform(
      'customer_quote',
      sourceKey,
      customerQuoteRow(noSiteQuoteId, { site: '', customer: '' }),
    )

    const rows = await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.id, noSiteQuoteId))
    expect(rows).toHaveLength(0)
    const orphan = await exceptionFor('orphan_line', 'customer_quote', sourceKey)
    expect(orphan?.migrationAction).toContain('site_id')
  })

  test('the revision chain gets one chain end and a root', async () => {
    const db = getDb()
    // The chain end is a property of the whole dump, so both rows are staged.
    await stage('customer_quote', 2, { id: String(parentRevisionId), site: String(siteId) })
    await stage('customer_quote', 3, {
      id: String(childRevisionId),
      site: String(siteId),
      revision_quote_id: String(parentRevisionId),
    })

    const parentKey = `customer_quote:${marker}:${parentRevisionId}`
    await transform(
      'customer_quote',
      parentKey,
      customerQuoteRow(parentRevisionId, { revision_id: '0' }),
    )
    const [parent] = await db.select().from(quotes).where(eq(quotes.id, parentRevisionId))
    expect(parent?.isLastRevision).toBe(false)
    expect(parent?.rootQuoteId).toBeNull()

    const childKey = `customer_quote:${marker}:${childRevisionId}`
    await transform(
      'customer_quote',
      childKey,
      customerQuoteRow(childRevisionId, {
        is_revision: '1',
        revision_quote_id: String(parentRevisionId),
        revision_id: '0.1',
      }),
    )
    const [child] = await db.select().from(quotes).where(eq(quotes.id, childRevisionId))
    expect(child?.revisionQuoteId).toBe(parentRevisionId)
    expect(child?.rootQuoteId).toBe(parentRevisionId)
    expect(child?.revisionId).toBe('0.1')
    expect(child?.isLastRevision).toBe(true)
  })

  test('a shipped special part is linked to the quote line it came from', async () => {
    const db = getDb()
    const specialKey = `customer_quote_soparts:${marker}:1`
    await transform('customer_quote_soparts', specialKey, {
      id: '9101',
      cust_qoid: String(customerQuoteId),
      name: 'Emergency ballast',
      qty: '1',
      price: '40.00',
    })
    const [special] = await db
      .select()
      .from(quoteSpecialParts)
      .where(eq(quoteSpecialParts.quoteId, customerQuoteId))
    expect(special?.name).toBe('Emergency ballast')

    // Keyed by the legacy id, as the runner keys it, so the shipped line below can
    // find its slip.
    await transform('customer_qo_packing_slip', String(slipLegacyId), {
      id: String(slipLegacyId),
      cust_qoid: String(customerQuoteId),
      date_created: '2025-01-10',
      ship_date: '2025-01-12',
      packing_slip_level: '1',
    })
    await transform('customer_qo_packing_soparts', `customer_qo_packing_soparts:${marker}:1`, {
      id: '9201',
      cust_qoid: String(customerQuoteId),
      packing_slip_id: String(slipLegacyId),
      qo_sopart_id: '9101',
      name: 'Emergency ballast',
      actual_qty: '1',
      backorder_qty: '0',
      shipped_qty: '1',
      sortorder: '1',
    })

    const [line] = await db
      .select()
      .from(quotePackingSpecialParts)
      .where(eq(quotePackingSpecialParts.quoteSpecialPartId, special!.id))
    expect(line?.name).toBe('Emergency ballast')
    expect(line?.shippedQty).toBe(1)
    expect(line?.backorderQty).toBe(0)
  })

  test('a calculated-quote snapshot is skipped once and says why', async () => {
    await transform('calcquote_hours', `calcquote_hours:${marker}:1`, {
      id: '1',
      woid: '5555',
      hours: '2',
    })
    const skipped = await exceptionFor('not_migrated', 'calcquote_hours', 'calcquote_hours')
    expect(skipped?.migrationAction).toContain('snapshot')
    expect(skipped?.notes).toContain('stays in staging')
  })
})
