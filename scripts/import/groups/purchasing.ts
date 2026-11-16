/**
 * Group 8 — purchasing (plan §2.5 step 8).
 *
 * `purchaseorder.id` is the PO number (BUSINESS-RULES D3), so the legacy id is
 * preserved as the target id and every child, pre-order, RFQ and supplier invoice
 * keeps its legacy id too. That is what makes `pre_poid`, `req_qoid`,
 * `invoice_id` and `sup_qoid` cross-references resolvable without a second pass.
 *
 * Three rules shape this file:
 *
 *  - `purchaseorder.purchase_order_number` is a legacy display value only (the PO
 *    number concept was removed 2025-07-07). A blank one is generated as
 *    `PO-LEGACY-<id>` (a transfer keeps its `<fromPo>-T<id>` form) and recorded as
 *    `missing_po_number`, so nobody later believes the legacy system printed it.
 *  - Money in `varchar` goes through `helpers.money`: blank is null. Where the
 *    target column is NOT NULL the value becomes 0.00 **with a `blank_money`
 *    exception**, never a silent zero.
 *  - §2.5: `po_parts.qty_received` becomes one synthetic opening receipt per PO
 *    plus one receipt line per received line, with `stock_posted_at = null`. The
 *    stock ledger itself belongs to the inventory group; this group only records
 *    that the goods were already counted.
 */
import { and, eq, sql } from 'drizzle-orm'
import type { Tx } from '@cls/db'
// Relative on purpose: `scripts/` is outside the workspace packages, so the bare
// `@cls/pricing` specifier only resolves through the repo tsconfig `paths`, which
// the migration runner has and a lone script does not.
import {
  calculatePurchaseOrderTotals,
  format,
  isZero,
  parseDecimal,
  round,
  subtract,
} from '../../../packages/pricing/src/index'
import {
  purchaseOrderInvoiceLines,
  purchaseOrderInvoices,
  purchaseOrderParts,
  purchaseOrderPreorderParts,
  purchaseOrderPreorders,
  purchaseOrderPreorderSpecialParts,
  purchaseOrderPreorderSuppliers,
  purchaseOrderReceiptLines,
  purchaseOrderReceipts,
  purchaseOrderRfqLines,
  purchaseOrderRfqs,
  purchaseOrderRfqSuppliers,
  purchaseOrders,
  purchaseOrderSpecialParts,
  purchaseOrderSupplierQuoteLines,
  purchaseOrderSupplierQuotes,
  quotes,
  rejectedInvoices,
  salesInvoices,
  suppliers,
  users,
} from '@cls/db/schema'
import type { GroupTransformer, TransformContext, TransformHelpers } from '../types'
import { selectIdMemo } from '../exists-memo'

const GROUP = 'purchasing'

/** `purchaseorder.shipment_type` and `transferring_from_type` share one list. */
const SHIPMENT_TYPES = [
  '',
  'alliance',
  'cls',
  'alliancepickup',
  'clspickup',
  'contractor',
  'customer',
  'subcontractor',
  'clscustomer',
  'alliancemaintenance',
] as const
const PURCHASE_TYPES = ['workorder', 'stock', 'cls', 'projectpo'] as const

const LEGACY_TO_ENTITY: Record<string, string> = {
  purchaseorder: 'purchase_order',
  po_parts: 'purchase_order_part',
  po_soparts: 'purchase_order_special_part',
  po_preorder: 'purchase_order_preorder',
  po_preorder_parts: 'purchase_order_preorder_part',
  po_preorder_soparts: 'purchase_order_preorder_special_part',
  po_invoice: 'purchase_order_invoice',
  po_invoice_parts: 'purchase_order_invoice_part',
  po_quote: 'purchase_order_rfq',
  po_quote_requested_parts: 'purchase_order_rfq_line',
  rejected_invoices: 'rejected_invoice',
}

type ExceptionInput = Parameters<TransformHelpers['exception']>[0]

/**
 * `types.ts`'s `ExceptionClass` union predates these groups; the column is free
 * text and `helpers.exception` already casts, so the extra labels land as written.
 */
async function recordException(
  helpers: TransformHelpers,
  input: Omit<ExceptionInput, 'exceptionClass'> & { exceptionClass: string },
): Promise<void> {
  await helpers.exception({
    ...input,
    exceptionClass: input.exceptionClass as ExceptionInput['exceptionClass'],
  })
}

function entityFor(table: string): string {
  return LEGACY_TO_ENTITY[table] ?? 'purchase_order'
}

function intOf(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function decimalOf(raw: string | null): string | null {
  if (raw === null) return null
  const trimmed = raw.trim().replace(/%$/, '')
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed.toFixed(5) : null
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/

/**
 * Text through Postgres keeps the legacy wall clock. Drizzle's insert type for a
 * `timestamp` column is `Date`, and a JS `Date` would turn local wall clock into a
 * UTC instant, so the ISO text is handed to Postgres as SQL and parsed in the
 * session timezone — exactly what MySQL wrote.
 */
function stamp(value: string | null): Date | null {
  return value === null ? null : (sql`${value}::timestamp` as unknown as Date)
}

async function timestampOf(
  helpers: TransformHelpers,
  context: TransformContext,
  column: string,
): Promise<string | null> {
  const value = helpers.timestamp(column)
  if (value === null) return null
  if (ISO_TIMESTAMP.test(value)) return value
  await recordException(helpers, {
    exceptionClass: 'unparseable_timestamp',
    entity: entityFor(context.table),
    sourceKey: context.sourceKey,
    action: 'stored NULL timestamp',
    notes: `${column} = ${JSON.stringify(value)} is not wall-clock ISO text`,
  })
  return null
}

async function requiredMoney(
  helpers: TransformHelpers,
  context: TransformContext,
  column: string,
): Promise<string> {
  const value = helpers.money(column)
  if (value !== null) return value
  const raw = (context.row[column] ?? '').trim()
  await recordException(helpers, {
    exceptionClass: raw === '' ? 'blank_money' : 'unparseable_money',
    entity: entityFor(context.table),
    sourceKey: context.sourceKey,
    action: 'stored 0.00 because the target column is NOT NULL',
    notes: `${column} = ${JSON.stringify(context.row[column])}`,
  })
  return '0.00'
}

function isNumber(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false
  const trimmed = value.trim()
  return trimmed !== '' && Number.isFinite(Number(trimmed.replace(/[$,\s]/g, '')))
}

function numberOr(value: string | null | undefined, fallback: string): string {
  if (!isNumber(value)) return fallback
  return String(Number(String(value).replace(/[$,\s]/g, '')))
}

async function alreadyMapped(context: TransformContext): Promise<boolean> {
  const existing = await context.helpers.targetKey(
    entityFor(context.table),
    context.table,
    context.sourceKey,
  )
  return existing !== null
}

async function rememberRow(
  context: TransformContext,
  targetTable: string,
  targetKey: string,
): Promise<void> {
  await context.helpers.remember({
    entity: entityFor(context.table),
    sourceTable: context.table,
    sourceKey: context.sourceKey,
    targetTable,
    targetKey,
  })
}

interface StagedLine {
  [column: string]: string | null
}

async function stagedLines(
  tx: Tx,
  table: string,
  dumpId: string,
  column: string,
  key: string,
): Promise<StagedLine[]> {
  const rows = (await tx.execute(
    sql`select * from ${sql.raw(`migration."stg_${table}"`)} where "_dump_id" = ${dumpId} and ${sql.raw(`"${column}"`)} = ${key}`,
  )) as unknown as StagedLine[]
  return rows ?? []
}

/** Move a serial past the explicit legacy ids this group inserts. */
async function bumpSequence(tx: Tx, table: string, column = 'id'): Promise<void> {
  await tx.execute(
    sql`select setval(pg_get_serial_sequence(${`app.${table}`}, ${column}), greatest((select coalesce(max(${sql.raw(`"${column}"`)}), 1) from ${sql.raw(`app."${table}"`)}), 1))`,
  )
}

/* ------------------------------ parent lookups ----------------------------- */

async function resolveSupplier(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('supplier', 'suppliers', String(legacyId))
  const candidate = intOf(mapped) ?? legacyId
  const [row] = await selectIdMemo(tx, suppliers.id, candidate)
  return row?.id ?? null
}

async function resolveUser(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<string | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('user', 'users', String(legacyId))
  if (mapped !== null) return mapped
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.legacyId, legacyId))
    .limit(1)
  return row?.id ?? null
}

