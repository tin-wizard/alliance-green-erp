/**
 * Supplier credits against purchase orders.
 *
 * SERVER ONLY. A credit is a supplier-invoice-shaped document carrying negative
 * quantities: it reduces the open AP balance and never the ordered quantity.
 * The ordinary invoice path stays positive-only — `createPurchaseOrderInvoiceCore`
 * keeps rejecting `qty <= 0` — so a credit is only reachable from here.
 *
 * One source of truth for the document: a credit is a `purchase_order_invoices`
 * row with negative amounts. The source names either the corrected PO or the RGA
 * it settles; an RGA-sourced credit derives its PO from the part lines it
 * corrects, and its reference becomes the credit's reference when none is given.
 *
 * No credit leaves a PO line with a negative invoiced quantity: the invoice path
 * caps invoiced quantity at the ordered quantity, this path caps the reduction at
 * what was actually invoiced. Nothing here touches PO status, ordered prices or
 * received quantities.
 *
 * Purchasing has no AP ledger. `apAccountId` is accepted and carried on the
 * credit's audit payload for the posting adapter; it is never posted here.
 */
import { eq, inArray } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import type { Db, Tx } from '@cls/db'
import {
  purchaseOrderInvoiceLines,
  purchaseOrderInvoices,
  purchaseOrderParts,
} from '@cls/db/schema'
import { add, compare, format, multiply, round, subtract } from '@cls/pricing'
import type { Decimal } from '@cls/pricing'
import { assertPermission } from '../../../server/middleware'
import type { AuthSessionView } from '../../../server/auth.types'
import type { CreateSupplierCreditInput } from '../types'
import { loadPurchaseOrder } from './access.server'
import { auditPurchaseOrder } from './records.server'
import { ZERO, dec, invoiceLineAmounts } from './invoices.server'

export type { CreateSupplierCreditInput }

interface ResolvedCreditSource {
  poId: number
  rgaReference: string | null
}

/**
 * The credit's PO: named outright, or derived from the part lines an RGA credit
 * corrects (one PO per credit — a credit is a correction of one order).
 */
async function resolveCreditSource(
  tx: Tx,
  input: CreateSupplierCreditInput,
): Promise<ResolvedCreditSource> {
  if ('purchaseOrderId' in input.source) {
    return { poId: input.source.purchaseOrderId, rgaReference: null }
  }

  const rgaReference = input.source.rgaReference.trim()
  if (!rgaReference) throw new ValidationError('A supplier credit needs an RGA reference.')
  const partIds = input.lines
    .map((line) => line.partId)
    .filter((id): id is number => typeof id === 'number')
  if (!partIds.length) {
    throw new ValidationError(
      'An RGA-sourced credit must name the part lines it corrects so its purchase order can be found.',
    )
  }

  const rows = await tx
    .select({ id: purchaseOrderParts.id, poId: purchaseOrderParts.poId })
    .from(purchaseOrderParts)
    .where(inArray(purchaseOrderParts.id, partIds))
  if (rows.length !== new Set(partIds).size) {
    throw new ValidationError('That part line is not on a purchase order.')
  }
  const poIds = new Set(rows.map((row) => row.poId))
  if (poIds.size !== 1) {
    throw new ValidationError('A supplier credit must correct one purchase order.')
  }
  return { poId: [...poIds][0]!, rgaReference }
}

/** A credit with no caller reference gets a stable, supplier-unique number. */
function defaultCreditReference(poId: number, priorDocuments: number): string {
  return `CREDIT-${poId}-${priorDocuments + 1}`
}

