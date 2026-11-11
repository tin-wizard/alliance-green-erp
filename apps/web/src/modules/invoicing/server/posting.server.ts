/**
 * Sage outbox processing. Invoice issuance only enqueues; this module is the
 * worker boundary, idempotent by external reference and never called from the
 * issue path.
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import { getSageInvoiceGateway, type SageInvoiceLine } from '@cls/sage'
import { format, salesTaxRate } from '@cls/pricing'
import type { Executor, Tx } from '@cls/db'
import {
  invoiceLabourLines,
  invoicePartLines,
  invoiceSpecialPartLines,
  invoiceStockPostings,
  sageLinks,
  sagePostings,
  salesInvoices,
  subcontractorInvoiceLines,
  subcontractorInvoices,
  subcontractors,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import { assertSalesInvoiceIssue, loadSalesInvoice } from './access.server'
import { auditInvoice } from './records.server'

function externalRef(docType: string, docId: number): string {
  return `cls:${docType}:${docId}`
}

function taxRateFor(province: string, override: string | null): string {
  const rate = override ?? format(salesTaxRate(province).rate, 5)
  return rate
}

async function salesInvoicePayload(
  invoiceId: number,
  executor: Executor,
): Promise<Record<string, unknown>> {
  const [invoice] = await executor
    .select()
    .from(salesInvoices)
    .where(eq(salesInvoices.id, invoiceId))
    .limit(1)
  if (!invoice) throw new ValidationError('That invoice does not exist.')
  const [labour, parts, specialParts] = await Promise.all([
    executor
      .select()
      .from(invoiceLabourLines)
      .where(eq(invoiceLabourLines.invoiceId, invoiceId))
      .orderBy(asc(invoiceLabourLines.position)),
    executor
      .select()
      .from(invoicePartLines)
      .where(eq(invoicePartLines.invoiceId, invoiceId))
      .orderBy(asc(invoicePartLines.position)),
    executor
      .select()
      .from(invoiceSpecialPartLines)
      .where(eq(invoiceSpecialPartLines.invoiceId, invoiceId))
      .orderBy(asc(invoiceSpecialPartLines.position)),
  ])
  const taxRate = taxRateFor(invoice.taxProvince, invoice.appliedTaxRate)
  const lines: SageInvoiceLine[] = [
    ...labour.map((line) => ({
      description: line.description || `Labour — ${line.lineDate}`,
      quantity: line.hours,
      unitPrice: line.hourlyRate,
      taxRate,
      lineTotal: line.amount,
    })),
    ...parts.map((line) => ({
      description: line.description || line.partNo,
      partNumber: line.partNo,
      quantity: line.qty,
      unitPrice: line.price,
      taxRate,
      lineTotal: line.amount,
    })),
    ...specialParts.map((line) => ({
      description: line.name,
      quantity: line.qty,
      unitPrice: line.price,
      taxRate,
      lineTotal: line.amount,
    })),
  ]
  return {
    externalRef: externalRef('sales_invoice', invoice.id),
    invoiceNumber: invoice.invoiceNumber,
    workOrderNumber: String(invoice.workOrderNumber),
    customerName: invoice.customerId ? `Customer ${invoice.customerId}` : 'Customer',
    invoiceDate: invoice.invoiceDate,
    taxProvince: invoice.taxProvince,
    subtotal: invoice.subtotalAmount,
    tax: invoice.taxAmount,
    total: invoice.totalAmount,
    lines,
  }
}

async function purchaseInvoicePayload(
  invoiceId: number,
  executor: Executor,
): Promise<Record<string, unknown>> {
  const [invoice] = await executor
    .select()
    .from(subcontractorInvoices)
    .where(eq(subcontractorInvoices.id, invoiceId))
    .limit(1)
  if (!invoice) throw new ValidationError('That subcontractor invoice does not exist.')
  const [lines, supplierRows] = await Promise.all([
    executor
      .select()
      .from(subcontractorInvoiceLines)
      .where(eq(subcontractorInvoiceLines.invoiceId, invoiceId))
      .orderBy(asc(subcontractorInvoiceLines.position)),
    executor
      .select({ name: subcontractors.name })
      .from(subcontractors)
      .where(eq(subcontractors.id, invoice.subcontractorId))
      .limit(1),
  ])
  const taxRate = taxRateFor(invoice.taxProvince, invoice.appliedTaxRate)
  return {
    externalRef: externalRef('subcontractor_invoice', invoice.id),
    invoiceNumber: invoice.invoiceNumber,
    workOrderNumber: String(invoice.workOrderId),
    supplierName: supplierRows[0]?.name ?? `Subcontractor ${invoice.subcontractorId}`,
    invoiceDate: invoice.invoiceDate,
    taxProvince: invoice.taxProvince,
    subtotal: invoice.subtotalAmount,
    tax: invoice.taxAmount,
    total: invoice.totalAmount,
    lines: lines.map((line) => ({
      description: line.description ?? line.kind,
      quantity: line.qty,
      unitPrice: line.rate,
      taxRate,
      lineTotal: line.amount,
    })),
  }
}

export async function queueSalesInvoicePostingCore(
  tx: Tx,
  invoiceId: number,
  session: AuthSessionView,
): Promise<void> {
  const invoice = await loadSalesInvoice(session, invoiceId, tx)
  const payload = await salesInvoicePayload(invoiceId, tx)
  const ref = externalRef('sales_invoice', invoice.id)
  const [existing] = await tx
    .select()
    .from(sagePostings)
    .where(eq(sagePostings.externalRef, ref))
    .limit(1)
  if (existing) {
    const [link] = await tx
      .select()
      .from(sageLinks)
      .where(eq(sageLinks.externalRef, ref))
      .limit(1)
    if (link) throw new ValidationError('This invoice is already linked to Sage.')
    await tx
      .update(sagePostings)
      .set({
        payload,
        status: 'queued',
        attempt: 0,
        lastError: null,
        response: null,
        requestedAt: new Date(),
        processedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(sagePostings.id, existing.id))
    return
  }
  await tx.insert(sagePostings).values({
    docType: 'sales_invoice',
    docId: invoice.id,
    externalRef: ref,
    payload,
    status: 'queued',
  })
}

export async function queueSubcontractorPostingCore(
  tx: Tx,
  invoiceId: number,
): Promise<void> {
  const payload = await purchaseInvoicePayload(invoiceId, tx)
  const ref = externalRef('subcontractor_invoice', invoiceId)
  const [existing] = await tx
    .select()
    .from(sagePostings)
    .where(eq(sagePostings.externalRef, ref))
    .limit(1)
  if (existing) {
    await tx
      .update(sagePostings)
      .set({ payload, status: 'queued', lastError: null, updatedAt: new Date() })
      .where(eq(sagePostings.id, existing.id))
    return
  }
  await tx.insert(sagePostings).values({
    docType: 'subcontractor_invoice',
    docId: invoiceId,
    externalRef: ref,
    payload,
    status: 'queued',
  })
}

export interface ProcessPostingResult {
  status: 'sent' | 'failed'
  externalId: string | null
  error: string | null
}

/** Worker entry point. A failure never rolls back the issued invoice. */
export async function processSagePostingCore(
  tx: Tx,
  postingId: number,
  session: AuthSessionView | null,
): Promise<ProcessPostingResult> {
  const [posting] = await tx
    .select()
    .from(sagePostings)
    .where(eq(sagePostings.id, postingId))
    .for('update')
  if (!posting) throw new ValidationError('That Sage posting does not exist.')
  if (posting.status === 'cancelled') {
    throw new ValidationError('This Sage posting was cancelled.')
  }
  const [link] = await tx
    .select()
    .from(sageLinks)
    .where(eq(sageLinks.externalRef, posting.externalRef))
    .limit(1)
  if (link) {
    await tx
      .update(sagePostings)
      .set({ status: 'sent', response: { externalId: link.externalId }, updatedAt: new Date() })
      .where(eq(sagePostings.id, posting.id))
    return { status: 'sent', externalId: link.externalId, error: null }
  }

  await tx
    .update(sagePostings)
    .set({ status: 'processing', attempt: posting.attempt + 1, updatedAt: new Date() })
    .where(eq(sagePostings.id, posting.id))

  const gateway = getSageInvoiceGateway()
  try {
    const result =
      posting.docType === 'sales_invoice'
        ? await gateway.postSalesInvoice(posting.payload as never)
        : posting.docType === 'purchase_credit_note'
          ? await gateway.postPurchaseCreditNote(posting.payload as never)
          : await gateway.postPurchaseInvoice(posting.payload as never)
    await tx
      .insert(sageLinks)
      .values({
        docType: posting.docType,
        docId: posting.docId,
        externalRef: posting.externalRef,
        externalId: result.externalId,
      })
      .onConflictDoNothing()
    await tx
      .update(sagePostings)
      .set({
        status: 'sent',
        response: { externalId: result.externalId, duplicate: result.duplicate },
        processedAt: new Date(),
        updatedAt: new Date(),
        lastError: null,
      })
      .where(eq(sagePostings.id, posting.id))
    if (posting.docType === 'sales_invoice') {
      await tx
        .update(salesInvoices)
        .set({ updatedAt: new Date(), version: sql`${salesInvoices.version} + 1` })
        .where(eq(salesInvoices.id, posting.docId))
      if (session) {
        await auditInvoice(tx, session, 'invoice.sage_posted', posting.docId, {
          summary: `Sage accepted invoice posting ${posting.externalRef}.`,
          permission: 'invoice.post_sage',
          after: { externalId: result.externalId },
        })
      }
    }
    return { status: 'sent', externalId: result.externalId, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await tx
      .update(sagePostings)
      .set({ status: 'failed', lastError: message, updatedAt: new Date() })
      .where(eq(sagePostings.id, posting.id))
    return { status: 'failed', externalId: null, error: message }
  }
}

export async function retrySagePostingCore(
  tx: Tx,
  postingId: number,
  session: AuthSessionView,
): Promise<void> {
  assertSalesInvoiceIssue(session)
  const [posting] = await tx
    .select()
    .from(sagePostings)
    .where(eq(sagePostings.id, postingId))
    .for('update')
  if (!posting || posting.status === 'cancelled') {
    throw new ValidationError('That Sage posting cannot be retried.')
  }
  await tx
    .update(sagePostings)
    .set({ status: 'queued', lastError: null, updatedAt: new Date() })
    .where(eq(sagePostings.id, postingId))
}

/** Record the stock side when it is performed. The guard reads this row. */
export async function recordStockPostingCore(
  tx: Tx,
  input: { invoiceId: number; reference: string; movementCount?: number },
  session: AuthSessionView,
): Promise<{ id: number }> {
  assertSalesInvoiceIssue(session)
  const [row] = await tx
    .insert(invoiceStockPostings)
    .values({
      invoiceId: input.invoiceId,
      status: 'posted',
      reference: input.reference,
      movementCount: input.movementCount ?? 0,
      createdBy: session.user.id,
    })
    .onConflictDoNothing({ target: invoiceStockPostings.invoiceId })
    .returning()
  if (!row) {
    const [existing] = await tx
      .select()
      .from(invoiceStockPostings)
      .where(eq(invoiceStockPostings.invoiceId, input.invoiceId))
    return { id: existing!.id }
  }
  await auditInvoice(tx, session, 'invoice.stock_posted', input.invoiceId, {
    summary: `Recorded stock posting for invoice ${input.invoiceId}.`,
    permission: 'invoice:issue',
    after: { reference: input.reference },
  })
  return { id: row.id }
}

export async function cancelSalesPostingCore(tx: Tx, invoiceId: number): Promise<void> {
  await tx
    .update(sagePostings)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(eq(sagePostings.docType, 'sales_invoice'), eq(sagePostings.docId, invoiceId), eq(sagePostings.status, 'queued')),
    )
}
