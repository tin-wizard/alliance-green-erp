/**
 * Sage outbox processing. Invoice issuance only enqueues; this module is the
 * worker boundary, idempotent by external reference and never called from the
 * issue path.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import { getSageInvoiceGateway, type SageInvoiceLine } from '@cls/sage'
import { format, salesTaxRate, LEGACY_PART_PLACEHOLDER, LEGACY_PART_PLACEHOLDER_MESSAGE } from '@cls/pricing'
import { getDb, type Executor, type Tx } from '@cls/db'
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
  if (parts.some((line) => line.partNo.trim() === LEGACY_PART_PLACEHOLDER)) {
    throw new ValidationError(LEGACY_PART_PLACEHOLDER_MESSAGE)
  }
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

/**
 * A posting that fails more often than this stops retrying every tick. Five
 * tries covers an outage; beyond that the failure is not transient, so the row
 * goes to `dead_letter` for a human to look at.
 */
export const SAGE_POSTING_MAX_ATTEMPTS = 5

/** A claim older than this belongs to a worker that died mid-call. */
export const SAGE_POSTING_STALE_CLAIM_MS = 10 * 60 * 1000

export interface ProcessPostingResult {
  status: 'sent' | 'failed' | 'dead_letter'
  externalId: string | null
  error: string | null
}

type SagePosting = typeof sagePostings.$inferSelect

export type PostingOutcome =
  | { ok: true; externalId: string; duplicate: boolean }
  | { ok: false; error: string }

type Claim =
  | { kind: 'claimed'; posting: SagePosting }
  | { kind: 'done'; result: ProcessPostingResult }

/**
 * First short transaction: take the row, count the attempt, release the lock.
 * The Sage call happens after this commits, never inside it — otherwise a
 * failed write would roll the attempt back and re-send an accepted document.
 */
export async function claimSagePosting(tx: Tx, postingId: number): Promise<Claim> {
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
      .set({
        status: 'sent',
        response: { externalId: link.externalId },
        claimedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(sagePostings.id, posting.id))
    return { kind: 'done', result: { status: 'sent', externalId: link.externalId, error: null } }
  }
  if (posting.status === 'sent') {
    const externalId = (posting.response?.externalId as string | undefined) ?? null
    return { kind: 'done', result: { status: 'sent', externalId, error: null } }
  }
  // A fresh claim belongs to a worker that is probably still calling Sage. The
  // attempt cap below is what eventually recovers a claim that never returns.
  if (
    posting.status === 'processing' &&
    posting.claimedAt &&
    Date.now() - posting.claimedAt.getTime() < SAGE_POSTING_STALE_CLAIM_MS
  ) {
    return {
      kind: 'done',
      result: { status: 'failed', externalId: null, error: 'Another worker is posting this document.' },
    }
  }
  if (posting.status === 'dead_letter' || posting.attempt >= SAGE_POSTING_MAX_ATTEMPTS) {
    if (posting.status !== 'dead_letter') {
      await tx
        .update(sagePostings)
        .set({
          status: 'dead_letter',
          lastError: posting.lastError ?? `Gave up after ${posting.attempt} attempts.`,
          claimedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(sagePostings.id, posting.id))
    }
    return {
      kind: 'done',
      result: {
        status: 'dead_letter',
        externalId: null,
        error: posting.lastError ?? `Gave up after ${posting.attempt} attempts.`,
      },
    }
  }
  const [claimed] = await tx
    .update(sagePostings)
    .set({
      status: 'processing',
      attempt: posting.attempt + 1,
      claimedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(sagePostings.id, posting.id))
    .returning()
  return { kind: 'claimed', posting: claimed! }
}

/** Second short transaction: write what Sage answered. */
export async function recordSagePostingOutcome(
  tx: Tx,
  posting: SagePosting,
  outcome: PostingOutcome,
  session: AuthSessionView | null,
): Promise<ProcessPostingResult> {
  if (!outcome.ok) {
    const status = posting.attempt >= SAGE_POSTING_MAX_ATTEMPTS ? 'dead_letter' : 'failed'
    await tx
      .update(sagePostings)
      .set({ status, lastError: outcome.error, claimedAt: null, updatedAt: new Date() })
      .where(eq(sagePostings.id, posting.id))
    return { status, externalId: null, error: outcome.error }
  }

  await tx
    .insert(sageLinks)
    .values({
      docType: posting.docType,
      docId: posting.docId,
      externalRef: posting.externalRef,
      externalId: outcome.externalId,
    })
    .onConflictDoNothing()
  await tx
    .update(sagePostings)
    .set({
      status: 'sent',
      response: { externalId: outcome.externalId, duplicate: outcome.duplicate },
      processedAt: new Date(),
      claimedAt: null,
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
        after: { externalId: outcome.externalId },
      })
    }
  }
  return { status: 'sent', externalId: outcome.externalId, error: null }
}

/**
 * Worker entry point. Claim in one transaction, call Sage outside any
 * transaction, record the answer in a second one. A failure never rolls back
 * the issued invoice, and an accepted document is never posted twice: the
 * gateway is idempotent by external reference.
 */
export async function processSagePosting(
  postingId: number,
  session: AuthSessionView | null,
): Promise<ProcessPostingResult> {
  const db = getDb()
  const claim = await db.transaction((tx) => claimSagePosting(tx, postingId))
  if (claim.kind === 'done') return claim.result

  const posting = claim.posting
  const gateway = getSageInvoiceGateway()
  let outcome: PostingOutcome
  try {
    const result =
      posting.docType === 'sales_invoice'
        ? await gateway.postSalesInvoice(posting.payload as never)
        : posting.docType === 'purchase_credit_note'
          ? await gateway.postPurchaseCreditNote(posting.payload as never)
          : await gateway.postPurchaseInvoice(posting.payload as never)
    outcome = { ok: true, externalId: result.externalId, duplicate: result.duplicate }
  } catch (error) {
    outcome = { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  return db.transaction((tx) => recordSagePostingOutcome(tx, posting, outcome, session))
}

/**
 * Rows a human has to look at: failed ones retry on their own, dead letters do
 * not, so the admin screen lists both and lets somebody put one back in the queue.
 */
export interface SageOutboxRow {
  id: number
  docType: string
  docId: number
  externalRef: string
  status: string
  attempt: number
  lastError: string | null
  updatedAt: string
}

export async function listSageOutbox(
  executor: Executor,
  limit = 50,
): Promise<SageOutboxRow[]> {
  const rows = await executor
    .select({
      id: sagePostings.id,
      docType: sagePostings.docType,
      docId: sagePostings.docId,
      externalRef: sagePostings.externalRef,
      status: sagePostings.status,
      attempt: sagePostings.attempt,
      lastError: sagePostings.lastError,
      updatedAt: sagePostings.updatedAt,
    })
    .from(sagePostings)
    .where(inArray(sagePostings.status, ['failed', 'dead_letter']))
    .orderBy(desc(sagePostings.updatedAt))
    .limit(limit)
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))
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
  if (!posting || posting.status === 'cancelled' || posting.status === 'sent') {
    throw new ValidationError('That Sage posting cannot be retried.')
  }
  // A human retry starts a fresh attempt budget, otherwise a poisoned row would
  // go straight back to dead_letter on the next tick.
  await tx
    .update(sagePostings)
    .set({ status: 'queued', attempt: 0, claimedAt: null, lastError: null, updatedAt: new Date() })
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
