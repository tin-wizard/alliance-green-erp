/**
 * RGA credit recording — the correction path.
 *
 * The document belongs to Purchasing. This module computes what is being
 * corrected and calls `createSupplierCreditCore`, which owns the negative
 * purchase-invoice row, the invoiced-quantity cap and the AP variance. Nothing
 * here re-implements that arithmetic or writes a `purchase_order_invoices` row.
 *
 * Sage receives the result as a purchase credit note in the shared outbox
 * (`sage_postings`), keyed by the RGA credit id.
 */
import { and, eq } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import type { Tx } from '@cls/db'
import {
  purchaseOrders,
  rgaCreditLines,
  rgaCredits,
  rgaParts,
  rgas,
  rgaSpecialParts,
  rgaStatusHistory,
  sagePostings,
  suppliers,
} from '@cls/db/schema'
import { calculatePurchaseOrderTotals, format, multiply, parseDecimal, round } from '@cls/pricing'
import type { AuthSessionView } from '../../../server/auth.types'
import { canRecordCredit, rgaNumber, statusLabel } from '../lib/lifecycle'
import { assertRgaCredit, loadRga } from './access.server'
import { auditRga, rgaSnapshot } from './records.server'
import { createSupplierCreditCore } from '../../purchasing/server/credits.server'

function negative(value: string): string {
  if (value.startsWith('-')) return value
  if (/^0(?:\.0+)?$/.test(value)) return value
  return `-${value}`
}

function lineAmount(qty: string, price: string): string {
  const q = parseDecimal(qty)
  const p = parseDecimal(price)
  if (!q || !p) throw new ValidationError('That credit line has an invalid quantity or price.')
  return format(round(multiply(q, p), 2), 2)
}

