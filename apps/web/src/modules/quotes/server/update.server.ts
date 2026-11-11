/**
 * Edit a quote header and its lines.
 *
 * SERVER ONLY. Only an in-progress/saved chain end may be edited; an issued
 * quote changes through a revision row. The version guard turns a stale editor
 * into a 409 instead of overwriting another operator.
 */
import { and, eq } from 'drizzle-orm'
import { ConflictError, ValidationError } from '@cls/core'
import { getDb, type Db, type Tx } from '@cls/db'
import { quotes } from '@cls/db/schema'
import { calculateQuoteTotals } from '@cls/pricing'
import type { AuthSessionView } from '../../../server/auth.types'
import type { QuoteUpdateInput } from '../types'
import { getSite } from '../../work-orders/lib/lookups'
import { assertQuoteWrite, loadQuoteRow } from './access.server'
import { auditQuote, replaceLines } from './records.server'

export async function updateQuoteCore(
  tx: Tx,
  input: QuoteUpdateInput,
  session: AuthSessionView,
): Promise<{ id: number; version: number }> {
  assertQuoteWrite(session)
  const before = await loadQuoteRow(session, input.id, tx)
  if (before.status !== 1 && before.status !== 2) {
    throw new ValidationError('Only an in-progress or saved quote can be edited. Issue a revision instead.')
  }
  if (!before.isLastRevision) {
    throw new ValidationError('This quote has been superseded by a revision.')
  }
  if (before.version !== input.version) {
    throw new ConflictError(`Quote ${input.id} changed since you loaded it.`)
  }

  const site = await getSite(input.siteId, tx)
  if (!site) throw new ValidationError('Choose a valid site for this quote.')

  const taxCode = (input.taxCode || site.province || 'ON').toUpperCase()
  calculateQuoteTotals({
    taxProvince: taxCode,
    appliedTaxRate: input.appliedTaxRate,
    manualTaxAmount: input.manualTaxAmount,
    labour: input.hours.map((line) => ({
      hours: line.hours ?? '0',
      numTechs: line.numTechs ?? 1,
      rate: line.rate ?? '0',
      incurredHours: line.incurredHours,
      incurredRate: line.incurredRate,
    })),
    parts: input.parts.map((line) => ({
      qty: line.qty,
      price: line.price,
      costPrice: line.costPrice,
    })),
    specialParts: input.specialParts.map((line) => ({
      name: line.name,
      qty: line.qty,
      price: line.price,
      costPrice: line.costPrice,
    })),
  })

  const [row] = await tx
    .update(quotes)
    .set({
      siteId: input.siteId,
      shipContact: input.shipContact || null,
      shipStreet1: input.shipStreet1 || site.street || null,
      shipStreet2: input.shipStreet2 || null,
      shipCity: input.shipCity || site.city || null,
      shipProvince: input.shipProvince || site.province || null,
      shipPostalCode: input.shipPostalCode || site.postalCode || null,
      report: input.report ?? '',
      notes: input.notes ?? '',
      pdfNotes: input.pdfNotes ?? null,
      paymentTermsId: input.paymentTermsId ?? null,
      taxCode,
      appliedTaxRate: input.appliedTaxRate || null,
      manualTaxAmount: input.manualTaxAmount || null,
      dueDate: input.isDueDateTbd ? null : (input.dueDate ?? null),
      isDueDateTbd: Boolean(input.isDueDateTbd),
      referenceWoNumber: input.referenceWoNumber ?? before.referenceWoNumber,
      version: before.version + 1,
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(and(eq(quotes.id, input.id), eq(quotes.version, input.version)))
    .returning()

  if (!row) throw new ConflictError(`Quote ${input.id} changed since you loaded it.`)

  await replaceLines(tx, input.id, input)

  await auditQuote(tx, session, 'quote.update', input.id, {
    summary: `Updated quote ${input.id}.`,
    before: before as unknown as Record<string, unknown>,
    after: row as unknown as Record<string, unknown>,
  })

  return { id: row.id, version: row.version }
}

export async function updateQuote(
  input: QuoteUpdateInput,
  session: AuthSessionView,
  executor?: Db,
): Promise<{ id: number; version: number }> {
  const db = executor ?? getDb()
  return db.transaction((tx) => updateQuoteCore(tx, input, session))
}
