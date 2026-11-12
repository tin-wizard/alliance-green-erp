/**
 * TJX quote lifecycle: submit, return, approve, cancel and save-as-revision.
 *
 * SERVER ONLY. Each transition is one transaction with a version guard, a full
 * revision snapshot and an audit event. Approved quotes are immutable.
 */
import { and, eq, ne } from 'drizzle-orm'
import { ConflictError, NotFoundError, ValidationError } from '@cls/core'
import type { Tx } from '@cls/db'
import {
  tjxQuoteRevisions,
  tjxQuoteWorkOrders,
  tjxQuotes,
  workOrders,
} from '@cls/db/schema'
import { calculateTjxQuote, PricingError } from '@cls/pricing'
import type { AuthSessionView } from '../../../server/auth.types'
import { assertPermission } from '../../../server/middleware'
import type { TjxQuoteDetail } from '../types'
import {
  canCancelQuote,
  canEditQuote,
  isTjxGridType,
  isTjxPaymentTerms,
  TJX_QUOTE_TYPES,
} from '../lib/lifecycle'
import { assertTjxWrite, auditTjx } from './access.server'
import {
  getQuoteDetail,
  nextSaveSeq,
  revisionQuoteData,
} from './quotes.server'

const QUOTE_TYPES = new Set<string>(TJX_QUOTE_TYPES)

function assertApprove(session: AuthSessionView): void {
  assertTjxWrite(session)
  assertPermission(session, 'quote:approve')
}

async function loadRow(tx: Tx, id: number) {
  const [row] = await tx.select().from(tjxQuotes).where(eq(tjxQuotes.id, id)).limit(1)
  if (!row) throw new NotFoundError('TJX quote')
  return row
}

function assertVersion(current: number, requested: number, id: number): void {
  if (current !== requested) {
    throw new ConflictError(`TJX quote ${id} changed since you loaded it.`)
  }
}

async function assertReady(detail: TjxQuoteDetail, legacyId: number | null): Promise<void> {
  if (!detail.siteId) throw new ValidationError('Choose a site before submitting the quote.')
  if (!detail.ceilingGridType || !isTjxGridType(detail.ceilingGridType)) {
    throw new ValidationError('Choose a ceiling grid type before submitting the quote.')
  }
  if (!detail.paymentTermsCode || !isTjxPaymentTerms(detail.paymentTermsCode)) {
    throw new ValidationError('Choose payment terms before submitting the quote.')
  }
  if (!QUOTE_TYPES.has(detail.quoteType)) {
    throw new ValidationError('Choose a quote type before submitting the quote.')
  }

  const fixtureParts = detail.rooms.flatMap((room) =>
    room.fixtures.flatMap((fixture) => fixture.parts),
  )
  if (fixtureParts.length === 0 && detail.specialParts.length === 0) {
    throw new ValidationError(
      'Add at least one fixture or special part before submitting the quote.',
    )
  }

  const priced = new Set(detail.prices.map((price) => price.partNo))
  const missing = fixtureParts
    .map((part) => part.partNo)
    .filter((partNo, index, all) => all.indexOf(partNo) === index && !priced.has(partNo))
  if (missing.length) {
    throw new ValidationError(`Price these parts before submitting: ${missing.join(', ')}.`)
  }

  if (legacyId !== null) return
  const prices = Object.fromEntries(detail.prices.map((price) => [price.partNo, price.price]))
  let recalculated
  try {
    recalculated = calculateTjxQuote({
      taxRate: detail.appliedTaxRate ?? '0.13',
      fixtures: detail.rooms.flatMap((room) =>
        room.fixtures.map((fixture) => ({
          quantity: fixture.quantity,
          parts: fixture.parts.map((part) => ({
            partNo: part.partNo,
            markup: part.markup,
            ratioPerFixture: part.ratioPerFixture,
          })),
        })),
      ),
      specialParts: detail.specialParts.map((part) => ({
        name: part.name,
        quantity: part.quantity,
        unitPrice: part.unitPrice,
      })),
      prices,
    })
  } catch (error) {
    if (error instanceof PricingError) throw new ValidationError(error.message)
    throw error
  }

  const matches =
    recalculated.subtotal === detail.subtotal &&
    recalculated.tax === detail.tax &&
    recalculated.total === detail.total &&
    recalculated.withoutMarkupSubtotal === detail.withoutMarkupSubtotal &&
    recalculated.withoutMarkupTax === detail.withoutMarkupTax &&
    recalculated.withoutMarkupTotal === detail.withoutMarkupTotal
  if (!matches) {
    throw new ValidationError('The quote totals are stale. Save the quote again before submitting.')
  }
}

