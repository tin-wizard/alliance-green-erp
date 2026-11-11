/**
 * Supplier invoices against purchase orders.
 *
 * SERVER ONLY. Invoice quantity may not exceed ordered quantity; an invoice for
 * goods not yet received stays `pending_receipt` and cannot close the PO.
 * Price/tax variances are recorded and need explicit acceptance. The PO's
 * ordered prices are never mutated.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import type { Db, Tx } from '@cls/db'
import {
  purchaseOrderInvoiceLines,
  purchaseOrderInvoices,
  purchaseOrderParts,
  purchaseOrderSpecialParts,
  purchaseOrders,
} from '@cls/db/schema'
import {
  add,
  compare,
  format,
  multiply,
  parseDecimal,
  purchaseTaxRate,
  round,
  subtract,
} from '@cls/pricing'
import type { Decimal } from '@cls/pricing'
import { assertPermission } from '../../../server/middleware'
import type { AuthSessionView } from '../../../server/auth.types'
import type {
  PurchaseOrderInvoiceCloseInput,
  PurchaseOrderInvoiceInput,
  PurchaseOrderStatus,
} from '../types'
import { loadPurchaseOrder } from './access.server'
import { auditPurchaseOrder, recordStatus } from './records.server'

/** Money helpers shared with `credits.server.ts` so the credit path never re-derives rounding. */
export const ZERO: Decimal = { value: 0n, scale: 2 }

export function dec(value: string) {
  const parsed = parseDecimal(value)
  if (!parsed) throw new ValidationError(`Invalid amount: ${value}`)
  return parsed
}

/**
 * Per-line money for supplier documents: the line total is rounded to 2dp, then
 * tax is taken from the rounded line total. Supplier credits reuse this so a
 * credit is the exact negative of the invoice it corrects.
 */
export function invoiceLineAmounts(qty: Decimal, unitPrice: Decimal, rate: Decimal) {
  const lineTotal = round(multiply(qty, unitPrice), 2)
  return { lineTotal, taxAmount: round(multiply(lineTotal, rate), 2) }
}

interface InvoiceTotals {
  subtotal: ReturnType<typeof dec>
  tax: ReturnType<typeof dec>
  variance: ReturnType<typeof dec>
  detail: Array<{ line: string; price: string; tax: string }>
}