export async function createSupplierCreditCore(
  tx: Tx,
  input: CreateSupplierCreditInput,
  session: AuthSessionView,
): Promise<{ creditId: number; reference: string }> {
  assertPermission(session, 'invoice:write')
  if (!input.lines.length) throw new ValidationError('A supplier credit needs at least one line.')

  const { poId, rgaReference } = await resolveCreditSource(tx, input)
  const po = await loadPurchaseOrder(session, poId, tx)
  if (po.supplierId !== input.supplierId) {
    throw new ValidationError('The supplier does not match the purchase order this credit corrects.')
  }

  const parts = await tx.select().from(purchaseOrderParts).where(eq(purchaseOrderParts.poId, po.id))
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

  let subtotal = ZERO
  let tax = ZERO
  let variance = ZERO
  const rows: Array<typeof purchaseOrderInvoiceLines.$inferInsert> = []

  for (const [index, line] of input.lines.entries()) {
    const qty = dec(line.qty)
    if (compare(qty, ZERO) >= 0) {
      throw new ValidationError('Credit quantity must be less than zero.')
    }

    let poPrice = ZERO
    let partLineId: number | null = null

    if (line.partId) {
      const part = parts.find((row) => row.id === line.partId)
      if (!part) throw new ValidationError('That part line is not on this purchase order.')
      poPrice = dec(part.price)
      partLineId = part.id
      const alreadyInvoiced = priorLines
        .filter((row) => row.partLineId === part.id)
        .reduce((sum, row) => add(sum, dec(row.qty)), ZERO)
      if (compare(add(alreadyInvoiced, qty), ZERO) < 0) {
        throw new ValidationError('A credit cannot reduce the invoiced quantity below zero.')
      }
    }

    const unitPrice = dec(line.rate)
    const rate = dec(line.taxRate)
    const { lineTotal, taxAmount } = invoiceLineAmounts(qty, unitPrice, rate)
    // Variance is measured against the ordered price; a line with no PO part has
    // nothing to compare, so it records none.
    const priceVariance =
      partLineId === null
        ? ZERO
        : round(multiply(qty, subtract(unitPrice, poPrice)), 2)

    subtotal = add(subtotal, lineTotal)
    tax = add(tax, taxAmount)
    variance = add(variance, priceVariance)

    rows.push({
      invoiceId: 0,
      partLineId,
      specialPartLineId: null,
      qty: format(qty, 2),
      unitPrice: format(unitPrice, 2),
      lineTotal: format(lineTotal, 2),
      taxAmount: format(taxAmount, 2),
      variance: format(priceVariance, 2),
      sortOrder: index,
    })
  }

  // Same arithmetic as the invoice path, with freight fixed at zero: a credit
  // corrects goods, never carriage.
  const freight: Decimal = ZERO
  const total = round(add(add(subtotal, tax), freight), 2)
  if (compare(subtotal, ZERO) >= 0 || compare(total, ZERO) >= 0) {
    throw new ValidationError('A supplier credit must leave a negative subtotal and total.')
  }
  if (compare(tax, ZERO) > 0) {
    throw new ValidationError('A supplier credit cannot carry positive tax.')
  }

  const reference =
    input.reference?.trim() ||
    rgaReference ||
    defaultCreditReference(po.id, priorInvoices.length)
  const status = compare(variance, ZERO) === 0 ? 'matched' : 'draft'

  const [credit] = await tx
    .insert(purchaseOrderInvoices)
    .values({
      poId: po.id,
      supplierId: input.supplierId,
      supplierInvoiceNumber: reference,
      invoiceDate: input.creditDate,
      taxCode: po.taxCode,
      appliedTaxRate: po.appliedTaxRate,
      subtotal: format(subtotal, 2),
      tax: format(tax, 2),
      freight: format(freight, 2),
      total: format(total, 2),
      status,
      variance: format(variance, 2),
      // Credits state a rate per line, so there is no tax variance to record.
      varianceDetail: null,
      createdBy: session.user.id,
    })
    .returning()
  if (!credit) throw new ValidationError('The supplier credit could not be created.')

  if (rows.length) {
    await tx
      .insert(purchaseOrderInvoiceLines)
      .values(rows.map((row) => ({ ...row, invoiceId: credit.id })))
  }

  await auditPurchaseOrder(tx, session, 'purchase_credit.created', po.id, {
    summary: `Recorded supplier credit ${reference} (${format(total, 2)}).`,
    permission: 'invoice:write',
    after: {
      creditId: credit.id,
      status,
      source: rgaReference ? 'rga' : 'purchase_order',
      rgaReference,
      apAccountId: input.apAccountId ?? null,
      subtotal: format(subtotal, 2),
      tax: format(tax, 2),
      total: format(total, 2),
      variance: format(variance, 2),
      lines: input.lines.map((line) => ({
        description: line.description,
        partId: line.partId ?? null,
        qty: line.qty,
        rate: line.rate,
        taxRate: line.taxRate,
      })),
    },
  })

  return { creditId: credit.id, reference }
}

export async function createSupplierCredit(
  input: CreateSupplierCreditInput,
  session: AuthSessionView,
  executor?: Db,
) {
  const db = executor ?? (await import('@cls/db')).getDb()
  return db.transaction((tx) => createSupplierCreditCore(tx, input, session))
}