/** `po_submitted_by` is a legacy username, not an id. */
async function resolveUserByName(tx: Tx, username: string | null): Promise<string | null> {
  if (username === null) return null
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .limit(1)
  return row?.id ?? null
}

/** A quote id referenced from a PO; both legacy headers share one target table. */
async function resolveQuote(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  for (const sourceTable of ['customer_quote', 'standalone_quote']) {
    const mapped = await helpers.targetKey('quote', sourceTable, String(legacyId))
    const candidate = intOf(mapped)
    if (candidate !== null) return candidate
  }
  const [row] = await selectIdMemo(tx, quotes.id, legacyId)
  return row?.id ?? null
}

async function poExists(tx: Tx, id: number): Promise<boolean> {
  const [row] = await selectIdMemo(tx, purchaseOrders.id, id)
  return row !== undefined
}

async function requirePurchaseOrder(
  context: TransformContext,
  column: string,
): Promise<number | null> {
  const { tx, helpers } = context
  const id = helpers.int(column)
  if (id !== null) {
    const mapped = await helpers.targetKey('purchase_order', 'purchaseorder', String(id))
    const candidate = intOf(mapped) ?? id
    if (await poExists(tx, candidate)) return candidate
  }
  await recordException(helpers, {
    exceptionClass: 'orphan_line',
    entity: entityFor(context.table),
    sourceKey: context.sourceKey,
    action: 'row not inserted: po_id is NOT NULL and the purchase order does not exist',
    notes: `${column} = ${JSON.stringify(context.row[column])}`,
  })
  return null
}

/* --------------------------------- headers -------------------------------- */

async function displayNumberFor(
  context: TransformContext,
  id: number,
  transferFromPoId: number | null,
): Promise<string> {
  const { tx, helpers } = context
  const declared = helpers.text('purchase_order_number')
  let candidate: string
  if (declared !== null) {
    candidate = declared
  } else if (transferFromPoId !== null) {
    candidate = `${transferFromPoId}-T${id}`
  } else {
    candidate = `PO-LEGACY-${id}`
  }

  const [clash] = await tx
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.displayNumber, candidate), sql`${purchaseOrders.id} <> ${id}`))
    .limit(1)

  if (declared === null) {
    await helpers.exception({
      exceptionClass: 'missing_po_number',
      entity: 'purchase_order',
      sourceKey: context.sourceKey,
      action: `generated display number ${candidate}`,
      notes: 'legacy purchase_order_number is blank; the display value is not a legacy figure',
    })
    return candidate
  }
  if (clash) {
    const suffixed = `${candidate}-${id}`
    await recordException(helpers, {
      exceptionClass: 'duplicate_display_number',
      entity: 'purchase_order',
      sourceKey: context.sourceKey,
      action: `stored ${suffixed}; the legacy number already belongs to another PO`,
      notes: `purchase_order_number = ${JSON.stringify(declared)}`,
    })
    return suffixed
  }
  return candidate
}

/** Recompute the PO totals from its staged lines with the shared purchase rules. */
async function poTotals(
  context: TransformContext,
  id: number,
  taxCode: string | null,
  appliedTaxRate: string | null,
): Promise<{ subtotal: string; tax: string; total: string }> {
  const { tx, dumpId } = context
  const [parts, specialParts] = await Promise.all([
    stagedLines(tx, 'po_parts', dumpId, 'poid', String(id)),
    stagedLines(tx, 'po_soparts', dumpId, 'poid', String(id)),
  ])
  try {
    const totals = calculatePurchaseOrderTotals({
      taxProvince: taxCode,
      appliedTaxRate,
      parts: parts
        .filter((line) => isNumber(line.qty) && isNumber(line.price))
        .map((line) => ({ qty: numberOr(line.qty, '0'), price: numberOr(line.price, '0') })),
      specialParts: specialParts
        .filter((line) => isNumber(line.qty) && isNumber(line.price))
        .map((line) => ({
          name: (line.name ?? '').trim() === '' ? 'unnamed' : (line.name ?? ''),
          qty: numberOr(line.qty, '0'),
          price: numberOr(line.price, '0'),
        })),
    })
    return { subtotal: totals.subtotal, tax: totals.tax, total: totals.total }
  } catch {
    // The calculator refuses values it cannot round; the line rows carry the
    // per-value exceptions, so the header keeps its column defaults.
    return { subtotal: '0.00', tax: '0.00', total: '0.00' }
  }
}

async function transformPurchaseOrder(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const id = helpers.int('id')
  if (id === null) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: 'purchase_order',
      sourceKey,
      action: 'row not inserted: the purchase order has no id',
      notes: `id = ${JSON.stringify(context.row.id)}`,
    })
    return
  }

  const supplierRaw = helpers.int('supplier_id')
  let supplierId = await resolveSupplier(tx, helpers, supplierRaw)
  if (supplierId === null) {
    // `supplier_id` is NOT NULL. A raw legacy id keeps the PO visible; 0 is the
    // only value left when the row never named a supplier at all.
    supplierId = supplierRaw ?? 0
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: 'purchase_order',
      sourceKey,
      action:
        supplierRaw === null
          ? 'stored supplier_id 0: the row has no supplier'
          : 'raw legacy supplier id preserved; no app.suppliers row exists',
      notes: `supplier_id = ${JSON.stringify(context.row.supplier_id)}`,
    })
  }

  const statusRaw = helpers.enumOf('status', [
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    '10',
    '11',
  ] as const)
  if (statusRaw === null && (context.row.status ?? '').trim() !== '') {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity: 'purchase_order',
      sourceKey,
      action: 'stored status 3 (Saved) because the target column is NOT NULL',
      notes: `status = ${JSON.stringify(context.row.status)} is not one of 1-11`,
    })
  }
  const status = statusRaw === null ? 3 : Number(statusRaw)

  const shipmentType = helpers.enumOf('shipment_type', SHIPMENT_TYPES)
  if (shipmentType === null && (context.row.shipment_type ?? '').trim() !== '') {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity: 'purchase_order',
      sourceKey,
      action: "stored shipment_type ''",
      notes: `shipment_type = ${JSON.stringify(context.row.shipment_type)}`,
    })
  }

  const transferFromPoId = helpers.int('transfer_came_from_poid')
  const transferFromType = helpers.enumOf('transferring_from_type', SHIPMENT_TYPES)
  const taxCode = helpers.text('tax_code')
  const appliedTaxRate = decimalOf(helpers.text('appliedtaxrate'))
  const totals = await poTotals(context, id, taxCode, appliedTaxRate)

  const statusChanged = stamp(await timestampOf(helpers, context, 'status_changed_date'))
  const dateCreated = stamp(await timestampOf(helpers, context, 'date_created'))
  const dateCompleted = stamp(await timestampOf(helpers, context, 'date_completed'))
  const isApproved = helpers.flag('is_approved') === 1

  const values: typeof purchaseOrders.$inferInsert = {
    id,
    displayNumber: await displayNumberFor(context, id, transferFromPoId),
    supplierId,
    subSupplierId: helpers.int('sub_supplier_id'),
    status,
    // The forward status keeps the legacy code where the meanings agree; the raw
    // legacy value is kept beside it so a reviewer can see what was mapped.
    legacyStatus: helpers.int('status'),
    priorityId: helpers.int('priority'),
    shipmentType: shipmentType ?? '',
    shipContact: helpers.text('ship_address_contactname'),
    shipCompany: helpers.text('ship_address_company'),
    shipStreet1: helpers.text('ship_address_street1'),
    shipStreet2: helpers.text('ship_address_street2'),
    shipCity: helpers.text('ship_address_city'),
    shipProvince: helpers.text('ship_address_province'),
    shipPostalCode: helpers.text('ship_address_postalcode'),
    shipPhone: helpers.text('ship_address_phone'),
    expectedDelivery: helpers.date('expdeliverydate'),
    supplierNotes: helpers.text('supplier_notes'),
    notes: helpers.text('notes'),
    fob: helpers.text('fob'),
    payTerms: helpers.text('pay_terms'),
    shipVia: helpers.text('ship_via'),
    trackingId: helpers.text('trackingid'),
    securityCode: helpers.text('securitycode'),
    taxCode,
    appliedTaxRate,
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
    approvalRequestBy: await resolveUser(tx, helpers, helpers.int('approval_request_by')),
    approvalRequestedAt: status === 7 ? statusChanged : null,
    approvedAt: status === 8 ? statusChanged : null,
    isApproved,
    poSubmittedBy: await resolveUserByName(tx, helpers.text('po_submitted_by')),
    submittedAt: helpers.flag('is_submitted') === 1 ? dateCreated : null,
    cancelledAt: status === 10 ? statusChanged : null,
    stockPostedAt: helpers.flag('stock_updated') === 1 ? (dateCompleted ?? dateCreated) : null,
    sourceQuoteId: await resolveQuote(tx, helpers, helpers.int('cust_qoid')),
    // Pre-orders and RFQs keep their legacy ids, so the reference is valid even
    // though they are transformed later in this group.
    preorderId: helpers.int('pre_poid'),
    rfqId: helpers.int('req_qoid'),
    supplierQuoteId: null,
    isTransfer: helpers.flag('is_alliance_stocktransfer_po') === 1 || transferFromPoId !== null,
    transferFromPoId,
    transferFromType,
    transferFromCustomerId: helpers.int('from_customerid'),
    transferFromSubcontractorId: helpers.int('from_subcontractorid'),
    revisionNo: helpers.int('revision_no') ?? 0,
    createdBy: await resolveUser(tx, helpers, helpers.int('createdby')),
    ...(dateCreated === null ? {} : { createdAt: dateCreated }),
  }

  const { id: _number, ...updates } = values
  await tx
    .insert(purchaseOrders)
    .values(values)
    .onConflictDoUpdate({ target: purchaseOrders.id, set: updates })
  await rememberRow(context, 'purchase_orders', String(id))
}