async function writeLifecycleRevision(
  tx: Tx,
  session: AuthSessionView,
  quoteId: number,
  revisionType: 'update' | 'submit' | 'approve' | 'cancel',
  notes: string | null,
): Promise<void> {
  const [quote] = await tx.select().from(tjxQuotes).where(eq(tjxQuotes.id, quoteId)).limit(1)
  if (!quote) throw new NotFoundError('TJX quote')
  const detail = await getQuoteDetail(tx, quoteId)
  await tx.insert(tjxQuoteRevisions).values({
    quoteId,
    saveSeq: await nextSaveSeq(tx, quoteId),
    revisionNo: quote.revisionNo,
    revisionType,
    revisedBy: session.user.id,
    dataQuote: revisionQuoteData(quote),
    dataRooms: detail.rooms as unknown as Record<string, unknown>[],
    dataFixtures: detail.rooms.flatMap((room) =>
      room.fixtures.map((fixture) => ({
        roomName: room.roomName,
        fixtureName: fixture.fixtureName,
        quantity: fixture.quantity,
        parts: fixture.parts,
      })),
    ) as unknown as Record<string, unknown>[],
    dataParts: detail.parts as unknown as Record<string, unknown>[],
    dataSpecialParts: detail.specialParts as unknown as Record<string, unknown>[],
    notes,
  })
}

async function applyStatus(
  tx: Tx,
  session: AuthSessionView,
  input: { id: number; version: number },
  change: {
    status: 1 | 3 | 4 | 5
    revisionType: 'update' | 'submit' | 'approve' | 'cancel'
    timestamp: Partial<{
      submittedAt: Date | null
      approvedAt: Date | null
      cancelledAt: Date | null
    }>
    summary: string
    action: string
    notes: string | null
  },
): Promise<TjxQuoteDetail> {
  const [updated] = await tx
    .update(tjxQuotes)
    .set({
      status: change.status,
      version: input.version + 1,
      updatedBy: session.user.id,
      updatedAt: new Date(),
      ...change.timestamp,
    })
    .where(and(eq(tjxQuotes.id, input.id), eq(tjxQuotes.version, input.version)))
    .returning()
  if (!updated) throw new ConflictError(`TJX quote ${input.id} changed since you loaded it.`)

  await writeLifecycleRevision(tx, session, input.id, change.revisionType, change.notes)
  await auditTjx(tx, session, change.action, 'tjx_quote', input.id, {
    summary: change.summary,
    after: updated as unknown as Record<string, unknown>,
  })
  return getQuoteDetail(tx, input.id)
}

async function assertNoActiveWorkOrder(tx: Tx, quoteId: number): Promise<void> {
  const [linked] = await tx
    .select({ id: workOrders.id })
    .from(tjxQuoteWorkOrders)
    .innerJoin(workOrders, eq(tjxQuoteWorkOrders.workOrderId, workOrders.id))
    .where(and(eq(tjxQuoteWorkOrders.quoteId, quoteId), ne(workOrders.status, 6)))
    .limit(1)
  if (linked) {
    throw new ValidationError(
      `Cancel work order ${linked.id} before cancelling this quote.`,
    )
  }
}