export async function recordRgaCreditCore(
  tx: Tx,
  input: {
    rgaId: number
    version: number
    creditNumber?: string
    creditDate?: string
    taxProvince: string
    appliedTaxRate?: string | null
  },
  session: AuthSessionView,
) {
  assertRgaCredit(session)
  const row = await loadRga(session, input.rgaId, tx)
  if (!canRecordCredit(row.status, row.rgaType)) {
    throw new ValidationError(
      `A credit can only be recorded for an approved credit RGA. R-${row.id} is ${statusLabel(row.status)}.`,
    )
  }
  if (row.version !== input.version) {
    throw new ValidationError('This RGA changed since you loaded it. Reload and try again.')
  }
  if (!row.poId || !row.supplierId) {
    throw new ValidationError('A credit needs a purchase order and a supplier on the RGA.')
  }

  const [existing] = await tx
    .select({ id: rgaCredits.id })
    .from(rgaCredits)
    .where(eq(rgaCredits.rgaId, row.id))
    .limit(1)
  if (existing) throw new ValidationError('This RGA already has a credit.')

  const [po] = await tx
    .select({ id: purchaseOrders.id, supplierId: purchaseOrders.supplierId })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, row.poId))
    .limit(1)
  if (!po) throw new ValidationError('The RGA purchase order no longer exists.')
  if (po.supplierId !== row.supplierId) {
    throw new ValidationError('The RGA supplier does not match its purchase order.')
  }
  const [supplier] = await tx
    .select({ name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.id, row.supplierId))
    .limit(1)

  const parts = await tx.select().from(rgaParts).where(eq(rgaParts.rgaId, row.id))
  const specials = await tx
    .select()
    .from(rgaSpecialParts)
    .where(eq(rgaSpecialParts.rgaId, row.id))

  const totals = calculatePurchaseOrderTotals({
    taxProvince: input.taxProvince,
    appliedTaxRate: input.appliedTaxRate ?? null,
    parts: parts.map((line) => ({ qty: line.returnQty, price: line.price })),
    specialParts: specials.map((line) => ({ name: line.name, qty: line.returnQty, price: line.price })),
  })

  const creditLines = [
    ...parts.map((line, index) => ({
      kind: 'part' as const,
      position: index + 1,
      partNo: line.partNo,
      description: line.description || line.partNo,
      qty: line.returnQty,
      unitPrice: line.price,
      amount: lineAmount(line.returnQty, line.price),
      partId: line.poPartId,
    })),
    ...specials.map((line, index) => ({
      kind: 'special' as const,
      position: parts.length + index + 1,
      partNo: null,
      description: line.description || line.name,
      qty: line.returnQty,
      unitPrice: line.price,
      amount: lineAmount(line.returnQty, line.price),
      partId: null,
    })),
  ].filter((line) => Number(line.qty) > 0)

  if (!creditLines.length) throw new ValidationError('The RGA has no return quantities to credit.')

  const reference = input.creditNumber?.trim() || rgaNumber(row.id)
  const creditDate = input.creditDate ?? new Date().toISOString().slice(0, 10)

  const shared = await createSupplierCreditCore(
    tx,
    {
      source: { purchaseOrderId: row.poId },
      supplierId: row.supplierId,
      creditDate,
      reference,
      apAccountId: '21000000',
      lines: creditLines.map((line) => ({
        description: `${rgaNumber(row.id)} — ${line.description}`,
        partId: line.partId,
        qty: negative(line.qty),
        rate: line.unitPrice,
        taxRate: totals.taxRate,
      })),
    },
    session,
  )

  const [credit] = await tx
    .insert(rgaCredits)
    .values({
      rgaId: row.id,
      supplierId: row.supplierId,
      sourceType: 'purchase_order',
      sourceId: String(row.poId),
      creditNumber: shared.reference,
      creditDate,
      taxProvince: input.taxProvince,
      appliedTaxRate: totals.taxRate,
      subtotalAmount: totals.subtotal,
      taxAmount: totals.tax,
      totalAmount: totals.total,
      status: 'posted',
      postedAt: new Date(),
      createdBy: session.user.id,
    })
    .returning()
  if (!credit) throw new ValidationError('The RGA credit could not be recorded.')

  await tx.insert(rgaCreditLines).values(
    creditLines.map((line) => ({
      creditId: credit.id,
      kind: line.kind,
      position: line.position,
      partNo: line.partNo,
      description: line.description,
      qty: line.qty,
      unitPrice: line.unitPrice,
      amount: line.amount,
    })),
  )

  await tx.insert(sagePostings).values({
    docType: 'purchase_credit_note',
    docId: credit.id,
    externalRef: `cls:rga_credit:${credit.id}`,
    status: 'queued',
    payload: {
      externalRef: `cls:rga_credit:${credit.id}`,
      creditDate,
      contactName: supplier?.name ?? `Supplier ${row.supplierId}`,
      workOrderNumber: null,
      subtotal: negative(totals.subtotal),
      tax: negative(totals.tax),
      total: negative(totals.total),
      lines: creditLines.map((line) => ({
        description: `${rgaNumber(row.id)} — ${line.description}`,
        quantity: negative(line.qty),
        unitPrice: line.unitPrice,
        taxRate: totals.taxRate,
        lineTotal: negative(line.amount),
        partNumber: line.partNo,
      })),
      note: `Supplier credit for RGA ${rgaNumber(row.id)} (${shared.reference}).`,
    },
  })

  const now = new Date()
  const [updated] = await tx
    .update(rgas)
    .set({
      status: 11,
      rgaInvoiceNumber: shared.reference,
      rgaInvoiceDate: creditDate,
      completedAt: now,
      version: row.version + 1,
      updatedAt: now,
    })
    .where(and(eq(rgas.id, row.id), eq(rgas.version, row.version)))
    .returning()
  if (!updated) {
    throw new ValidationError('This RGA changed since you loaded it. Reload and try again.')
  }

  await tx.insert(rgaStatusHistory).values({
    rgaId: row.id,
    fromStatus: row.status,
    toStatus: 11,
    action: 'credit',
    actorId: session.user.id,
    actorLabel: session.user.email,
    note: `Credit ${shared.reference} recorded.`,
    rgaVersion: updated.version,
  })
  await auditRga(tx, session, 'rga.credit', row.id, {
    summary: `Recorded credit ${shared.reference} for RGA R-${row.id}.`,
    before: rgaSnapshot(row),
    after: {
      status: updated.status,
      version: updated.version,
      creditId: credit.id,
      purchasingCreditId: shared.creditId,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      sageExternalRef: `cls:rga_credit:${credit.id}`,
    },
  })

  return {
    creditId: credit.id,
    reference: shared.reference,
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
    sageExternalRef: `cls:rga_credit:${credit.id}`,
  }
}