/* ------------------------------ PO line items ------------------------------ */

/** One synthetic opening receipt per PO (§2.5). Never posts stock again. */
async function ensureOpeningReceipt(context: TransformContext, poId: number): Promise<number> {
  const { tx } = context
  const [po] = await tx
    .select({ createdAt: purchaseOrders.createdAt, stockPostedAt: purchaseOrders.stockPostedAt })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, poId))
    .limit(1)
  const receivedOn = (po?.createdAt ?? new Date()).toISOString().slice(0, 10)
  const [receipt] = await tx
    .insert(purchaseOrderReceipts)
    .values({
      poId,
      receivedOn,
      notes: 'Imported historical receipt',
      // The already-counted quantity is not posted again by this migration.
      stockPostedAt: null,
      idempotencyKey: `legacy-opening:${poId}`,
    })
    .onConflictDoUpdate({
      target: purchaseOrderReceipts.idempotencyKey,
      set: { notes: 'Imported historical receipt' },
    })
    .returning({ id: purchaseOrderReceipts.id })
  return receipt!.id
}

/**
 * The ERP stores purchase-order quantities as zero or more. The legacy portal let
 * a line carry a negative quantity (32 purchase orders, 71 lines in the 2026-11
 * dump). The data says they are stock write-offs and internal returns booked
 * through $0 purchase orders, not supplier returns: no RGA references them, none
 * was received, most are priced at 0, and the PO notes say "write off" and
 * "removing material from ... stock". How the ERP keeps them is the business
 * owner's call, so the line is not inserted and the decision is recorded, never
 * guessed.
 */
async function skipNegativeQuantity(
  context: TransformContext,
  qty: string,
): Promise<boolean> {
  if (Number(qty) >= 0) return false
  await recordException(context.helpers, {
    exceptionClass: 'negative_quantity',
    entity: entityFor(context.table),
    sourceKey: context.sourceKey,
    action: 'line not inserted: the ERP requires qty >= 0; the owner decides how a negative line is kept',
    notes: `poid = ${JSON.stringify(context.row.poid)}, qty = ${JSON.stringify(context.row.qty)}, price = ${JSON.stringify(context.row.price)}`,
  })
  return true
}

async function transformPurchaseOrderPart(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const poId = await requirePurchaseOrder(context, 'poid')
  if (poId === null) return

  const partNo = helpers.text('partno')
  if (partNo === null) {
    await recordException(helpers, {
      exceptionClass: 'unresolved_part_line',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'line kept without a part number',
      notes: `poid = ${JSON.stringify(context.row.poid)}`,
    })
  }

  const qty = await requiredMoney(helpers, context, 'qty')
  if (await skipNegativeQuantity(context, qty)) return
  const qtyReceived = await requiredMoney(helpers, context, 'qty_received')
  const [inserted] = await tx
    .insert(purchaseOrderParts)
    .values({
      poId,
      partNo: partNo ?? '',
      description: null,
      qty,
      qtyReceived,
      price: await requiredMoney(helpers, context, 'price'),
      modelNumber: helpers.text('model_number'),
      itemPurchaseType: helpers.text('item_purchase_type'),
      itemPurchaseTypeNumber: helpers.text('item_purchase_type_number'),
      underWarranty: helpers.flag('under_warranty') === 1,
      doNotDeductFrom: helpers.int('do_not_deduct_from'),
      sortOrder: helpers.int('id') ?? 0,
    })
    .returning({ id: purchaseOrderParts.id })
  await rememberRow(context, 'purchase_order_parts', String(inserted!.id))

  if (Number(qtyReceived) > 0) {
    const receiptId = await ensureOpeningReceipt(context, poId)
    await tx.insert(purchaseOrderReceiptLines).values({
      receiptId,
      partLineId: inserted!.id,
      qty: qtyReceived,
      note: 'Opening quantity from legacy qty_received',
    })
  }
}

async function transformPurchaseOrderSpecialPart(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const poId = await requirePurchaseOrder(context, 'poid')
  if (poId === null) return

  const qty = await requiredMoney(helpers, context, 'qty')
  if (await skipNegativeQuantity(context, qty)) return
  const qtyReceived = await requiredMoney(helpers, context, 'qty_received')
  const [inserted] = await tx
    .insert(purchaseOrderSpecialParts)
    .values({
      poId,
      name: helpers.text('name') ?? '',
      qty,
      qtyReceived,
      price: await requiredMoney(helpers, context, 'price'),
      modelNumber: helpers.text('model_number'),
      itemPurchaseType: helpers.text('item_purchase_type'),
      itemPurchaseTypeNumber: helpers.text('item_purchase_type_number'),
      doNotDeductFrom: helpers.int('do_not_deduct_from'),
      sortOrder: helpers.int('id') ?? 0,
    })
    .returning({ id: purchaseOrderSpecialParts.id })
  await rememberRow(context, 'purchase_order_special_parts', String(inserted!.id))

  if (Number(qtyReceived) > 0) {
    const receiptId = await ensureOpeningReceipt(context, poId)
    await tx.insert(purchaseOrderReceiptLines).values({
      receiptId,
      specialPartLineId: inserted!.id,
      qty: qtyReceived,
      note: 'Opening quantity from legacy qty_received',
    })
  }
}

/* -------------------------------- pre-orders ------------------------------- */

async function transformPreorder(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const id = helpers.int('id')
  if (id === null) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'row not inserted: the pre-order has no id',
      notes: `id = ${JSON.stringify(context.row.id)}`,
    })
    return
  }

  const status = helpers.int('status') === 2 ? 2 : 1
  const dateCreated = stamp(await timestampOf(helpers, context, 'date_created'))
  const values: typeof purchaseOrderPreorders.$inferInsert = {
    id,
    status,
    sourceQuoteId: await resolveQuote(tx, helpers, helpers.int('cust_qoid')),
    report: helpers.text('report'),
    priorityId: helpers.int('priority'),
    notes: helpers.text('notes'),
    isWithoutQuote: helpers.flag('is_without_quote') === 1,
    workOrderNumber: helpers.int('workordernumber'),
    createdBy: await resolveUser(tx, helpers, helpers.int('createdby')),
    dateReceived: helpers.date('date_received'),
    ...(dateCreated === null ? {} : { createdAt: dateCreated }),
  }
  const { id: _number, ...updates } = values
  await tx
    .insert(purchaseOrderPreorders)
    .values(values)
    .onConflictDoUpdate({ target: purchaseOrderPreorders.id, set: updates })
  // The legacy id is inserted explicitly; keep the serial past it (§2.6).
  await bumpSequence(tx, 'purchase_order_preorders')
  await rememberRow(context, 'purchase_order_preorders', String(id))
}