export async function submitQuoteCore(
  tx: Tx,
  input: { id: number; version: number },
  session: AuthSessionView,
): Promise<TjxQuoteDetail> {
  assertTjxWrite(session)
  const row = await loadRow(tx, input.id)
  assertVersion(row.version, input.version, input.id)
  if (row.status !== 1) {
    throw new ValidationError('Only an in-progress quote can be submitted.')
  }
  const detail = await getQuoteDetail(tx, input.id)
  await assertReady(detail, row.legacyId)

  return applyStatus(tx, session, input, {
    status: 3,
    revisionType: 'submit',
    timestamp: { submittedAt: new Date() },
    summary: `Submitted TJX quote ${input.id} for approval.`,
    action: 'tjx.quote.submit',
    notes: null,
  })
}

export async function returnQuoteCore(
  tx: Tx,
  input: { id: number; version: number },
  session: AuthSessionView,
): Promise<TjxQuoteDetail> {
  assertTjxWrite(session)
  const row = await loadRow(tx, input.id)
  assertVersion(row.version, input.version, input.id)
  if (row.status !== 3) {
    throw new ValidationError('Only a quote waiting for approval can be returned to draft.')
  }

  return applyStatus(tx, session, input, {
    status: 1,
    revisionType: 'update',
    timestamp: { submittedAt: null },
    summary: `Returned TJX quote ${input.id} to draft.`,
    action: 'tjx.quote.return',
    notes: null,
  })
}

export async function approveQuoteCore(
  tx: Tx,
  input: { id: number; version: number },
  session: AuthSessionView,
): Promise<TjxQuoteDetail> {
  assertApprove(session)
  const row = await loadRow(tx, input.id)
  assertVersion(row.version, input.version, input.id)
  if (row.status !== 3) {
    throw new ValidationError('Only a quote waiting for approval can be approved.')
  }
  const detail = await getQuoteDetail(tx, input.id)
  await assertReady(detail, row.legacyId)

  return applyStatus(tx, session, input, {
    status: 4,
    revisionType: 'approve',
    timestamp: { approvedAt: new Date() },
    summary: `Approved TJX quote ${input.id}.`,
    action: 'tjx.quote.approve',
    notes: null,
  })
}

export async function cancelQuoteCore(
  tx: Tx,
  input: { id: number; version: number },
  session: AuthSessionView,
): Promise<TjxQuoteDetail> {
  const row = await loadRow(tx, input.id)
  if (!canCancelQuote(row.status)) {
    throw new ValidationError('This quote cannot be cancelled.')
  }
  if (row.status === 4) {
    assertApprove(session)
  } else {
    assertTjxWrite(session)
  }
  assertVersion(row.version, input.version, input.id)
  await assertNoActiveWorkOrder(tx, input.id)

  return applyStatus(tx, session, input, {
    status: 5,
    revisionType: 'cancel',
    timestamp: { cancelledAt: new Date() },
    summary: `Cancelled TJX quote ${input.id}.`,
    action: 'tjx.quote.cancel',
    notes: null,
  })
}

export async function saveRevisionCore(
  tx: Tx,
  input: { id: number; version: number; notes: string | null },
  session: AuthSessionView,
): Promise<TjxQuoteDetail> {
  assertTjxWrite(session)
  const row = await loadRow(tx, input.id)
  assertVersion(row.version, input.version, input.id)
  if (!canEditQuote(row.status)) {
    throw new ValidationError('Only an in-progress or waiting-for-approval quote can be revised.')
  }

  const [updated] = await tx
    .update(tjxQuotes)
    .set({
      revisionNo: row.revisionNo + 1,
      revisionNotes: input.notes ?? row.revisionNotes,
      version: row.version + 1,
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(and(eq(tjxQuotes.id, input.id), eq(tjxQuotes.version, input.version)))
    .returning()
  if (!updated) throw new ConflictError(`TJX quote ${input.id} changed since you loaded it.`)

  await writeLifecycleRevision(tx, session, input.id, 'update', input.notes)
  await auditTjx(tx, session, 'tjx.quote.revision', 'tjx_quote', input.id, {
    summary: `Saved TJX quote ${input.id} as revision ${updated.revisionNo}.`,
    after: updated as unknown as Record<string, unknown>,
  })
  return getQuoteDetail(tx, input.id)
}
