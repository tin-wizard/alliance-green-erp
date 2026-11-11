/**
 * Quote lifecycle: submit, approve, cancel, reject/resubmit, revise, soft delete.
 *
 * SERVER ONLY. Transitions are checked here against the same table the UI uses;
 * every write is version-guarded and audited in the transaction.
 */
import { and, eq, or } from 'drizzle-orm'
import { ConflictError, ValidationError } from '@cls/core'
import { getDb, type Db, type Tx } from '@cls/db'
import { quoteRejections, quotes } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type {
  QuoteReviseInput,
  QuoteRejectInput,
  QuoteStatusCode,
  QuoteTransitionInput,
} from '../types'
import {
  canTransitionQuote,
  illegalQuoteTransitionMessage,
  isQuoteStatusCode,
  quoteTransitionPermission,
} from '../lib/status'
import { quoteTotals } from '../lib/rules'
import { businessToday } from '../../work-orders/lib/rules'
import {
  assertQuoteApprove,
  assertQuotePermission,
  assertQuoteWrite,
  loadQuoteRow,
} from './access.server'
import { auditQuote, loadLines, replaceLines } from './records.server'

export async function transitionQuoteCore(
  tx: Tx,
  input: QuoteTransitionInput,
  session: AuthSessionView,
): Promise<{ id: number; status: number; version: number }> {
  assertQuotePermission(session, quoteTransitionPermission(input.to))
  const before = await loadQuoteRow(session, input.id, tx)
  if (before.version !== input.version) throw new ConflictError(`Quote ${input.id} changed since you loaded it.`)
  if (!before.isLastRevision) {
    throw new ValidationError('This quote has been superseded by a revision.')
  }
  const from = isQuoteStatusCode(before.status) ? before.status : (1 as QuoteStatusCode)
  if (!canTransitionQuote(from, input.to, before.kind)) {
    throw new ValidationError(illegalQuoteTransitionMessage(from, input.to, before.kind))
  }

  const [row] = await tx
    .update(quotes)
    .set({
      status: input.to,
      dateApproved: input.to === 4 ? businessToday() : before.dateApproved,
      version: before.version + 1,
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(and(eq(quotes.id, input.id), eq(quotes.version, input.version)))
    .returning()
  if (!row) throw new ConflictError(`Quote ${input.id} changed since you loaded it.`)

  await auditQuote(tx, session, `quote.transition.${input.to}`, input.id, {
    summary: `Quote ${input.id}: ${before.status} → ${input.to}${input.note ? ` — ${input.note}` : ''}`,
    before: { status: before.status, version: before.version },
    after: { status: row.status, version: row.version },
  })

  return { id: row.id, status: row.status, version: row.version }
}

export async function rejectQuoteCore(
  tx: Tx,
  input: QuoteRejectInput,
  session: AuthSessionView,
): Promise<{ id: number; status: number; version: number; rejectionId: number }> {
  assertQuoteApprove(session)
  const before = await loadQuoteRow(session, input.id, tx)
  if (before.version !== input.version) throw new ConflictError(`Quote ${input.id} changed since you loaded it.`)
  if (before.status !== 3) {
    throw new ValidationError('Only a quote waiting for approval can be rejected.')
  }

  const lines = await loadLines(tx, input.id)
  const content = {
    header: {
      id: before.id,
      kind: before.kind,
      workOrderNumber: before.workOrderNumber,
      siteId: before.siteId,
      taxCode: before.taxCode,
      revisionId: before.revisionId,
    },
    lines,
    totals: quoteTotals({
      taxCode: before.taxCode,
      appliedTaxRate: before.appliedTaxRate,
      manualTaxAmount: before.manualTaxAmount,
      ...lines,
    }),
  }

  const [rejection] = await tx
    .insert(quoteRejections)
    .values({
      quoteId: input.id,
      reason: input.reason,
      quoteContent: content as unknown as Record<string, unknown>,
      rejectedByDetail: input.rejectedByDetail ?? null,
      rejectedBy: session.user.id,
    })
    .returning()

  const [row] = await tx
    .update(quotes)
    .set({
      status: 5,
      version: before.version + 1,
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(and(eq(quotes.id, input.id), eq(quotes.version, input.version)))
    .returning()
  if (!row || !rejection) throw new ConflictError(`Quote ${input.id} changed since you loaded it.`)

  await auditQuote(tx, session, 'quote.reject', input.id, {
    summary: `Rejected quote ${input.id}: ${input.reason}`,
    before: { status: before.status },
    after: { status: row.status, rejectionId: rejection.id },
  })

  return {
    id: row.id,
    status: row.status,
    version: row.version,
    rejectionId: rejection.id,
  }
}

/**
 * Create a new revision row for a quote. `submit` is the resubmission path:
 * the new row starts in Waiting for approval instead of In Progress.
 */
export async function reviseQuoteCore(
  tx: Tx,
  input: QuoteReviseInput & { submit?: boolean },
  session: AuthSessionView,
): Promise<{ id: number; revisionId: string }> {
  assertQuoteWrite(session)
  const source = await loadQuoteRow(session, input.id, tx)
  if (!source.isLastRevision) {
    throw new ValidationError('Only the latest revision can be revised.')
  }
  if (source.status !== 4 && source.status !== 5) {
    throw new ValidationError('Only an approved or cancelled quote can be revised.')
  }
  if (input.submit) assertQuoteApprove(session)

  const rootId = source.rootQuoteId ?? source.id
  const lines = await loadLines(tx, source.id)

  await tx
    .update(quotes)
    .set({ isLastRevision: false })
    .where(or(eq(quotes.id, rootId), eq(quotes.rootQuoteId, rootId)))

  const nextRevision = (Number(source.revisionId) + 0.1).toFixed(1)
  const [row] = await tx
    .insert(quotes)
    .values({
      kind: source.kind,
      workOrderNumber: source.workOrderNumber,
      siteId: source.siteId,
      shipContact: source.shipContact,
      shipStreet1: source.shipStreet1,
      shipStreet2: source.shipStreet2,
      shipCity: source.shipCity,
      shipProvince: source.shipProvince,
      shipPostalCode: source.shipPostalCode,
      isAddressUpdated: source.isAddressUpdated,
      report: source.report,
      notes: [source.notes, input.reason].filter(Boolean).join('\n'),
      pdfNotes: source.pdfNotes,
      status: input.submit ? 3 : 1,
      paymentTermsId: source.paymentTermsId,
      taxCode: source.taxCode,
      appliedTaxRate: source.appliedTaxRate,
      manualTaxAmount: source.manualTaxAmount,
      dueDate: source.dueDate,
      isDueDateTbd: source.isDueDateTbd,
      isRevision: true,
      revisionQuoteId: source.id,
      rootQuoteId: rootId,
      revisionId: nextRevision,
      isLastRevision: true,
      createdFromLocal: source.createdFromLocal,
      referenceWoNumber: source.referenceWoNumber,
      createdBy: session.user.id,
      updatedBy: session.user.id,
    })
    .returning()
  if (!row) throw new ValidationError('The revision could not be created.')

  await replaceLines(tx, row.id, lines)
  await auditQuote(tx, session, 'quote.revise', row.id, {
    summary: `Created revision ${nextRevision} of quote ${rootId} from ${source.id}${input.submit ? ' and resubmitted it' : ''}.`,
    before: { id: source.id, revisionId: source.revisionId },
    after: { id: row.id, revisionId: row.revisionId, status: row.status },
  })

  return { id: row.id, revisionId: row.revisionId }
}

export async function deleteStandaloneQuoteCore(
  tx: Tx,
  id: number,
  session: AuthSessionView,
): Promise<void> {
  assertQuoteWrite(session)
  const before = await loadQuoteRow(session, id, tx)
  if (before.kind !== 'standalone') {
    throw new ValidationError('Only standalone quotes can be deleted.')
  }
  if (before.isDeleted) return
  await tx
    .update(quotes)
    .set({ isDeleted: true, isLastRevision: false, version: before.version + 1, updatedAt: new Date() })
    .where(and(eq(quotes.id, id), eq(quotes.version, before.version)))
  await auditQuote(tx, session, 'quote.delete', id, {
    summary: `Soft-deleted standalone quote ${id}.`,
    before: { isDeleted: false },
    after: { isDeleted: true },
  })
}

export async function transitionQuote(
  input: QuoteTransitionInput,
  session: AuthSessionView,
  executor?: Db,
) {
  const db = executor ?? getDb()
  return db.transaction((tx) => transitionQuoteCore(tx, input, session))
}

export async function rejectQuote(
  input: QuoteRejectInput,
  session: AuthSessionView,
  executor?: Db,
) {
  const db = executor ?? getDb()
  return db.transaction((tx) => rejectQuoteCore(tx, input, session))
}

export async function reviseQuote(
  input: QuoteReviseInput & { submit?: boolean },
  session: AuthSessionView,
  executor?: Db,
) {
  const db = executor ?? getDb()
  return db.transaction((tx) => reviseQuoteCore(tx, input, session))
}

export async function deleteStandaloneQuote(
  id: number,
  session: AuthSessionView,
  executor?: Db,
) {
  const db = executor ?? getDb()
  return db.transaction((tx) => deleteStandaloneQuoteCore(tx, id, session))
}

