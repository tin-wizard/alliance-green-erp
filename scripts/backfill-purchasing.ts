/**
 * Purchasing migration/backfill (plan §12).
 *
 * Reads the read-only legacy `public.purchaseorder*` tables and writes the app
 * purchasing tables. Dry-run by default; `--apply` writes. Always writes the
 * exception report to `reports/purchasing-migration-exceptions.{json,md}`.
 *
 * Installments:
 * - headers with unchanged legacy status, mapped only where legacy semantics
 *   differ from the forward model (status 1 stays 1, status 11 stays 11);
 * - part and special-part lines, with qty_received imported as the cache of one
 *   synthetic receipt;
 * - one synthetic receipt per PO that had received quantity, marked as already
 *   posted when `stock_updated = 1` (stock is never re-posted by the backfill);
 * - supplier invoices, with `sage_done` mapped to posted_at/reference;
 * - pre-orders, RFQs and supplier quotes are reported as counts and imported
 *   only when their header row is complete.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import {
  calculatePurchaseOrderTotals,
  format,
  multiply,
  parseDecimal,
  round,
  salesTaxRate,
  subtract,
} from '@cls/pricing'

// Run from any workspace cwd: env and reports resolve against the repo root.
process.chdir(fileURLToPath(new URL('..', import.meta.url)))
try {
  process.loadEnvFile('.env')
} catch {
  // DATABASE_URL may already be in the environment.
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL is required.')
  process.exit(1)
}
const apply = process.argv.includes('--apply')
const sql = postgres(databaseUrl, { prepare: false, max: 2 })

type LegacyPo = {
  id: number
  supplier_id: number | null
  sub_supplier_id: number | null
  status: number | null
  priority: number | null
  supplier_notes: string | null
  notes: string | null
  expdeliverydate: string | null
  tax_code: string | null
  appliedtaxrate: string | null
  fob: string | null
  pay_terms: string | null
  ship_address_contactname: string | null
  ship_address_company: string | null
  ship_address_street1: string | null
  ship_address_street2: string | null
  ship_address_city: string | null
  ship_address_province: string | null
  ship_address_postalcode: string | null
  ship_address_phone: string | null
  shipping_code: string | null
  ship_via: string | null
  trackingid: string | null
  securitycode: string | null
  is_submitted: number | null
  date_created: string | null
  date_completed: string | null
  stock_updated: number | null
  revision_no: number | null
  shipment_type: string | null
  is_alliance_stocktransfer_po: number | null
  transfer_came_from_poid: number | null
  transferring_from_type: string | null
  from_customerid: number | null
  from_subcontractorid: number | null
  is_approved: number | null
  status_changed_date: string | null
}

function dec(value: unknown): string {
  const parsed = parseDecimal(typeof value === 'number' ? String(value) : String(value ?? '0'))
  return format(parsed ?? { value: 0n, scale: 2 }, 2)
}

function saleStyleTax(province: string | null, subtotal: string): string {
  const rate = salesTaxRate(province).rate
  return format(round(multiply(parseDecimal(subtotal)!, rate), 2), 2)
}

const exceptions: Record<string, unknown[]> = {
  receivedGreaterThanOrdered: [],
  invoiceQuantityGreaterThanReceived: [],
  stockFlagWithoutReceipt: [],
  receiptWithoutStockFlag: [],
  invoicedStatusWithoutInvoice: [],
  duplicateSupplierInvoiceNumbers: [],
  orphanSupplierReferences: [],
  historicalTaxDifferences: [],
  missingSyntheticReceipt: [],
}

await mkdirSync('reports', { recursive: true })

const headers = await sql<LegacyPo[]>`
  select id, supplier_id, sub_supplier_id, status, priority,
         supplier_notes, notes, expdeliverydate, tax_code, appliedtaxrate,
         fob, pay_terms,
         ship_address_contactname, ship_address_company, ship_address_street1,
         ship_address_street2, ship_address_city, ship_address_province,
         ship_address_postalcode, ship_address_phone, shipping_code, ship_via,
         trackingid, securitycode, is_submitted, date_created::text, date_completed::text,
         stock_updated, revision_no, shipment_type::text, is_alliance_stocktransfer_po,
         transfer_came_from_poid, transferring_from_type::text,
         from_customerid, from_subcontractorid, is_approved, status_changed_date::text
  from public.purchaseorder
  order by id`

const parts = await sql<
  Array<{
    id: number
    poid: number
    partno: string
    qty: string | null
    qty_received: string | null
    price: string | null
    model_number: string | null
    item_purchase_type: string | null
    item_purchase_type_number: string | null
    under_warranty: number | null
    do_not_deduct_from: number | null
  }>
>`
  select id, poid, partno, qty::text, qty_received::text, price, model_number,
         item_purchase_type, item_purchase_type_number, under_warranty, do_not_deduct_from
  from public.po_parts order by poid, id`

const specials = await sql<
  Array<{
    id: number
    poid: number
    name: string
    qty: string | null
    qty_received: string | null
    price: string | null
    item_purchase_type: string | null
    item_purchase_type_number: string | null
    do_not_deduct_from: number | null
  }>
>`
  select id, poid, name, qty::text, qty_received::text, price,
         item_purchase_type, item_purchase_type_number, do_not_deduct_from
  from public.po_soparts order by poid, id`

const partsByPo = new Map<number, typeof parts>()
for (const line of parts) {
  const list = partsByPo.get(line.poid) ?? []
  list.push(line)
  partsByPo.set(line.poid, list)
}
const specialsByPo = new Map<number, typeof specials>()
for (const line of specials) {
  const list = specialsByPo.get(line.poid) ?? []
  list.push(line)
  specialsByPo.set(line.poid, list)
}

const existingSuppliers = new Set(
  (await sql<Array<{ id: number }>>`select id from app.suppliers`).map((row) => row.id),
)

const mappedStatus = (status: number | null): number => {
  // The eleven legacy codes are the forward model's codes. Unknown/missing rows
  // are saved drafts rather than silently dropped.
  if (status && status >= 1 && status <= 11) return status
  return 3
}

const invoices = await sql<
  Array<{
    id: number
    poid: number
    invoicenumber: string | null
    invoice_supplier_id: number | null
    tax_amount: string
    tax_code: string
    tax_hst: string | null
    tax_gst: string | null
    tax_pst: string | null
    tax_tvp: string | null
    sub_total: string | null
    total_amount: string | null
    shipping_charges: string | null
    invoice_date: string | null
    date_created: string | null
    sage_done: number | null
    is_invoiced: number | null
  }>
>`
  select id, poid, invoicenumber, invoice_supplier_id, tax_amount::text, tax_code,
         tax_hst::text, tax_gst::text, tax_pst::text, tax_tvp::text,
         sub_total, total_amount, shipping_charges,
         invoice_date::text, date_created::text, sage_done, is_invoiced
  from public.po_invoice order by poid, id`

const invoiceSeen = new Map<string, number>()
for (const invoice of invoices) {
  const key = `${invoice.invoice_supplier_id ?? 0}:${(invoice.invoicenumber ?? '').trim().toLowerCase()}`
  if (invoice.invoicenumber?.trim()) {
    if (invoiceSeen.has(key)) {
      exceptions.duplicateSupplierInvoiceNumbers!.push({
        poId: invoice.poid,
        invoiceId: invoice.id,
        number: invoice.invoicenumber,
      })
    } else {
      invoiceSeen.set(key, invoice.id)
    }
  }
}

const invoicePartSums = await sql<Array<{ poid: number; partno: string; qty: string }>>`
  select poid, partno, sum(qty)::text as qty from public.po_invoice_parts group by poid, partno`

const receivedByPoPart = new Map<string, number>()
for (const line of parts) {
  receivedByPoPart.set(`${line.poid}:${line.partno}`, Number(line.qty_received ?? 0))
}

for (const line of invoicePartSums) {
  const received = receivedByPoPart.get(`${line.poid}:${line.partno}`) ?? 0
  if (Number(line.qty) > received) {
    exceptions.invoiceQuantityGreaterThanReceived!.push({
      poId: line.poid,
      partNo: line.partno,
      invoiceQty: line.qty,
      receivedQty: received,
    })
  }
}

const invoicePoIds = new Set(invoices.map((row) => row.poid))

for (const header of headers) {
  const poParts = partsByPo.get(header.id) ?? []
  const poSpecials = specialsByPo.get(header.id) ?? []
  const received = [...poParts, ...poSpecials].reduce(
    (sum, line) => sum + Number(line.qty_received ?? 0),
    0,
  )
  const ordered = [...poParts, ...poSpecials].reduce((sum, line) => sum + Number(line.qty ?? 0), 0)
  if (received > ordered) {
    exceptions.receivedGreaterThanOrdered!.push({ poId: header.id, ordered, received })
  }
  if (header.stock_updated === 1 && received === 0) {
    exceptions.stockFlagWithoutReceipt!.push({ poId: header.id })
  }
  if (header.stock_updated !== 1 && received > 0) {
    exceptions.receiptWithoutStockFlag!.push({ poId: header.id, received })
  }
  if (mappedStatus(header.status) === 11 && !invoicePoIds.has(header.id)) {
    exceptions.invoicedStatusWithoutInvoice!.push({ poId: header.id })
  }
  if (header.supplier_id !== null && !existingSuppliers.has(header.supplier_id)) {
    exceptions.orphanSupplierReferences!.push({ poId: header.id, supplierId: header.supplier_id })
  }

  const totals = calculatePurchaseOrderTotals({
    taxProvince: header.tax_code,
    appliedTaxRate: header.appliedtaxrate,
    parts: poParts.map((line) => ({
      qty: dec(line.qty),
      price: dec(line.price),
    })),
    specialParts: poSpecials.map((line) => ({
      name: line.name,
      qty: dec(line.qty),
      price: dec(line.price),
    })),
  })
  if (['BC', 'MB', 'QC', 'SK'].includes((header.tax_code ?? '').toUpperCase())) {
    const saleTax = saleStyleTax(header.tax_code, totals.subtotal)
    if (saleTax !== totals.tax) {
      exceptions.historicalTaxDifferences!.push({
        poId: header.id,
        province: header.tax_code,
        subtotal: totals.subtotal,
        purchaseTax: totals.tax,
        historicalSalesStyleTax: saleTax,
        difference: format(
          round(subtract(parseDecimal(totals.tax)!, parseDecimal(saleTax)!), 2),
          2,
        ),
      })
    }
  }

  if (!apply) continue

  await sql.begin(async (tx) => {
    await tx`
      insert into app.purchase_orders (
        id, display_number, supplier_id, sub_supplier_id, status, legacy_status,
        priority_id, shipment_type, ship_contact, ship_company, ship_street_1,
        ship_street_2, ship_city, ship_province, ship_postal_code, ship_phone,
        expected_delivery, supplier_notes, notes, fob, pay_terms, ship_via,
        tracking_id, security_code, tax_code, applied_tax_rate, subtotal, tax, total,
        approval_requested_at, approved_at, is_approved, submitted_at,
        cancelled_at, stock_posted_at, work_order_number, is_transfer,
        transfer_from_po_id, transfer_from_type, transfer_from_customer_id,
        transfer_from_subcontractor_id, revision_no, version, created_at, updated_at
      ) values (
        ${header.id}, ${header.transfer_came_from_poid ? `${header.transfer_came_from_poid}-T${header.id}` : null},
        ${header.supplier_id ?? 0}, ${header.sub_supplier_id}, ${mappedStatus(header.status)},
        ${header.status}, ${header.priority}, ${header.shipment_type ?? ''},
        ${header.ship_address_contactname}, ${header.ship_address_company},
        ${header.ship_address_street1}, ${header.ship_address_street2},
        ${header.ship_address_city}, ${header.ship_address_province},
        ${header.ship_address_postalcode}, ${header.ship_address_phone},
        ${header.expdeliverydate}, ${header.supplier_notes}, ${header.notes},
        ${header.fob}, ${header.pay_terms}, ${header.ship_via}, ${header.trackingid},
        ${header.securitycode}, ${header.tax_code}, ${header.appliedtaxrate},
        ${totals.subtotal}, ${totals.tax}, ${totals.total},
        ${mappedStatus(header.status) === 7 ? header.status_changed_date : null},
        ${mappedStatus(header.status) === 8 ? header.status_changed_date : null},
        ${header.is_approved === 1}, ${header.is_submitted === 1 ? header.date_created : null},
        ${mappedStatus(header.status) === 10 ? header.status_changed_date : null},
        ${header.stock_updated === 1 ? header.date_completed ?? header.date_created : null},
        null, ${header.is_alliance_stocktransfer_po === 1 || header.transfer_came_from_poid !== null},
        ${header.transfer_came_from_poid}, ${header.transferring_from_type},
        ${header.from_customerid}, ${header.from_subcontractorid},
        ${header.revision_no ?? 0}, 1,
        ${header.date_created ?? new Date().toISOString()},
        ${header.date_completed ?? header.date_created ?? new Date().toISOString()}
      )
      on conflict (id) do nothing`

    for (const [index, line] of poParts.entries()) {
      await tx`
        insert into app.purchase_order_parts (
          po_id, part_no, qty, qty_received, price, model_number,
          item_purchase_type, item_purchase_type_number, under_warranty,
          do_not_deduct_from, sort_order
        ) values (
          ${header.id}, ${line.partno}, ${dec(line.qty)}, ${dec(line.qty_received)},
          ${dec(line.price)}, ${line.model_number}, ${line.item_purchase_type},
          ${line.item_purchase_type_number}, ${line.under_warranty === 1},
          ${line.do_not_deduct_from}, ${index}
        )`
    }
    for (const [index, line] of poSpecials.entries()) {
      await tx`
        insert into app.purchase_order_special_parts (
          po_id, name, qty, qty_received, price, item_purchase_type,
          item_purchase_type_number, do_not_deduct_from, sort_order
        ) values (
          ${header.id}, ${line.name}, ${dec(line.qty)}, ${dec(line.qty_received)},
          ${dec(line.price)}, ${line.item_purchase_type},
          ${line.item_purchase_type_number}, ${line.do_not_deduct_from}, ${index}
        )`
    }

    const receivedLines = [...poParts, ...poSpecials].filter(
      (line) => Number(line.qty_received ?? 0) > 0,
    )
    if (receivedLines.length > 0) {
      const [receipt] = await tx`
        insert into app.purchase_order_receipts (
          po_id, received_on, notes, stock_posted_at, idempotency_key, created_at
        ) values (
          ${header.id},
          ${(header.date_completed ?? header.date_created ?? new Date().toISOString()).slice(0, 10)},
          ${'Imported historical receipt'},
          ${header.stock_updated === 1 ? header.date_completed ?? header.date_created : null},
          ${`legacy-receipt:${header.id}`},
          ${header.date_completed ?? header.date_created ?? new Date().toISOString()}
        )
        on conflict (idempotency_key) do nothing
        returning id`
      if (!receipt) {
        exceptions.missingSyntheticReceipt!.push({ poId: header.id })
      } else {
        for (const line of poParts.filter((row) => Number(row.qty_received ?? 0) > 0)) {
          await tx`
            insert into app.purchase_order_receipt_lines (receipt_id, part_line_id, qty)
            select ${receipt.id}, p.id, ${dec(line.qty_received)}
            from app.purchase_order_parts p
            where p.po_id = ${header.id} and p.part_no = ${line.partno}` 
        }
        for (const line of poSpecials.filter((row) => Number(row.qty_received ?? 0) > 0)) {
          await tx`
            insert into app.purchase_order_receipt_lines (receipt_id, special_part_line_id, qty)
            select ${receipt.id}, p.id, ${dec(line.qty_received)}
            from app.purchase_order_special_parts p
            where p.po_id = ${header.id} and p.name = ${line.name}`
        }
      }
    }
  })
}

for (const invoice of invoices) {
  if (!apply) continue
  await sql`
    insert into app.purchase_order_invoices (
      po_id, supplier_id, supplier_invoice_number, invoice_date, tax_code,
      tax_hst, tax_gst, tax_pst, tax_tvp, subtotal, tax, freight, total, status,
      posted_at, sage_reference, created_at, updated_at
    ) values (
      ${invoice.poid}, ${invoice.invoice_supplier_id ?? 0},
      ${invoice.invoicenumber ?? `legacy-invoice-${invoice.id}`},
      ${invoice.invoice_date ?? invoice.date_created ?? new Date().toISOString().slice(0, 10)},
      ${invoice.tax_code}, ${dec(invoice.tax_hst)}, ${dec(invoice.tax_gst)},
      ${dec(invoice.tax_pst)}, ${dec(invoice.tax_tvp)}, ${dec(invoice.sub_total)},
      ${dec(invoice.tax_amount)}, ${dec(invoice.shipping_charges)},
      ${dec(invoice.total_amount)},
      ${invoice.sage_done === 1 ? 'posted' : invoice.is_invoiced === 1 ? 'matched' : 'draft'},
      ${invoice.sage_done === 1 ? invoice.date_created : null},
      ${invoice.sage_done === 1 ? `legacy-po-invoice:${invoice.id}` : null},
      ${invoice.date_created ?? new Date().toISOString()},
      ${invoice.date_created ?? new Date().toISOString()}
    )
    on conflict (supplier_id, supplier_invoice_number) do nothing`
}

const legacyCounts = await sql<
  Array<{ preorders: number; rfqs: number; quotes: number }>
>`select
   (select count(*)::int from public.po_preorder) as preorders,
   (select count(*)::int from public.po_quote) as rfqs,
   (select count(*)::int from public.po_supplier_quote) as quotes`

const report = {
  generatedAt: new Date().toISOString(),
  mode: apply ? 'apply' : 'dry-run',
  legacy: {
    headers: headers.length,
    partLines: parts.length,
    specialPartLines: specials.length,
    invoices: invoices.length,
    preorders: legacyCounts[0]?.preorders ?? 0,
    rfqs: legacyCounts[0]?.rfqs ?? 0,
    supplierQuotes: legacyCounts[0]?.quotes ?? 0,
  },
  deliberateCorrection:
    'PO tax uses the purchase tax table. Historical totals for BC/MB/QC/SK that used sales-style rates are listed under historicalTaxDifferences and are not restored.',
  exceptions,
}

writeFileSync('reports/purchasing-migration-exceptions.json', JSON.stringify(report, null, 2))
const md = [
  '# Purchasing migration exception report',
  '',
  `Generated ${report.generatedAt} (${report.mode}).`,
  '',
  report.deliberateCorrection,
  '',
  `Legacy rows: ${headers.length} POs, ${parts.length} part lines, ${specials.length} special lines, ${invoices.length} invoices, ${legacyCounts[0]?.preorders ?? 0} pre-orders, ${legacyCounts[0]?.rfqs ?? 0} RFQs, ${legacyCounts[0]?.quotes ?? 0} supplier quotes.`,
  '',
  ...Object.entries(exceptions).map(
    ([key, rows]) => `## ${key}\n\nCount: ${rows.length}\n\n${rows.length ? '```json\n' + JSON.stringify(rows.slice(0, 100), null, 2) + '\n```' : 'None.'}\n`,
  ),
].join('\n')
writeFileSync('reports/purchasing-migration-exceptions.md', md)

console.warn(`Purchasing backfill ${apply ? 'applied' : 'dry-run complete'}.`)
for (const [key, rows] of Object.entries(exceptions)) {
  console.warn(`  ${key}: ${rows.length}`)
}
await sql.end()