async function requirePreorder(context: TransformContext): Promise<number | null> {
  const { tx, helpers } = context
  const id = helpers.int('pre_poid')
  if (id !== null) {
    const [row] = await selectIdMemo(tx, purchaseOrderPreorders.id, id)
    if (row) return row.id
  }
  await recordException(helpers, {
    exceptionClass: 'orphan_line',
    entity: entityFor(context.table),
    sourceKey: context.sourceKey,
    action: 'row not inserted: preorder_id is NOT NULL and the pre-order does not exist',
    notes: `pre_poid = ${JSON.stringify(context.row.pre_poid)}`,
  })
  return null
}

async function transformPreorderPart(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const preorderId = await requirePreorder(context)
  if (preorderId === null) return

  const purchaseType = helpers.enumOf('item_purchase_type', PURCHASE_TYPES)
  if (purchaseType === null && (context.row.item_purchase_type ?? '').trim() !== '') {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'stored NULL item_purchase_type',
      notes: `item_purchase_type = ${JSON.stringify(context.row.item_purchase_type)}`,
    })
  }

  const [inserted] = await tx
    .insert(purchaseOrderPreorderParts)
    .values({
      preorderId,
      partNo: helpers.text('partno') ?? '',
      qty: await requiredMoney(helpers, context, 'qty'),
      price: await requiredMoney(helpers, context, 'price'),
      itemPurchaseType: purchaseType,
      itemPurchaseTypeNumber: helpers.text('item_purchase_type_number'),
      supplierId: await resolveSupplier(tx, helpers, helpers.int('supplier_id')),
      sortOrder: helpers.int('id') ?? 0,
    })
    .returning({ id: purchaseOrderPreorderParts.id })
  await rememberRow(context, 'purchase_order_preorder_parts', String(inserted!.id))
}

async function transformPreorderSpecialPart(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers } = context
  const preorderId = await requirePreorder(context)
  if (preorderId === null) return

  const purchaseType = helpers.enumOf('item_purchase_type', PURCHASE_TYPES)
  if (purchaseType === null && (context.row.item_purchase_type ?? '').trim() !== '') {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'stored NULL item_purchase_type',
      notes: `item_purchase_type = ${JSON.stringify(context.row.item_purchase_type)}`,
    })
  }

  const [inserted] = await tx
    .insert(purchaseOrderPreorderSpecialParts)
    .values({
      preorderId,
      name: helpers.text('name') ?? '',
      qty: await requiredMoney(helpers, context, 'qty'),
      price: await requiredMoney(helpers, context, 'price'),
      itemPurchaseType: purchaseType,
      itemPurchaseTypeNumber: helpers.text('item_purchase_type_number'),
      supplierId: await resolveSupplier(tx, helpers, helpers.int('supplier_id')),
      sortOrder: helpers.int('id') ?? 0,
    })
    .returning({ id: purchaseOrderPreorderSpecialParts.id })
  await rememberRow(context, 'purchase_order_preorder_special_parts', String(inserted!.id))
}

/* ---------------------------- supplier invoices ---------------------------- */

/**
 * Legacy stores `sub_total` and `total_amount` beside the line totals, so this is
 * the one place in the group where a stored total can be compared with a
 * recomputed one. A disagreement is finance's decision, not the migrator's.
 */
async function reconcileInvoiceTotals(context: TransformContext, invoiceId: number): Promise<void> {
  const { tx, helpers } = context
  const legacySubtotal = helpers.money('sub_total')
  const legacyTotal = helpers.money('total_amount')
  if (legacySubtotal === null && legacyTotal === null) return

  const lines = await stagedLines(
    tx,
    'po_invoice_parts',
    context.dumpId,
    'invoice_id',
    String(invoiceId),
  )
  if (lines.length === 0) return

  let lineSum = 0
  for (const line of lines) {
    if (!isNumber(line.linetotal)) continue
    lineSum += Number(numberOr(line.linetotal, '0'))
  }
  const computedSubtotal = round(parseDecimal(lineSum.toFixed(2)) ?? { value: 0n, scale: 2 }, 2)
  const stored = parseDecimal(legacySubtotal)
  if (stored !== null) {
    const difference = round(subtract(computedSubtotal, stored), 2)
    if (!isZero(difference)) {
      await recordException(helpers, {
        exceptionClass: 'unbalanced_totals',
        entity: entityFor(context.table),
        sourceKey: context.sourceKey,
        action: 'legacy sub_total kept; recomputed line total recorded',
        notes: `sum(linetotal) = ${format(computedSubtotal, 2)}, sub_total = ${legacySubtotal}, difference = ${format(difference, 2)}`,
      })
      return
    }
  }

  if (legacyTotal !== null) {
    const taxes = ['tax_amount', 'shipping_charges'].reduce((sum, column) => {
      const value = helpers.money(column)
      return sum + (value === null ? 0 : Number(value))
    }, 0)
    const expected = round(parseDecimal((lineSum + taxes).toFixed(2)) ?? { value: 0n, scale: 2 }, 2)
    const storedTotal = parseDecimal(legacyTotal)
    if (storedTotal === null) return
    const difference = round(subtract(expected, storedTotal), 2)
    if (!isZero(difference)) {
      await recordException(helpers, {
        exceptionClass: 'unbalanced_totals',
        entity: entityFor(context.table),
        sourceKey: context.sourceKey,
        action: 'legacy total_amount kept; recomputed total (lines + tax + freight) recorded',
        notes: `lines + tax + freight = ${format(expected, 2)}, total_amount = ${legacyTotal}, difference = ${format(difference, 2)}`,
      })
    }
  }
}