export async function createPurchaseOrderInvoiceCore(
  tx: Tx,
  input: PurchaseOrderInvoiceInput,
  session: AuthSessionView,
): Promise<{ invoiceId: number; status: string; variance: string }> {
  assertPermission(session, 'invoice:write')
  const po = await loadPurchaseOrder(session, input.id, tx)
  if (po.status === 10 || po.status === 11) {
    throw new ValidationError('A cancelled or invoiced purchase order cannot take another invoice.')
  }

  const parts = await tx.select().from(purchaseOrderParts).where(eq(purchaseOrderParts.poId, po.id))
  const specialParts = await tx
    .select()
    .from(purchaseOrderSpecialParts)
    .where(eq(purchaseOrderSpecialParts.poId, po.id))

  const priorInvoices = await tx
    .select({ id: purchaseOrderInvoices.id })
    .from(purchaseOrderInvoices)
    .where(eq(purchaseOrderInvoices.poId, po.id))
  const priorLines = priorInvoices.length
    ? await tx
        .select()
        .from(purchaseOrderInvoiceLines)
        .where(inArray(purchaseOrderInvoiceLines.invoiceId, priorInvoices.map((row) => row.id)))
    : []

  const rate = input.appliedTaxRate
    ? dec(input.appliedTaxRate)
    : purchaseTaxRate(input.taxCode ?? po.taxCode, input.invoiceDate).rate

  let subtotal = ZERO
  let tax = ZERO
  let variance = ZERO
  const detail: InvoiceTotals['detail'] = []
  let pendingReceipt = false

  const rows: Array<typeof purchaseOrderInvoiceLines.$inferInsert> = []

  for (const [index, line] of input.lines.entries()) {
    const qty = dec(line.qty)
    if (compare(qty, ZERO) <= 0) throw new ValidationError('Invoice quantity must be greater than zero.')

    let ordered = ZERO
    let received = ZERO
    let poPrice = ZERO
    let alreadyInvoiced = ZERO
    let partLineId: number | null = null
    let specialPartLineId: number | null = null

    if (line.partLineId) {
      const part = parts.find((p) => p.id === line.partLineId)
      if (!part) throw new ValidationError('That part line is not on this purchase order.')
      ordered = dec(part.qty)
      received = dec(part.qtyReceived)
      poPrice = dec(part.price)
      partLineId = part.id
      alreadyInvoiced = priorLines
        .filter((row) => row.partLineId === part.id)
        .reduce((sum, row) => add(sum, dec(row.qty)), ZERO)
    } else if (line.specialPartLineId) {
      const special = specialParts.find((p) => p.id === line.specialPartLineId)
      if (!special) throw new ValidationError('That special-part line is not on this purchase order.')
      ordered = dec(special.qty)
      received = dec(special.qtyReceived)
      poPrice = dec(special.price)
      specialPartLineId = special.id
      alreadyInvoiced = priorLines
        .filter((row) => row.specialPartLineId === special.id)
        .reduce((sum, row) => add(sum, dec(row.qty)), ZERO)
    } else {
      throw new ValidationError('Each invoice line must reference a PO line.')
    }

    const invoicedAfter = add(alreadyInvoiced, qty)
    if (compare(invoicedAfter, ordered) > 0) {
      throw new ValidationError('Invoiced quantity cannot exceed the ordered quantity.')
    }
    if (compare(invoicedAfter, received) > 0) pendingReceipt = true

    const unitPrice = dec(line.unitPrice)
    const { lineTotal, taxAmount: expectedTax } = invoiceLineAmounts(qty, unitPrice, rate)
    const priceVariance = round(multiply(qty, subtract(unitPrice, poPrice)), 2)
    const taxAmount = line.taxAmount ? dec(line.taxAmount) : expectedTax
    const taxVariance = round(subtract(taxAmount, expectedTax), 2)

    subtotal = add(subtotal, lineTotal)
    tax = add(tax, taxAmount)
    variance = add(variance, add(priceVariance, taxVariance))
    if (compare(priceVariance, ZERO) !== 0 || compare(taxVariance, ZERO) !== 0) {
      detail.push({
        line: String(index + 1),
        price: format(priceVariance, 2),
        tax: format(taxVariance, 2),
      })
    }

    rows.push({
      invoiceId: 0,
      partLineId,
      specialPartLineId,
      qty: format(qty, 2),
      unitPrice: format(unitPrice, 2),
      lineTotal: format(lineTotal, 2),
      taxAmount: format(taxAmount, 2),
      variance: format(add(priceVariance, taxVariance), 2),
      sortOrder: index,
    })
  }

  const freight = input.freight ? dec(input.freight) : ZERO
  const total = round(add(add(subtotal, tax), freight), 2)
  const status = pendingReceipt ? 'pending_receipt' : compare(variance, ZERO) === 0 ? 'matched' : 'draft'

  const taxHst = input.taxHst ? dec(input.taxHst) : ZERO
  const taxGst = input.taxGst ? dec(input.taxGst) : ZERO
  const taxPst = input.taxPst ? dec(input.taxPst) : ZERO
  const taxTvp = input.taxTvp ? dec(input.taxTvp) : ZERO

  const [invoice] = await tx
    .insert(purchaseOrderInvoices)
    .values({
      poId: po.id,
      supplierId: po.supplierId,
      supplierInvoiceNumber: input.supplierInvoiceNumber,
      invoiceDate: input.invoiceDate,
      taxCode: input.taxCode ?? po.taxCode,
      appliedTaxRate: input.appliedTaxRate ?? po.appliedTaxRate,
      subtotal: format(subtotal, 2),
      tax: format(tax, 2),
      taxHst: format(taxHst, 2),
      taxGst: format(taxGst, 2),
      taxPst: format(taxPst, 2),
      taxTvp: format(taxTvp, 2),
      freight: format(freight, 2),
      total: format(total, 2),
      status,
      variance: format(variance, 2),
      varianceDetail: detail.length ? JSON.stringify(detail) : null,
      createdBy: session.user.id,
    })
    .returning()
  if (!invoice) throw new ValidationError('The supplier invoice could not be created.')

  if (rows.length) {
    await tx.insert(purchaseOrderInvoiceLines).values(rows.map((row) => ({ ...row, invoiceId: invoice.id })))
  }

  await auditPurchaseOrder(tx, session, 'purchase_order.invoice_create', po.id, {
    summary: `Recorded supplier invoice ${input.supplierInvoiceNumber} (${status}).`,
    permission: 'invoice:write',
    after: {
      invoiceId: invoice.id,
      status,
      subtotal: format(subtotal, 2),
      tax: format(tax, 2),
      total: format(total, 2),
      variance: format(variance, 2),
      pendingReceipt,
    },
  })

  return { invoiceId: invoice.id, status, variance: format(variance, 2) }
}

