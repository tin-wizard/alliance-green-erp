/**
 * Receiving a purchase order.
 *
 * SERVER ONLY. A receipt is one event with lines; stock posts once in the same
 * transaction. The PO status is derived from the receipt totals, never typed by
 * the user. Over-receipt needs `po.approve` and a reason; the excess is recorded
 * but does not increase the ordered value.
 */
import { eq } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import type { Db, Tx } from '@cls/db'
import {
  purchaseOrderInvoices,
  purchaseOrderParts,
  purchaseOrderReceiptLines,
  purchaseOrderReceipts,
  purchaseOrderSpecialParts,
  purchaseOrders,
} from '@cls/db/schema'
import { add, compare, format, parseDecimal, round } from '@cls/pricing'
import type { Decimal } from '@cls/pricing'
import { assertPermission } from '../../../server/middleware'
import type { AuthSessionView } from '../../../server/auth.types'
import type { PurchaseOrderReceiptInput, PurchaseOrderStatus } from '../types'
import { hasGrant, loadPurchaseOrder } from './access.server'
import { auditPurchaseOrder, recordStatus } from './records.server'
import { postPurchaseReceipt } from '../../inventory/server/stock.server'

const ZERO: Decimal = { value: 0n, scale: 2 }

function dec(value: string) {
  const parsed = parseDecimal(value)
  if (!parsed) throw new ValidationError(`Invalid quantity: ${value}`)
  return parsed
}

export interface ReceiptResult {
  receiptId: number
  status: PurchaseOrderStatus
  version: number
  stockLinesPosted: number
  idempotent: boolean
}

