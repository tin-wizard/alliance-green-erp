/**
 * Group 8 — purchasing.
 *
 * Pinned here: a PO keeps its legacy id and has its totals recomputed from the
 * staged lines, a blank legacy PO number is generated and recorded, blank money on
 * a nullable column stays NULL (a NOT NULL one is 0.00 *with* an exception), a
 * received quantity becomes one synthetic opening receipt that does not post stock,
 * a supplier invoice whose stored total disagrees with its lines is recorded for
 * finance, and pre-order ids are preserved so `purchaseorder.pre_poid` resolves.
 */
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { getDb } from '@cls/db'
import { getConfig } from '@cls/core/env.server'
import {
  migrationExceptions,
  migrationRowMap,
  purchaseOrderInvoiceLines,
  purchaseOrderInvoices,
  purchaseOrderParts,
  purchaseOrderPreorders,
  purchaseOrderReceiptLines,
  purchaseOrderReceipts,
  purchaseOrderRfqLines,
  purchaseOrderRfqs,
  purchaseOrders,
  purchaseOrderSpecialParts,
  suppliers,
} from '@cls/db/schema'
import { runTransformerRow } from '../testing'
import { transformer } from './purchasing'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

const configured = (() => {
  try {
    return Boolean(process.env.DATABASE_URL ?? getConfig().databaseUrl)
  } catch {
    return Boolean(process.env.DATABASE_URL)
  }
})()