async function transformPurchaseOrderInvoice(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const id = helpers.int('id')
  const poId = await requirePurchaseOrder(context, 'poid')
  if (poId === null) return

  const po = await tx
    .select({ supplierId: purchaseOrders.supplierId })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, poId))
    .limit(1)
  const declaredSupplier = helpers.int('invoice_supplier_id')
  const supplierId =
    (await resolveSupplier(tx, helpers, declaredSupplier)) ??
    po[0]?.supplierId ??
    declaredSupplier ??
    0

  const invoiceDate = helpers.date('invoice_date') ?? helpers.date('date_created')
  if (invoiceDate === null) {
    await recordException(helpers, {
      exceptionClass: 'zero_date',
      entity: entityFor(context.table),
      sourceKey,
      action: 'row not inserted: invoice_date is NOT NULL and neither date is usable',
      notes: `invoice_date = ${JSON.stringify(context.row.invoice_date)}, date_created = ${JSON.stringify(context.row.date_created)}`,
    })
    return
  }

  let supplierInvoiceNumber = helpers.text('invoicenumber')
  if (supplierInvoiceNumber === null) {
    supplierInvoiceNumber = `legacy-invoice-${id ?? context.sourceKey}`
    await recordException(helpers, {
      exceptionClass: 'missing_invoice_number',
      entity: entityFor(context.table),
      sourceKey,
      action: `generated supplier_invoice_number ${supplierInvoiceNumber}`,
      notes: 'legacy invoicenumber is blank',
    })
  } else {
    // (supplier, number) is unique on the target; a legacy duplicate keeps both
    // invoices by taking the row id as a suffix, and finance is told.
    const [clash] = await tx
      .select({ id: purchaseOrderInvoices.id })
      .from(purchaseOrderInvoices)
      .where(
        and(
          eq(purchaseOrderInvoices.supplierId, supplierId),
          eq(purchaseOrderInvoices.supplierInvoiceNumber, supplierInvoiceNumber),
          id === null ? sql`true` : sql`${purchaseOrderInvoices.id} <> ${id}`,
        ),
      )
      .limit(1)
    if (clash) {
      const suffixed = `${supplierInvoiceNumber}-${id ?? context.sourceKey}`
      await recordException(helpers, {
        exceptionClass: 'duplicate_invoice_number',
        entity: entityFor(context.table),
        sourceKey,
        action: `stored ${suffixed}; the supplier invoice number is already used`,
        notes: `invoicenumber = ${JSON.stringify(supplierInvoiceNumber)}`,
      })
      supplierInvoiceNumber = suffixed
    }
  }

  const sageDone = helpers.flag('sage_done') === 1
  const invoiced = helpers.flag('is_invoiced') === 1
  const status = sageDone ? 'posted' : invoiced ? 'matched' : 'draft'
  const dateCreated = stamp(await timestampOf(helpers, context, 'date_created'))

  const values: typeof purchaseOrderInvoices.$inferInsert = {
    poId,
    supplierId,
    supplierInvoiceNumber,
    invoiceDate,
    taxCode: helpers.text('tax_code'),
    appliedTaxRate: decimalOf(helpers.text('appliedtaxrate')),
    subtotal: await requiredMoney(helpers, context, 'sub_total'),
    tax: await requiredMoney(helpers, context, 'tax_amount'),
    taxHst: await requiredMoney(helpers, context, 'tax_hst'),
    taxGst: await requiredMoney(helpers, context, 'tax_gst'),
    taxPst: await requiredMoney(helpers, context, 'tax_pst'),
    taxTvp: await requiredMoney(helpers, context, 'tax_tvp'),
    freight: await requiredMoney(helpers, context, 'shipping_charges'),
    total: await requiredMoney(helpers, context, 'total_amount'),
    status,
    postedAt: sageDone ? dateCreated : null,
    sageReference: sageDone ? `legacy-po-invoice:${id ?? context.sourceKey}` : null,
    createdBy: await resolveUser(tx, helpers, helpers.int('createdby')),
    ...(dateCreated === null ? {} : { createdAt: dateCreated, updatedAt: dateCreated }),
  }

  let assignedId: number
  if (id === null) {
    const [inserted] = await tx
      .insert(purchaseOrderInvoices)
      .values(values)
      .returning({ id: purchaseOrderInvoices.id })
    assignedId = inserted!.id
    await rememberRow(context, 'purchase_order_invoices', String(assignedId))
  } else {
    await tx
      .insert(purchaseOrderInvoices)
      .values({ ...values, id })
      .onConflictDoUpdate({ target: purchaseOrderInvoices.id, set: values })
    // Keep the serial past the legacy ids this group inserts explicitly.
    await bumpSequence(tx, 'purchase_order_invoices')
    assignedId = id
    await rememberRow(context, 'purchase_order_invoices', String(id))
  }

  await reconcileInvoiceTotals(context, assignedId)
}

/** Link an invoice line to the PO part line it bills, when the part is findable. */
async function poPartLineId(
  tx: Tx,
  poId: number | null,
  partNo: string | null,
): Promise<number | null> {
  if (poId === null || partNo === null) return null
  const [row] = await tx
    .select({ id: purchaseOrderParts.id })
    .from(purchaseOrderParts)
    .where(and(eq(purchaseOrderParts.poId, poId), eq(purchaseOrderParts.partNo, partNo)))
    .limit(1)
  return row?.id ?? null
}

async function transformPurchaseOrderInvoiceLine(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers, sourceKey } = context
  const invoiceLegacyId = helpers.int('invoice_id')
  const [invoice] =
    invoiceLegacyId === null
      ? []
      : await tx
          .select({ id: purchaseOrderInvoices.id, poId: purchaseOrderInvoices.poId })
          .from(purchaseOrderInvoices)
          .where(eq(purchaseOrderInvoices.id, invoiceLegacyId))
          .limit(1)

  if (!invoice) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'row not inserted: invoice_id is NOT NULL and the supplier invoice does not exist',
      notes: `invoice_id = ${JSON.stringify(context.row.invoice_id)}`,
    })
    return
  }

  const partNo = helpers.text('partno')
  const partLineId = await poPartLineId(tx, invoice.poId, partNo)
  if (partLineId === null) {
    await recordException(helpers, {
      exceptionClass: 'unresolved_part_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'line kept without part_line_id',
      notes: `poid = ${JSON.stringify(context.row.poid)}, partno = ${JSON.stringify(context.row.partno)}`,
    })
  }

  const [inserted] = await tx
    .insert(purchaseOrderInvoiceLines)
    .values({
      invoiceId: invoice.id,
      partLineId,
      qty: await requiredMoney(helpers, context, 'qty'),
      unitPrice: await requiredMoney(helpers, context, 'price'),
      lineTotal: await requiredMoney(helpers, context, 'linetotal'),
      sortOrder: helpers.int('sortorder') ?? helpers.int('id') ?? 0,
    })
    .returning({ id: purchaseOrderInvoiceLines.id })
  await rememberRow(context, 'purchase_order_invoice_lines', String(inserted!.id))
}

/**
 * A billed special part is the same invoice line table as a billed part; only the
 * link differs. `po_so_part_id` points at the PO special line, whose legacy id is
 * crosswalked (the app allocates its own id for special parts).
 */
async function transformPurchaseOrderInvoiceSpecialLine(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers, sourceKey } = context
  const invoiceLegacyId = helpers.int('invoice_id')
  const [invoice] =
    invoiceLegacyId === null
      ? []
      : await selectIdMemo(tx, purchaseOrderInvoices.id, invoiceLegacyId)

  if (!invoice) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'row not inserted: invoice_id is NOT NULL and the supplier invoice does not exist',
      notes: `invoice_id = ${JSON.stringify(context.row.invoice_id)}`,
    })
    return
  }

  const specialLegacyId = helpers.int('po_so_part_id')
  const specialPartLineId =
    specialLegacyId === null
      ? null
      : await helpers.targetKey(
          'purchase_order_special_part',
          'po_soparts',
          String(specialLegacyId),
        )
  if (specialPartLineId === null) {
    await recordException(helpers, {
      exceptionClass: 'unresolved_part_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'line kept without special_part_line_id',
      notes: `po_so_part_id = ${JSON.stringify(context.row.po_so_part_id)}, name = ${JSON.stringify(context.row.name)}`,
    })
  }

  const [inserted] = await tx
    .insert(purchaseOrderInvoiceLines)
    .values({
      invoiceId: invoice.id,
      partLineId: null,
      specialPartLineId: specialPartLineId === null ? null : Number(specialPartLineId),
      qty: await requiredMoney(helpers, context, 'qty'),
      unitPrice: await requiredMoney(helpers, context, 'price'),
      lineTotal: await requiredMoney(helpers, context, 'linetotal'),
      sortOrder: helpers.int('sortorder') ?? helpers.int('id') ?? 0,
    })
    .returning({ id: purchaseOrderInvoiceLines.id })
  await rememberRow(context, 'purchase_order_invoice_lines', String(inserted!.id))
}

/* ----------------------------------- RFQs ---------------------------------- */

async function transformRfq(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const id = helpers.int('id')
  if (id === null) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'row not inserted: the RFQ has no id',
      notes: `id = ${JSON.stringify(context.row.id)}`,
    })
    return
  }

  const status = helpers.int('status')
  const validStatus = status !== null && status >= 1 && status <= 5 ? status : 1
  if (status !== null && validStatus !== status) {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity: entityFor(context.table),
      sourceKey,
      action: 'stored status 1',
      notes: `status = ${JSON.stringify(context.row.status)} is not one of 1-5`,
    })
  }

  const dateCreated = stamp(await timestampOf(helpers, context, 'date_created'))
  const values: typeof purchaseOrderRfqs.$inferInsert = {
    id,
    status: validStatus,
    sourceQuoteId: null,
    report: helpers.text('report'),
    priorityId: helpers.int('priority'),
    notes: helpers.text('notes'),
    ...(dateCreated === null ? {} : { createdAt: dateCreated }),
  }
  const { id: _number, ...updates } = values
  await tx
    .insert(purchaseOrderRfqs)
    .values(values)
    .onConflictDoUpdate({ target: purchaseOrderRfqs.id, set: updates })
  // The legacy id is inserted explicitly; keep the serial past it (§2.6).
  await bumpSequence(tx, 'purchase_order_rfqs')
  await rememberRow(context, 'purchase_order_rfqs', String(id))
}

