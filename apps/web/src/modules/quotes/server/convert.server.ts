/**
 * Approved quote → work order.
 *
 * SERVER ONLY. The work order is created through the Work Orders module's own
 * core, never by inserting into its table directly, so numbering, audit and the
 * first revision stay consistent. A customer quote already owns its work-order
 * number (H4); a standalone quote takes one from the same allocator now.
 */
import { and, eq } from 'drizzle-orm'
import { ForbiddenError, ValidationError } from '@cls/core'
import { getDb, type Db, type Tx } from '@cls/db'
import { quotes } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import { businessToday } from '../../work-orders/lib/rules'
import { listPriorities, listServiceTypes } from '../../work-orders/lib/lookups'
import { assertPermission } from '../../work-orders/server/access.server'
import { createWorkOrderCore } from '../../work-orders/server/create.server'
import type { WorkOrderCreateInput } from '../../work-orders/types'
import { assertQuoteApprove, loadQuoteRow } from './access.server'
import { auditQuote } from './records.server'

export async function convertQuoteCore(
  tx: Tx,
  id: number,
  session: AuthSessionView,
): Promise<{ quoteId: number; workOrderId: number; numberLabel: string }> {
  assertQuoteApprove(session)
  assertPermission(session, 'workorder:create')
  const quote = await loadQuoteRow(session, id, tx)

  if (quote.status !== 4) throw new ValidationError('Only an approved quote can become a work order.')
  if (!quote.isLastRevision) throw new ValidationError('Only the latest revision can be converted.')
  if (quote.isDeleted) throw new ValidationError('A deleted quote cannot be converted.')
  if (quote.convertedWorkOrderId) {
    throw new ValidationError(`Quote already created work order ${quote.convertedWorkOrderId}.`)
  }

  const [serviceTypes, priorities] = await Promise.all([
    listServiceTypes(tx),
    listPriorities(tx),
  ])
  const serviceType = serviceTypes[0]
  const priority = priorities[0]
  if (!serviceType || !priority) {
    throw new ValidationError('Master data needs at least one service type and priority.')
  }

  const workOrderInput: WorkOrderCreateInput = {
    series: 1,
    siteId: quote.siteId,
    serviceTypeId: serviceType.id,
    priorityId: priority.id,
    dateTaken: businessToday(),
    serviceRequired:
      (quote.report ?? '').trim() ||
      `Approved quote ${quote.workOrderNumber ?? quote.id} (${quote.kind}).`,
    notes: quote.notes ?? null,
    isLocal: quote.createdFromLocal,
  }

  const created = await createWorkOrderCore(
    tx,
    workOrderInput,
    session,
    quote.workOrderNumber ? { workOrderNumber: quote.workOrderNumber } : undefined,
  )

  const [updated] = await tx
    .update(quotes)
    .set({
      convertedWorkOrderId: created.id,
      workOrderNumber: created.id,
      version: quote.version + 1,
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(and(eq(quotes.id, id), eq(quotes.version, quote.version)))
    .returning()
  if (!updated) throw new ValidationError('The quote changed while it was being converted.')

  await auditQuote(tx, session, 'quote.convert', id, {
    summary: `Converted quote ${id} to work order ${created.id}.`,
    after: { workOrderId: created.id },
  })

  return {
    quoteId: id,
    workOrderId: created.id,
    numberLabel: String(created.id),
  }
}

export async function convertQuote(
  id: number,
  session: AuthSessionView,
  executor?: Db,
) {
  const db = executor ?? getDb()
  return db.transaction((tx) => convertQuoteCore(tx, id, session))
}

export { ForbiddenError }