const marker = `po${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const dumpId = `test-dump-${marker}`

const base = 1_800_000_000 + Math.floor(Math.random() * 900_000)
const supplierId = base
const poWithLines = base + 10
const poWithNumber = base + 11
const poUnknownStatus = base + 12
const poForInvoice = base + 13
const poForPreorder = base + 14
const missingPo = base + 800
const preorderId = base + 30
const rfqId = base + 40
const missingRfq = base + 801
const invoiceId = base + 50

const poIds = [poWithLines, poWithNumber, poUnknownStatus, poForInvoice, poForPreorder]

async function transform(table: string, sourceKey: string, row: Record<string, string | null>) {
  await getDb().transaction(async (tx) => {
    await runTransformerRow(tx, transformer, { group: 'purchasing', table, sourceKey, row, dumpId })
  })
}

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

function poRow(id: number, overrides: Record<string, string | null> = {}) {
  return {
    id: String(id),
    purchase_order_number: '',
    invoice_number: '',
    supplier_id: String(supplierId),
    sub_supplier_id: '',
    cust_qoid: '',
    tjx_quoteid: '',
    pre_poid: '',
    sup_poid: '',
    req_qoid: '',
    sup_qoid: '',
    status: '3',
    status_on_july_21_2025: '3',
    priority: '2',
    supplier_notes: 'Leave at receiving',
    notes: '',
    expdeliverydate: '2025-03-15',
    tax_code: 'ON',
    appliedtaxrate: '',
    fob: '',
    pay_terms: 'Net 30',
    ship_address_contactname: 'Receiving',
    ship_address_company: 'CLS',
    ship_address_street1: '2 Main St',
    ship_address_street2: '',
    ship_address_city: 'Toronto',
    ship_address_province: 'ON',
    ship_address_postalcode: 'M5V 1A1',
    ship_address_phone: '',
    shipping_address: '',
    securitycode: '',
    shipping_code: '',
    ship_via: 'Purolator',
    createdby: '',
    is_marked_critical: '1',
    is_submitted: '1',
    completiondate: '',
    date_created: '2025-02-01 09:00:00',
    date_completed: '',
    po_folder_attach_path: '/mnt/old/po/1',
    is_online_vendor_order: '0',
    stock_updated: '0',
    revision_no: '0',
    is_type_maintenance: '0',
    shipment_type: 'cls',
    shipment_type_correction: '',
    shipment_type_bkup_18july2025: '',
    customerid: '',
    subcontractorid: '',
    is_alliance_stocktransfer_po: '0',
    trackingid: '1Z999',
    print_records_per_page: '10',
    tjx_parts_qty_type: '',
    is_approved: '1',
    override_supplier_is_under: '',
    transferring_from_type: '',
    is_alliance_stocktransfer_po_old: '',
    from_subcontractorid: '',
    from_customerid: '',
    transfer_came_from_poid: '',
    po_submitted_by: '',
    approval_request_by: '',
    last_status: '',
    status_changed_date: '',
    last_followup_reminder_date: '',
    ...overrides,
  }
}

afterAll(async () => {
  if (!configured) return
  const db = getDb()
  await db
    .delete(purchaseOrderReceiptLines)
    .where(
      inArray(
        purchaseOrderReceiptLines.receiptId,
        db
          .select({ id: purchaseOrderReceipts.id })
          .from(purchaseOrderReceipts)
          .where(inArray(purchaseOrderReceipts.poId, poIds)),
      ),
    )
  await db.delete(purchaseOrderReceipts).where(inArray(purchaseOrderReceipts.poId, poIds))
  await db
    .delete(purchaseOrderInvoiceLines)
    .where(
      inArray(
        purchaseOrderInvoiceLines.invoiceId,
        db
          .select({ id: purchaseOrderInvoices.id })
          .from(purchaseOrderInvoices)
          .where(inArray(purchaseOrderInvoices.poId, poIds)),
      ),
    )
  await db.delete(purchaseOrderInvoices).where(inArray(purchaseOrderInvoices.poId, poIds))
  await db.delete(purchaseOrderParts).where(inArray(purchaseOrderParts.poId, poIds))
  await db.delete(purchaseOrderSpecialParts).where(inArray(purchaseOrderSpecialParts.poId, poIds))
  await db
    .delete(purchaseOrderRfqLines)
    .where(inArray(purchaseOrderRfqLines.rfqId, [rfqId, missingRfq]))
  await db.delete(purchaseOrderRfqs).where(inArray(purchaseOrderRfqs.id, [rfqId]))
  await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, poIds))
  await db.delete(purchaseOrderPreorders).where(inArray(purchaseOrderPreorders.id, [preorderId]))
  await db.delete(suppliers).where(eq(suppliers.id, supplierId))
  for (const table of [
    'purchaseorder',
    'po_parts',
    'po_invoice',
    'po_invoice_parts',
    'po_preorder',
  ]) {
    await db.execute(
      sql`delete from ${sql.raw(`migration."stg_${table}"`)} where "_dump_id" = ${dumpId}`,
    )
  }
  await db.delete(migrationRowMap).where(like(migrationRowMap.sourceKey, `%${marker}%`))
  await db.delete(migrationExceptions).where(like(migrationExceptions.sourceKey, `%${marker}%`))
  // The whole-table skip is keyed by table name, so it is not covered by the marker.
  await db
    .delete(migrationExceptions)
    .where(
      and(
        eq(migrationExceptions.exceptionClass, 'not_migrated'),
        eq(migrationExceptions.entity, 'po_quote_request_status'),
      ),
    )
  // The special-part crosswalk above is keyed by the legacy id for the same reason.
  await db
    .delete(migrationRowMap)
    .where(
      and(
        eq(migrationRowMap.sourceTable, 'po_soparts'),
        eq(migrationRowMap.sourceKey, String(base + 61)),
      ),
    )
})

describe.skipIf(!configured)('purchasing group', () => {
  test('a PO keeps its id and recomputes its totals from the staged lines', async () => {
    const db = getDb()
    await db.insert(suppliers).values({ id: supplierId, name: `Supplier ${marker}` })
    await stage('po_parts', 1, {
      id: '1',
      poid: String(poWithLines),
      partno: 'LED-2X4',
      qty: '2.00',
      qty_received: '0.00',
      price: '50.00',
    })

    const sourceKey = `purchaseorder:${marker}:${poWithLines}`
    await transform('purchaseorder', sourceKey, poRow(poWithLines))

    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poWithLines))
    expect(row?.supplierId).toBe(supplierId)
    expect(row?.status).toBe(3)
    expect(row?.legacyStatus).toBe(3)
    expect(row?.shipmentType).toBe('cls')
    expect(row?.subtotal).toBe('100.00')
    expect(row?.tax).toBe('13.00')
    expect(row?.total).toBe('113.00')
    // Assert through Postgres's own text form: the wall clock MySQL wrote is the
    // wall clock a reader in the session timezone sees, with no UTC shift.
    const [stamped] = (await db.execute(
      sql`select to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') as at from app.purchase_orders where id = ${poWithLines}`,
    )) as unknown as Array<{ at: string }>
    expect(stamped?.at).toBe('2025-02-01 09:00:00')
    // The legacy display value was removed in 2025, so a blank one is generated
    // and recorded: nobody may later believe this number came from legacy.
    expect(row?.displayNumber).toBe(`PO-LEGACY-${poWithLines}`)
    const missing = await exceptionFor('missing_po_number', 'purchase_order', sourceKey)
    expect(missing?.migrationAction).toContain(`PO-LEGACY-${poWithLines}`)
  })

  test('a negative-quantity line is recorded for the owner, not inserted and not an error', async () => {
    const db = getDb()
    const lineKey = `po_parts:${marker}:neg`
    await transform('po_parts', lineKey, {
      id: '90',
      poid: String(poWithLines),
      partno: 'NEG-RETURN',
      qty: '-3.00',
      qty_received: '0.00',
      price: '0',
    })
    const recorded = await exceptionFor('negative_quantity', 'purchase_order_part', lineKey)
    expect(recorded?.migrationAction).toContain('qty >= 0')
    const lines = await db
      .select()
      .from(purchaseOrderParts)
      .where(and(eq(purchaseOrderParts.poId, poWithLines), eq(purchaseOrderParts.partNo, 'NEG-RETURN')))
    expect(lines).toHaveLength(0)
  })

  test('a legacy display number is kept as-is', async () => {
    const db = getDb()
    const sourceKey = `purchaseorder:${marker}:${poWithNumber}`
    await transform(
      'purchaseorder',
      sourceKey,
      poRow(poWithNumber, { purchase_order_number: ' 1042 ' }),
    )

    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poWithNumber))
    expect(row?.displayNumber).toBe('1042')
    expect(await exceptionFor('missing_po_number', 'purchase_order', sourceKey)).toBeNull()
  })

  test('an unknown status falls back to Saved with an exception', async () => {
    const db = getDb()
    const sourceKey = `purchaseorder:${marker}:${poUnknownStatus}`
    await transform('purchaseorder', sourceKey, poRow(poUnknownStatus, { status: '99' }))

    const [row] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, poUnknownStatus))
    expect(row?.status).toBe(3)
    const unknown = await exceptionFor('unknown_enum', 'purchase_order', sourceKey)
    expect(unknown?.notes).toContain('99')
  })

  test('a received quantity becomes one opening receipt that does not post stock', async () => {
    const db = getDb()
    await transform('po_parts', `po_parts:${marker}:1`, {
      id: '2',
      poid: String(poWithLines),
      partno: 'BALLAST-1',
      qty: '5.00',
      qty_received: '2.00',
      price: '20.00',
      under_warranty: '0',
    })

    const [receipt] = await db
      .select()
      .from(purchaseOrderReceipts)
      .where(eq(purchaseOrderReceipts.poId, poWithLines))
    expect(receipt?.idempotencyKey).toBe(`legacy-opening:${poWithLines}`)
    // The already-counted quantity must never post stock again.
    expect(receipt?.stockPostedAt).toBeNull()

    const lines = await db
      .select()
      .from(purchaseOrderReceiptLines)
      .where(eq(purchaseOrderReceiptLines.receiptId, receipt!.id))
    expect(lines).toHaveLength(1)
    expect(lines[0]?.qty).toBe('2.00')
  })

  test('blank money is recorded where the column forbids null, and stays NULL where it does not', async () => {
    const db = getDb()
    const lineKey = `po_parts:${marker}:2`
    await transform('po_parts', lineKey, {
      id: '3',
      poid: String(poWithLines),
      partno: 'SENSOR-9',
      qty: '1.00',
      qty_received: '0.00',
      price: '',
    })
    const [line] = await db
      .select()
      .from(purchaseOrderParts)
      .where(eq(purchaseOrderParts.partNo, 'SENSOR-9'))
    expect(line?.price).toBe('0.00')
    const blank = await exceptionFor('blank_money', 'purchase_order_part', lineKey)
    expect(blank?.migrationAction).toContain('NOT NULL')

    // The RFQ line target price is nullable, so a blank amount stays NULL.
    await transform('po_quote', `po_quote:${marker}:1`, {
      id: String(rfqId),
      poid: '',
      report: '',
      status: '1',
      priority: '',
      notes: '',
      date_received: '',
      date_created: '2025-02-01',
    })
    await transform('po_quote_requested_parts', `po_quote_requested_parts:${marker}:1`, {
      id: '4',
      req_qoid: String(rfqId),
      partno: 'LED-2X4',
      qty: '1',
      price: '',
      supplier_lists: 'Supplier A',
    })
    const [rfqLine] = await db
      .select()
      .from(purchaseOrderRfqLines)
      .where(eq(purchaseOrderRfqLines.rfqId, rfqId))
    expect(rfqLine?.targetPrice).toBeNull()
  })

  test('a PO line whose purchase order is missing is an orphan line', async () => {
    const db = getDb()
    const sourceKey = `po_parts:${marker}:3`
    await transform('po_parts', sourceKey, {
      id: '5',
      poid: String(missingPo),
      partno: 'GHOST',
      qty: '1.00',
      qty_received: '0.00',
      price: '1.00',
    })

    const rows = await db
      .select({ id: purchaseOrderParts.id })
      .from(purchaseOrderParts)
      .where(eq(purchaseOrderParts.poId, missingPo))
    expect(rows).toHaveLength(0)
    const orphan = await exceptionFor('orphan_line', 'purchase_order_part', sourceKey)
    expect(orphan?.migrationAction).toContain('po_id')
  })

  test('a supplier invoice records a disagreement between its total and its lines', async () => {
    const db = getDb()
    await stage('po_invoice_parts', 2, {
      id: '9002',
      poid: String(poForInvoice),
      invoice_id: String(invoiceId),
      partno: 'LED-2X4',
      qty: '2.00',
      price: '20.00',
      linetotal: '90.00',
      sortorder: '1',
    })

    await transform('purchaseorder', `purchaseorder:${marker}:${poForInvoice}`, poRow(poForInvoice))
    const sourceKey = `po_invoice:${marker}:${invoiceId}`
    await transform('po_invoice', sourceKey, {
      id: String(invoiceId),
      poid: String(poForInvoice),
      invoicenumber: '',
      invoice_supplier_id: String(supplierId),
      tax_amount: '13.00',
      tax_code: 'ON',
      workordernumber: '',
      shipping_charges: '',
      cls_invoicenumber: '',
      invoice_report: '',
      tax_hst: '',
      tax_gst: '',
      tax_pst: '',
      tax_tvp: '',
      sub_total: '100.00',
      total_amount: '113.00',
      createdby: '',
      date_created: '2025-02-05',
      invoice_date: '2025-02-04',
      invoice_level: '1',
      sage_done: '0',
      stock_updated_during_mark_invoice: '0',
      is_invoiced: '1',
      rgaid: '',
      forced_markinvoice_button: '0',
      appliedtaxrate: '',
      appliedtaxrate_pst: '',
    })

    const [invoice] = await db
      .select()
      .from(purchaseOrderInvoices)
      .where(eq(purchaseOrderInvoices.id, invoiceId))
    expect(invoice?.poId).toBe(poForInvoice)
    expect(invoice?.invoiceDate).toBe('2025-02-04')
    expect(invoice?.status).toBe('matched')
    // A blank supplier number is generated, and the row says so.
    expect(invoice?.supplierInvoiceNumber).toBe(`legacy-invoice-${invoiceId}`)
    const generated = await exceptionFor(
      'missing_invoice_number',
      'purchase_order_invoice',
      sourceKey,
    )
    expect(generated?.migrationAction).toContain(`legacy-invoice-${invoiceId}`)

    const unbalanced = await exceptionFor('unbalanced_totals', 'purchase_order_invoice', sourceKey)
    expect(unbalanced?.notes).toContain('sub_total = 100.00')
    expect(unbalanced?.notes).toContain('difference = -10.00')
  })

  test('pre-order ids are preserved so a PO reference resolves', async () => {
    const db = getDb()
    await transform('po_preorder', `po_preorder:${marker}:1`, {
      id: String(preorderId),
      cust_qoid: '',
      report: 'Awaiting quote',
      status: '1',
      priority: '2',
      notes: '',
      is_without_quote: '1',
      workordernumber: '5150',
      createdby: '',
      date_received: '2025-02-10',
      date_created: '2025-02-09',
    })

    const [preorder] = await db
      .select()
      .from(purchaseOrderPreorders)
      .where(eq(purchaseOrderPreorders.id, preorderId))
    expect(preorder?.id).toBe(preorderId)
    expect(preorder?.workOrderNumber).toBe(5150)
    expect(preorder?.isWithoutQuote).toBe(true)

    await transform(
      'purchaseorder',
      `purchaseorder:${marker}:${poForPreorder}`,
      poRow(poForPreorder, { pre_poid: String(preorderId) }),
    )
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poForPreorder))
    expect(po?.preorderId).toBe(preorderId)
  })

  test('a billed special part is an invoice line linked to the PO special line', async () => {
    const db = getDb()
    const specialLegacyId = base + 61
    // Keyed by the legacy id, as the runner keys it, so the invoice line below can
    // resolve the special line through the crosswalk.
    await transform('po_soparts', String(specialLegacyId), {
      id: String(specialLegacyId),
      poid: String(poForInvoice),
      name: 'Emergency ballast',
      qty: '1.00',
      qty_received: '0.00',
      price: '40.00',
    })

    const [special] = await db
      .select()
      .from(purchaseOrderSpecialParts)
      .where(eq(purchaseOrderSpecialParts.poId, poForInvoice))
    expect(special?.name).toBe('Emergency ballast')

    await transform('po_invoice_soparts', `po_invoice_soparts:${marker}:1`, {
      id: '7001',
      poid: String(poForInvoice),
      invoice_id: String(invoiceId),
      name: 'Emergency ballast',
      po_so_part_id: String(specialLegacyId),
      qty: '1.00',
      price: '40.00',
      linetotal: '40.00',
      sortorder: '2',
    })

    const [line] = await db
      .select()
      .from(purchaseOrderInvoiceLines)
      .where(
        and(
          eq(purchaseOrderInvoiceLines.invoiceId, invoiceId),
          eq(purchaseOrderInvoiceLines.specialPartLineId, special!.id),
        ),
      )
    expect(line?.partLineId).toBeNull()
    expect(line?.qty).toBe('1.00')
    expect(line?.lineTotal).toBe('40.00')
  })

  test('a vocabulary table is skipped once and says so', async () => {
    await transform('po_quote_request_status', `po_quote_request_status:${marker}:1`, {
      id: '1',
      name: 'waiting',
    })
    const skipped = await exceptionFor(
      'not_migrated',
      'po_quote_request_status',
      'po_quote_request_status',
    )
    expect(skipped?.migrationAction).toContain('vocabulary')
    expect(skipped?.notes).toContain('stays in staging')
  })
})