async function transformRfqLine(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers, sourceKey } = context
  const rfqId = helpers.int('req_qoid')
  const [rfq] =
    rfqId === null
      ? []
      : await selectIdMemo(tx, purchaseOrderRfqs.id, rfqId)

  if (!rfq) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'row not inserted: rfq_id is NOT NULL and the RFQ does not exist',
      notes: `req_qoid = ${JSON.stringify(context.row.req_qoid)}`,
    })
    return
  }

  const [inserted] = await tx
    .insert(purchaseOrderRfqLines)
    .values({
      rfqId: rfq.id,
      partNo: helpers.text('partno'),
      name: null,
      qty: await requiredMoney(helpers, context, 'qty'),
      targetPrice: helpers.money('price'),
      sortOrder: helpers.int('id') ?? 0,
    })
    .returning({ id: purchaseOrderRfqLines.id })
  await rememberRow(context, 'purchase_order_rfq_lines', String(inserted!.id))
}

/* ------------------------------ RFQ suppliers ------------------------------ */

/** `waiting`, `accepted`, `decline` — the legacy enum and the app check agree. */
const RESPONSE_STATUSES = ['waiting', 'accepted', 'decline'] as const

async function responseStatusOf(
  helpers: TransformHelpers,
  context: TransformContext,
): Promise<string> {
  const raw = helpers.text('supplier_response_status')
  const status = helpers.enumOf('supplier_response_status', RESPONSE_STATUSES)
  if (status === null) {
    if (raw !== null) {
      await helpers.exception({
        exceptionClass: 'unknown_enum',
        entity: entityFor(context.table),
        sourceKey: context.sourceKey,
        action: "stored 'waiting'",
        notes: `supplier_response_status = ${JSON.stringify(raw)}`,
      })
    }
    return 'waiting'
  }
  return status
}

/** An invited supplier on an RFQ; the RFQ ids are preserved, so `req_qoid` is the key. */
async function transformRfqSupplier(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers, sourceKey } = context
  const rfqId = helpers.int('req_qoid')
  const [rfq] =
    rfqId === null
      ? []
      : await selectIdMemo(tx, purchaseOrderRfqs.id, rfqId)

  if (!rfq) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'row not inserted: req_qoid is NOT NULL and the RFQ does not exist',
      notes: `req_qoid = ${JSON.stringify(context.row.req_qoid)}`,
    })
    return
  }

  const supplierId = await resolveSupplier(tx, helpers, helpers.int('supplier_id'))
  if (supplierId === null) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'row not inserted: supplier_id is NOT NULL and the supplier does not exist',
      notes: `supplier_id = ${JSON.stringify(context.row.supplier_id)}`,
    })
    return
  }

  const [inserted] = await tx
    .insert(purchaseOrderRfqSuppliers)
    .values({
      rfqId: rfq.id,
      supplierId,
      responseStatus: await responseStatusOf(helpers, context),
      quotesCounter: helpers.int('quotes_counter') ?? 0,
      resubmissionRequest: helpers.flag('resubmission_request') === 1,
      notes: helpers.text('msg_notes'),
    })
    .returning({ id: purchaseOrderRfqSuppliers.id })
  await rememberRow(context, 'purchase_order_rfq_suppliers', String(inserted!.id))
}

/** `po_supplier_quote`: a supplier's answer to an RFQ, at least a header and lines. */
async function transformSupplierQuote(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers, sourceKey } = context
  const rfqId = helpers.int('req_qoid')
  const [rfq] =
    rfqId === null
      ? []
      : await selectIdMemo(tx, purchaseOrderRfqs.id, rfqId)

  if (!rfq) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'row not inserted: req_qoid is NOT NULL and the RFQ does not exist',
      notes: `req_qoid = ${JSON.stringify(context.row.req_qoid)}`,
    })
    return
  }

  const supplierId = await resolveSupplier(tx, helpers, helpers.int('supplier_id'))
  if (supplierId === null) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'row not inserted: supplier_id is NOT NULL and the supplier does not exist',
      notes: `supplier_id = ${JSON.stringify(context.row.supplier_id)}`,
    })
    return
  }

  // 1-3 are the in-progress states; 4 and 5 are the reached ones, as in
  // `scripts/backfill-purchasing.ts`. Anything else falls back to 3 (saved).
  const status = helpers.int('status')
  const validStatus = status === 4 || status === 5 ? status : 3
  if (status !== null && validStatus !== status && status > 5) {
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity: entityFor(context.table),
      sourceKey,
      action: 'stored status 3',
      notes: `status = ${JSON.stringify(context.row.status)} is not one of 1-5`,
    })
  }

  const dateCreated = stamp(await timestampOf(helpers, context, 'date_created'))
  const [inserted] = await tx
    .insert(purchaseOrderSupplierQuotes)
    .values({
      rfqId: rfq.id,
      supplierId,
      status: validStatus,
      expectedDelivery: helpers.date('exp_delivery_date'),
      notes: helpers.text('notes'),
      processedAsOrder: helpers.flag('processed_as_order') === 1,
      submittedAt: dateCreated ?? new Date(),
      ...(dateCreated === null ? {} : { createdAt: dateCreated }),
    })
    .returning({ id: purchaseOrderSupplierQuotes.id })
  await rememberRow(context, 'purchase_order_supplier_quotes', String(inserted!.id))
}

/** A quoted line, linked to the requested RFQ line with the same part number. */
async function transformSupplierQuoteLine(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers, sourceKey } = context
  const quoteLegacyId = helpers.int('sup_qoid')
  const [supplierQuote] =
    quoteLegacyId === null
      ? []
      : await tx
          .select({ id: purchaseOrderSupplierQuotes.id })
          .from(purchaseOrderSupplierQuotes)
          .where(eq(purchaseOrderSupplierQuotes.id, quoteLegacyId))
          .orderBy(sql`${purchaseOrderSupplierQuotes.id} desc`)
          .limit(1)

  if (!supplierQuote) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'row not inserted: sup_qoid is NOT NULL and the supplier quote does not exist',
      notes: `sup_qoid = ${JSON.stringify(context.row.sup_qoid)}`,
    })
    return
  }

  const partNo = helpers.text('partno')
  const rfqId = helpers.int('req_qoid')
  const [rfqLine] =
    rfqId === null || partNo === null
      ? []
      : await tx
          .select({ id: purchaseOrderRfqLines.id })
          .from(purchaseOrderRfqLines)
          .where(
            and(eq(purchaseOrderRfqLines.rfqId, rfqId), eq(purchaseOrderRfqLines.partNo, partNo)),
          )
          .orderBy(sql`${purchaseOrderRfqLines.id} asc`)
          .limit(1)

  if (!rfqLine) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'row not inserted: rfq_line_id is NOT NULL and the requested part is not on the RFQ',
      notes: `req_qoid = ${JSON.stringify(context.row.req_qoid)}, partno = ${JSON.stringify(context.row.partno)}`,
    })
    return
  }

  const [inserted] = await tx
    .insert(purchaseOrderSupplierQuoteLines)
    .values({
      supplierQuoteId: supplierQuote.id,
      rfqLineId: rfqLine.id,
      partNo,
      qty: await requiredMoney(helpers, context, 'qty'),
      price: await requiredMoney(helpers, context, 'price'),
      note: helpers.text('additional_note'),
    })
    .returning({ id: purchaseOrderSupplierQuoteLines.id })
  await rememberRow(context, 'purchase_order_supplier_quote_lines', String(inserted!.id))
}