export async function receivePurchaseOrderCore(
  tx: Tx,
  input: PurchaseOrderReceiptInput,
  session: AuthSessionView,
): Promise<ReceiptResult> {
  assertPermission(session, 'purchasing:write')
  assertPermission(session, 'inventory:adjust')

  const po = await loadPurchaseOrder(session, input.id, tx)

  // A retry carries the key from the first attempt, so the key wins over the
  // version guard: the receipt already happened and must not post stock twice.
  const [existing] = await tx
    .select()
    .from(purchaseOrderReceipts)
    .where(eq(purchaseOrderReceipts.idempotencyKey, input.idempotencyKey))
    .limit(1)
  if (existing) {
    return {
      receiptId: existing.id,
      status: po.status as PurchaseOrderStatus,
      version: po.version,
      stockLinesPosted: 0,
      idempotent: true,
    }
  }

  if (po.version !== input.version) {
    throw new ValidationError('This purchase order changed since it was loaded. Reload and retry.')
  }

  if (po.status !== 2 && po.status !== 5 && po.status !== 6) {
    throw new ValidationError('This purchase order is not open for receiving.')
  }
  if (input.lines.length === 0) throw new ValidationError('A receipt needs at least one line.')

  const parts = await tx
    .select()
    .from(purchaseOrderParts)
    .where(eq(purchaseOrderParts.poId, po.id))
    .for('update')
  const specialParts = await tx
    .select()
    .from(purchaseOrderSpecialParts)
    .where(eq(purchaseOrderSpecialParts.poId, po.id))
    .for('update')

  // Over-receipt is cumulative: compare what will have arrived after this
  // receipt with the ordered quantity, not just this shipment.
  const overReceipt = input.lines.some((line) => {
    if (line.partLineId) {
      const part = parts.find((p) => p.id === line.partLineId)
      return part
        ? compare(round(add(dec(part.qtyReceived), dec(line.qty)), 2), dec(part.qty)) > 0
        : false
    }
    const special = specialParts.find((p) => p.id === line.specialPartLineId)
    return special
      ? compare(round(add(dec(special.qtyReceived), dec(line.qty)), 2), dec(special.qty)) > 0
      : false
  })
  if (overReceipt && !input.allowOverReceipt) {
    throw new ValidationError('Received quantity exceeds the ordered quantity. Use the over-receipt override with a reason.')
  }
  if (overReceipt) {
    if (!input.allowOverReceiptReason?.trim()) {
      throw new ValidationError('An over-receipt needs a reason.')
    }
    if (!hasGrant(session, 'po.approve')) {
      throw new ValidationError('Over-receipt requires the purchase-order approval permission.')
    }
  }

  const now = new Date()
  const [receipt] = await tx
    .insert(purchaseOrderReceipts)
    .values({
      poId: po.id,
      receivedOn: input.receivedOn ?? now.toISOString().slice(0, 10),
      receivedBy: session.user.id,
      carrier: input.carrier ?? null,
      trackingId: input.trackingId ?? null,
      notes: input.notes ?? null,
      stockPostedAt: now,
      idempotencyKey: input.idempotencyKey,
    })
    .returning()
  if (!receipt) throw new ValidationError('The receipt could not be created.')

  const stockLines: Array<{ receiptLineId: number; partNo: string; qty: string }> = []

  for (const line of input.lines) {
    if (!line.partLineId && !line.specialPartLineId) {
      throw new ValidationError('Each receipt line must reference a PO line.')
    }
    const qty = dec(line.qty)
    if (compare(qty, ZERO) <= 0) throw new ValidationError('Received quantity must be greater than zero.')

    let ordered = ZERO
    let received = ZERO
    let over = ZERO
    let partNo: string | null = null

    if (line.partLineId) {
      const part = parts.find((p) => p.id === line.partLineId)
      if (!part) throw new ValidationError('That part line is not on this purchase order.')
      ordered = dec(part.qty)
      received = dec(part.qtyReceived)
      partNo = part.partNo
    } else {
      const special = specialParts.find((p) => p.id === line.specialPartLineId)
      if (!special) throw new ValidationError('That special-part line is not on this purchase order.')
      ordered = dec(special.qty)
      received = dec(special.qtyReceived)
    }

    const nextReceived = round(add(received, qty), 2)
    if (compare(nextReceived, ordered) > 0) {
      over = { value: nextReceived.value - ordered.value, scale: 2 }
    }
    const [inserted] = await tx
      .insert(purchaseOrderReceiptLines)
      .values({
        receiptId: receipt.id,
        partLineId: line.partLineId ?? null,
        specialPartLineId: line.specialPartLineId ?? null,
        qty: format(qty, 2),
        overReceivedQty: over.value > 0n ? format(over, 2) : '0.00',
        note: line.note ?? null,
      })
      .returning()
    if (!inserted) throw new ValidationError('The receipt line could not be created.')

    if (line.partLineId) {
      await tx
        .update(purchaseOrderParts)
        .set({ qtyReceived: format(nextReceived, 2) })
        .where(eq(purchaseOrderParts.id, line.partLineId))
      if (partNo) stockLines.push({ receiptLineId: inserted.id, partNo, qty: format(qty, 2) })
    } else if (line.specialPartLineId) {
      await tx
        .update(purchaseOrderSpecialParts)
        .set({ qtyReceived: format(nextReceived, 2) })
        .where(eq(purchaseOrderSpecialParts.id, line.specialPartLineId))
    }
  }

  const stockLinesPosted = await postPurchaseReceipt(tx, {
    poId: po.id,
    receiptId: receipt.id,
    lines: stockLines,
    session,
  })

  const refreshedParts = await tx
    .select()
    .from(purchaseOrderParts)
    .where(eq(purchaseOrderParts.poId, po.id))
  const refreshedSpecial = await tx
    .select()
    .from(purchaseOrderSpecialParts)
    .where(eq(purchaseOrderSpecialParts.poId, po.id))
  const complete =
    refreshedParts.every((p) => compare(dec(p.qtyReceived), dec(p.qty)) >= 0) &&
    refreshedSpecial.every((p) => compare(dec(p.qtyReceived), dec(p.qty)) >= 0)

  const nextStatus: PurchaseOrderStatus = complete ? 4 : 5
  const nextVersion = po.version + 1
  await tx
    .update(purchaseOrders)
    .set({
      status: nextStatus,
      stockPostedAt: now,
      version: nextVersion,
      updatedBy: session.user.id,
      updatedAt: now,
    })
    .where(eq(purchaseOrders.id, po.id))

  // An invoice recorded before the goods arrived was held as pending_receipt.
  // Receiving is the gate that releases it for matching and closure.
  if (complete) {
    const held = await tx
      .select()
      .from(purchaseOrderInvoices)
      .where(eq(purchaseOrderInvoices.poId, po.id))
    for (const invoice of held) {
      if (invoice.status !== 'pending_receipt') continue
      await tx
        .update(purchaseOrderInvoices)
        .set({ status: invoice.variance === '0.00' ? 'matched' : 'draft' })
        .where(eq(purchaseOrderInvoices.id, invoice.id))
    }
  }

  await recordStatus(tx, session, {
    poId: po.id,
    from: po.status as PurchaseOrderStatus,
    to: nextStatus,
    action: 'receive',
    version: nextVersion,
    note: input.notes ?? null,
  })
  await auditPurchaseOrder(tx, session, 'purchase_order.receive', po.id, {
    summary: `Received ${input.lines.length} line(s) on purchase order ${po.id}${
      overReceipt ? ' with an over-receipt' : ''
    }.`,
    permission: 'purchasing:write',
    before: { status: po.status, version: po.version },
    after: {
      status: nextStatus,
      version: nextVersion,
      receiptId: receipt.id,
      stockLinesPosted,
      overReceipt,
      overReceiptReason: input.allowOverReceiptReason ?? null,
    },
  })

  return {
    receiptId: receipt.id,
    status: nextStatus,
    version: nextVersion,
    stockLinesPosted,
    idempotent: false,
  }
}

export async function receivePurchaseOrder(
  input: PurchaseOrderReceiptInput,
  session: AuthSessionView,
  executor?: Db,
): Promise<ReceiptResult> {
  const db = executor ?? (await import('@cls/db')).getDb()
  return db.transaction((tx) => receivePurchaseOrderCore(tx, input, session))
}