export async function closePurchaseOrderInvoiceCore(
  tx: Tx,
  input: PurchaseOrderInvoiceCloseInput,
  session: AuthSessionView,
): Promise<{ status: PurchaseOrderStatus; version: number }> {
  assertPermission(session, 'invoice:issue')
  const po = await loadPurchaseOrder(session, input.id, tx)
  if (po.status !== 4) {
    throw new ValidationError('Only a fully received purchase order can be closed as invoiced.')
  }

  const [invoice] = await tx
    .select()
    .from(purchaseOrderInvoices)
    .where(and(eq(purchaseOrderInvoices.id, input.invoiceId), eq(purchaseOrderInvoices.poId, po.id)))
    .limit(1)
  if (!invoice) throw new ValidationError('That invoice is not on this purchase order.')
  if (invoice.status === 'pending_receipt') {
    throw new ValidationError('This invoice is waiting for the goods to be received; it cannot close.')
  }
  if (invoice.status === 'posted' || invoice.status === 'void') {
    throw new ValidationError('This invoice is already closed.')
  }

  const variance = dec(invoice.variance)
  if (compare(variance, ZERO) !== 0 && !input.acceptVarianceReason?.trim()) {
    throw new ValidationError('Accept the price/tax variance with a reason before closing.')
  }

  const [parts, specialParts] = await Promise.all([
    tx.select().from(purchaseOrderParts).where(eq(purchaseOrderParts.poId, po.id)),
    tx.select().from(purchaseOrderSpecialParts).where(eq(purchaseOrderSpecialParts.poId, po.id)),
  ])
  const allInvoices = await tx
    .select({ id: purchaseOrderInvoices.id })
    .from(purchaseOrderInvoices)
    .where(eq(purchaseOrderInvoices.poId, po.id))
  const lines = allInvoices.length
    ? await tx
        .select()
        .from(purchaseOrderInvoiceLines)
        .where(inArray(purchaseOrderInvoiceLines.invoiceId, allInvoices.map((row) => row.id)))
    : []

  for (const part of parts) {
    const invoiced = lines
      .filter((line) => line.partLineId === part.id)
      .reduce((sum, line) => add(sum, dec(line.qty)), ZERO)
    if (compare(invoiced, dec(part.qtyReceived)) < 0) {
      throw new ValidationError('Not all received part quantity has been invoiced yet.')
    }
  }
  for (const part of specialParts) {
    const invoiced = lines
      .filter((line) => line.specialPartLineId === part.id)
      .reduce((sum, line) => add(sum, dec(line.qty)), ZERO)
    if (compare(invoiced, dec(part.qtyReceived)) < 0) {
      throw new ValidationError('Not all received special-part quantity has been invoiced yet.')
    }
  }

  const now = new Date()
  await tx
    .update(purchaseOrderInvoices)
    .set({
      status: 'posted',
      postedAt: now,
      acceptedVarianceReason: input.acceptVarianceReason ?? invoice.acceptedVarianceReason,
      acceptedBy: session.user.id,
      acceptedAt: now,
      updatedAt: now,
    })
    .where(eq(purchaseOrderInvoices.id, invoice.id))

  const nextVersion = po.version + 1
  await tx
    .update(purchaseOrders)
    .set({ status: 11, version: nextVersion, updatedBy: session.user.id, updatedAt: now })
    .where(eq(purchaseOrders.id, po.id))

  await recordStatus(tx, session, {
    poId: po.id,
    from: 4,
    to: 11,
    action: 'invoice_close',
    version: nextVersion,
    note: input.acceptVarianceReason ?? null,
  })
  await auditPurchaseOrder(tx, session, 'purchase_order.invoice_close', po.id, {
    summary: `Closed purchase order ${po.id} as invoiced.`,
    permission: 'invoice:issue',
    before: { status: 4, version: po.version },
    after: {
      status: 11,
      version: nextVersion,
      invoiceId: invoice.id,
      varianceAcceptedReason: input.acceptVarianceReason ?? null,
    },
  })

  return { status: 11, version: nextVersion }
}

export async function createPurchaseOrderInvoice(
  input: PurchaseOrderInvoiceInput,
  session: AuthSessionView,
  executor?: Db,
) {
  const db = executor ?? (await import('@cls/db')).getDb()
  return db.transaction((tx) => createPurchaseOrderInvoiceCore(tx, input, session))
}

export async function closePurchaseOrderInvoice(
  input: PurchaseOrderInvoiceCloseInput,
  session: AuthSessionView,
  executor?: Db,
) {
  const db = executor ?? (await import('@cls/db')).getDb()
  return db.transaction((tx) => closePurchaseOrderInvoiceCore(tx, input, session))
}