/** An invited supplier on a pre-order; preorder ids are preserved, so `pre_poid` is the key. */
async function transformPreorderSupplier(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers, sourceKey } = context
  const preorderId = helpers.int('pre_poid')
  const [preorder] =
    preorderId === null
      ? []
      : await selectIdMemo(tx, purchaseOrderPreorders.id, preorderId)

  if (!preorder) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'row not inserted: pre_poid is NOT NULL and the pre-order does not exist',
      notes: `pre_poid = ${JSON.stringify(context.row.pre_poid)}`,
    })
    return
  }

  const supplierId = await resolveSupplier(tx, helpers, helpers.int('supplier_id'))
  if (supplierId === null) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'row not inserted: supplier_id is NOT NULL and the supplier does not exist',
      notes: `supplier_id = ${JSON.stringify(context.row.supplier_id)}`,
    })
    return
  }

  const [inserted] = await tx
    .insert(purchaseOrderPreorderSuppliers)
    .values({
      preorderId: preorder.id,
      supplierId,
      responseStatus: await responseStatusOf(helpers, context),
      notes: helpers.text('msg_notes'),
    })
    .returning({ id: purchaseOrderPreorderSuppliers.id })
  await rememberRow(context, 'purchase_order_preorder_suppliers', String(inserted!.id))
}

/* ---------------------------- rejected invoices ---------------------------- */

/**
 * A customer-rejected sales invoice. `app.rejected_invoices.invoice_id` points at
 * `app.sales_invoices`, which the invoicing group creates (group 10, after this
 * one), so a first pass records the rejection as a deferred `orphan_line` and a
 * later forced replay of this group fills the row in.
 */
async function transformRejectedInvoice(context: TransformContext): Promise<void> {
  if (await alreadyMapped(context)) return
  const { tx, helpers, sourceKey } = context
  const invoiceNumber = helpers.text('invoice_no')
  const workOrderNumber = helpers.int('woid')

  // The legacy row may name the invoice only by the work order it belonged to, so
  // both keys are tried before the rejection is called unresolved.
  const byNumber =
    invoiceNumber === null
      ? []
      : await tx
          .select({ id: salesInvoices.id, invoiceNumber: salesInvoices.invoiceNumber })
          .from(salesInvoices)
          .where(eq(salesInvoices.invoiceNumber, invoiceNumber))
          .limit(1)
  const byWorkOrder =
    byNumber.length > 0 || workOrderNumber === null
      ? []
      : await tx
          .select({ id: salesInvoices.id, invoiceNumber: salesInvoices.invoiceNumber })
          .from(salesInvoices)
          .where(eq(salesInvoices.workOrderId, workOrderNumber))
          .limit(1)
  const invoice = byNumber[0] ?? byWorkOrder[0]

  if (!invoice) {
    await recordException(helpers, {
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey,
      action:
        'deferred: app.sales_invoices rows are created by the invoicing-rga group; rerun purchasing with --force afterwards',
      notes: `woid = ${JSON.stringify(context.row.woid)}, invoice_no = ${JSON.stringify(invoiceNumber)}`,
    })
    return
  }

  const rejectedSeconds = helpers.int('date_rejected')
  const rejectedAt = rejectedSeconds === null ? null : new Date(rejectedSeconds * 1000)
  const [inserted] = await tx
    .insert(rejectedInvoices)
    .values({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      // The legacy table records no reason; the sentinel says so instead of
      // inventing one.
      reason: 'Rejected in the legacy system (no reason recorded)',
      rejectedByDetail: null,
      invoiceContent: {},
      ...(rejectedAt === null ? {} : { rejectedAt }),
    })
    .returning({ id: rejectedInvoices.id })
  await rememberRow(context, 'rejected_invoices', String(inserted!.id))
}

const RFQ_REQUEST_STATUS_VOCAB =
  'request-status vocabulary (id to label); the app stores response_status as text on the invited-supplier row, so the label table has no target'
const RFQ_SUBMITTED_STATUS_VOCAB =
  'submitted-status vocabulary; the app uses numeric 1-5 on app.purchase_order_supplier_quotes, so the labels are not copied'
const RFQ_REQUESTED_PARTS_DETAIL =
  'per-supplier requested part rows (list, supplier, cost); app.purchase_order_rfq_lines holds one row per requested part and per-supplier target prices are not modelled'
const PO_SUBMISSION_LOG =
  'email submission log for approved POs (subject, recipients, attachments); the new app records the send in notifications, so the log is not replayed'

/** One `not_migrated` row per table: the report names the decision once, not per row. */
async function skipTable(context: TransformContext, reason: string): Promise<void> {
  await context.helpers.exception({
    exceptionClass: 'not_migrated',
    entity: context.table,
    sourceKey: context.table,
    action: `not migrated: ${reason}`,
    notes: 'whole-table decision; every row of this table is skipped and stays in staging',
  })
}

export const transformer: GroupTransformer = {
  group: GROUP,

  async transform(context) {
    switch (context.table) {
      case 'purchaseorder':
        return transformPurchaseOrder(context)
      case 'po_parts':
        return transformPurchaseOrderPart(context)
      case 'po_soparts':
        return transformPurchaseOrderSpecialPart(context)
      case 'po_preorder':
        return transformPreorder(context)
      case 'po_preorder_parts':
        return transformPreorderPart(context)
      case 'po_preorder_soparts':
        return transformPreorderSpecialPart(context)
      case 'po_invoice':
        return transformPurchaseOrderInvoice(context)
      case 'po_invoice_parts':
        return transformPurchaseOrderInvoiceLine(context)
      case 'po_quote':
        return transformRfq(context)
      case 'po_quote_requested_parts':
        return transformRfqLine(context)
      case 'rejected_invoices':
        return transformRejectedInvoice(context)
      case 'po_invoice_soparts':
        return transformPurchaseOrderInvoiceSpecialLine(context)
      case 'po_quote_suppliers':
        return transformRfqSupplier(context)
      case 'po_supplier_quote':
        return transformSupplierQuote(context)
      case 'po_supplier_quote_parts':
        return transformSupplierQuoteLine(context)
      case 'po_preorder_suppliers':
        return transformPreorderSupplier(context)
      // Vocabulary and log tables that joined the group after this transformer
      // was written. None has a target table; each is recorded once per table.
      case 'po_quote_request_status':
        return skipTable(context, RFQ_REQUEST_STATUS_VOCAB)
      case 'po_quote_submitted_status':
        return skipTable(context, RFQ_SUBMITTED_STATUS_VOCAB)
      case 'po_quote_requested_parts_detail':
        return skipTable(context, RFQ_REQUESTED_PARTS_DETAIL)
      case 'po_submission_after_approval':
        return skipTable(context, PO_SUBMISSION_LOG)
      case 'po_status_v2':
        // §5: a dead dated duplicate with zero code references. The manifest does
        // not stage it, so this arm only exists to make an accidental staging
        // visible instead of silently mapping a table nobody reads.
        await context.helpers.exception({
          exceptionClass: 'dated_duplicate_skipped',
          entity: 'po_status_v2',
          sourceKey: context.sourceKey,
          action: 'not transformed: dated duplicate of po_status',
          notes: 'po_status_v2 is classified as a skipped dated duplicate in the manifest',
        })
        return
      default:
        throw new Error(`${GROUP}: no mapping for table ${context.table}`)
    }
  },

  unmapped: {
    'purchaseorder.invoice_number':
      'PO-level copy of the supplier invoice number; po_invoice is the authoritative table',
    'purchaseorder.status_on_july_21_2025': 'dated snapshot column, kept in staging only',
    'purchaseorder.last_status':
      'previous status before the last change; status history is the audit',
    'purchaseorder.shipment_type_correction':
      'one-off operator correction, superseded by shipment_type',
    'purchaseorder.shipment_type_bkup_18july2025': 'dated backup column, kept in staging only',
    'purchaseorder.shipping_address': 'free-text rendering of the ship_address_* columns',
    'purchaseorder.shipping_code': 'no target column',
    'purchaseorder.completiondate':
      'integer, not a date and not a work-order number; no target column',
    'purchaseorder.date_completed': 'stock_posted_at carries the completion event',
    'purchaseorder.po_folder_attach_path':
      'local filesystem path; files are re-uploaded to object storage',
    'purchaseorder.is_online_vendor_order': 'supplier type is authoritative on app.suppliers',
    'purchaseorder.is_type_maintenance': 'maintenance PO marker, no target column',
    'purchaseorder.tjx_quoteid': 'TJX quote link, covered by the TJX group',
    'purchaseorder.sup_poid': 'superseded-PO link, not modelled',
    'purchaseorder.sup_qoid':
      'po_supplier_quote is not in the manifest; supplier_quote_id stays NULL',
    'purchaseorder.override_supplier_is_under':
      'operator override, superseded by suppliers.is_under_cls',
    'purchaseorder.transfer_from_contactname': 'the transfer keeps ids, not a copied address',
    'purchaseorder.transfer_from_company': 'the transfer keeps ids, not a copied address',
    'purchaseorder.transfer_from_street1': 'the transfer keeps ids, not a copied address',
    'purchaseorder.transfer_from_street2': 'the transfer keeps ids, not a copied address',
    'purchaseorder.transfer_from_city': 'the transfer keeps ids, not a copied address',
    'purchaseorder.transfer_from_province': 'the transfer keeps ids, not a copied address',
    'purchaseorder.transfer_from_postalcode': 'the transfer keeps ids, not a copied address',
    'purchaseorder.transfer_from_phone': 'the transfer keeps ids, not a copied address',
    'purchaseorder.transfer_from_address': 'the transfer keeps ids, not a copied address',
    'purchaseorder.is_alliance_stocktransfer_po_old':
      'dated backup of is_alliance_stocktransfer_po',
    'purchaseorder.print_records_per_page': 'print preference, not business data',
    'purchaseorder.tjx_parts_qty_type': 'TJX print preference',
    'purchaseorder.last_followup_reminder_date': 'reminder state is rebuilt by the purchasing jobs',
    'po_parts.none_customer_invoice_item':
      'flag with no target column; the invoice lines say what was billed',
    'po_parts.item_transferfrom_type': 'transfer linkage lives on the header',
    'po_parts.item_transferfrom_type_number': 'transfer linkage lives on the header',
    'po_soparts.none_customer_invoice_item':
      'flag with no target column; the invoice lines say what was billed',
    'po_soparts.item_transferfrom_type': 'transfer linkage lives on the header',
    'po_soparts.item_transferfrom_type_number': 'transfer linkage lives on the header',
    'po_preorder_parts.list_id': 'supplier rate list; the awarded supplier is what the PO uses',
    'po_preorder_parts.sub_supplier_id': 'sub-supplier is only modelled on the PO header',
    'po_preorder_parts.cost_price': 'cost basis is carried by parts_supplier_rates',
    'po_preorder_parts.none_customer_invoice_item': 'flag with no target column',
    'po_preorder_soparts.list_id': 'supplier rate list; the awarded supplier is what the PO uses',
    'po_preorder_soparts.sub_supplier_id': 'sub-supplier is only modelled on the PO header',
    'po_preorder_soparts.cost_price': 'cost basis is carried by parts_supplier_rates',
    'po_preorder_soparts.none_customer_invoice_item': 'flag with no target column',
    'po_invoice.workordernumber':
      'no target column on the supplier invoice; the PO carries the job',
    'po_invoice.appliedtaxrate_pst':
      'no PST-rate column on app.purchase_order_invoices; tax_pst carries the amount',
    'po_invoice.cls_invoicenumber': 'CLS internal number; sage_reference holds the Sage posting',
    'po_invoice.invoice_report': 'free-text report, no target column',
    'po_invoice.invoice_level': 'print level, not business data',
    'po_invoice.rgaid': 'RGA link is owned by the invoicing-rga group',
    'po_invoice.forced_markinvoice_button': 'UI override flag',
    'po_invoice.stock_updated_during_mark_invoice': 'stock posting state is rebuilt by inventory',
    'po_invoice.is_invoiced': 'drives the target status, not stored',
    'po_invoice.sage_done': 'drives status/posted_at/sage_reference, not stored',
    'po_invoice_parts.actual_qty': 'receipt detail; the invoice line bills qty',
    'po_invoice_parts.backorder_qty': 'receipt detail; backorders live on the PO line',
    'po_invoice_parts.model_number': 'no target column on the invoice line',
    'po_invoice_parts.sageprojectno': 'Sage project number, not modelled',
    'po_invoice_parts.invoice_project': 'Sage project label, not modelled',
    'po_invoice_parts.update_stock_quantity': 'stock posting state is rebuilt by inventory',
    'po_quote.poid':
      'references a purchase order, and app.purchase_order_rfqs has no PO column; the link is not representable',
    'po_quote.date_received': 'no target column on the RFQ header',
    'po_quote_requested_parts.supplier_lists':
      'supplier invitation list; app.purchase_order_rfq_suppliers is outside this group',
    'rejected_invoices.woid': 'reached through app.work_orders to app.sales_invoices',
    'po_quote_request_status.*': RFQ_REQUEST_STATUS_VOCAB,
    'po_quote_submitted_status.*': RFQ_SUBMITTED_STATUS_VOCAB,
    'po_quote_requested_parts_detail.*': RFQ_REQUESTED_PARTS_DETAIL,
    'po_submission_after_approval.*': PO_SUBMISSION_LOG,
    'po_invoice_soparts.sageprojectno': 'Sage project number, not modelled',
    'po_invoice_soparts.invoice_project': 'Sage project label, not modelled',
    'po_invoice_soparts.actual_qty': 'receipt detail; the invoice line bills qty',
    'po_invoice_soparts.backorder_qty': 'receipt detail; backorders live on the PO line',
    'po_quote_suppliers.list_id': 'supplier rate list; the invited supplier is what the RFQ uses',
    'po_quote_suppliers.sage_id': 'Sage supplier id, not modelled',
    'po_quote_suppliers.supplier_user_id': 'supplier portal login, not migrated',
    'po_quote_suppliers.dated': 'invitation timestamp; created_at is the row time',
    'po_preorder_suppliers.list_id':
      'supplier rate list; the invited supplier is what the pre-order uses',
    'po_preorder_suppliers.sub_supplier_id': 'sub-supplier is only modelled on the PO header',
    'po_preorder_suppliers.quotes_counter': 'no counter column on the pre-order supplier row',
    'po_preorder_suppliers.resubmission_request':
      'no resubmission flag on the pre-order supplier row',
    'po_preorder_suppliers.dated': 'invitation timestamp; created_at is the row time',
    'po_preorder_suppliers.processed_as_order':
      'the pre-order itself records whether it became a PO',
    'po_supplier_quote.poid':
      'the RFQ carries the link; app.purchase_order_supplier_quotes has no PO column',
    'po_supplier_quote.report': 'free-text report, no target column',
    'po_supplier_quote.priority': 'no priority column on the supplier quote',
    'po_supplier_quote.resubmission_request':
      'no resubmission flag on the supplier quote; the invited-supplier row carries it',
    'po_supplier_quote_parts.req_qoid': 'used to find the RFQ line; not stored on the quote line',
  },

  parity: [
    {
      group: GROUP,
      label: 'purchase orders',
      oldSql: 'select count(*)::int as rows from migration."stg_purchaseorder"',
      newSql: 'select count(*)::int as rows from app.purchase_orders',
    },
    {
      group: GROUP,
      label: 'PO received quantity',
      oldSql:
        "select coalesce(sum(nullif(regexp_replace(qty_received, '[^0-9.-]', '', 'g'), '')::numeric), 0)::numeric(14, 2) as qty from migration.\"stg_po_parts\"",
      newSql:
        'select coalesce(sum(qty_received), 0)::numeric(14, 2) as qty from app.purchase_order_parts',
    },
    {
      group: GROUP,
      label: 'supplier invoice totals',
      oldSql:
        "select coalesce(sum(nullif(regexp_replace(total_amount, '[^0-9.-]', '', 'g'), '')::numeric), 0)::numeric(14, 2) as total from migration.\"stg_po_invoice\"",
      newSql:
        'select coalesce(sum(total), 0)::numeric(14, 2) as total from app.purchase_order_invoices',
    },
  ],
}
