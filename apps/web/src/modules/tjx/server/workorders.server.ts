/**
 * TJX work-order links.
 *
 * SERVER ONLY. A conversion goes through Work Orders' `createWorkOrderCore`;
 * TJX never inserts `work_orders` directly. Extra work orders are links only.
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import { ConflictError, NotFoundError, ValidationError } from '@cls/core'
import type { Executor, Tx } from '@cls/db'
import { tjxQuoteWorkOrders, tjxQuotes, workOrders } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import { assertPermission } from '../../../server/middleware'
import type { TjxQuoteDetail } from '../types'
import { createWorkOrderCore } from '../../work-orders/server/create.server'
import type { LookupOption } from '../../work-orders/types'
import {
  listCategories,
  listPriorities,
  listServiceTypes,
} from '../../work-orders/lib/lookups'
import { assertTjxWrite, auditTjx } from './access.server'
import { getQuoteDetail } from './quotes.server'

export const TJX_SERIES = 1 as const

async function loadApproved(tx: Tx, quoteId: number) {
  const [row] = await tx.select().from(tjxQuotes).where(eq(tjxQuotes.id, quoteId)).limit(1)
  if (!row) throw new NotFoundError('TJX quote')
  if (row.status !== 4) {
    throw new ValidationError('Only an approved TJX quote can create or link work orders.')
  }
  return row
}

function assertVersion(current: number, requested: number, quoteId: number): void {
  if (current !== requested) {
    throw new ConflictError(`TJX quote ${quoteId} changed since you loaded it.`)
  }
}

export async function convertQuoteCore(
  tx: Tx,
  input: {
    quoteId: number
    version: number
    serviceTypeId: number
    priorityId: number
    categoryId: number | null
    serviceRequired: string
  },
  session: AuthSessionView,
): Promise<{
  workOrderId: number
  created: boolean
  warnings: string[]
  quote: TjxQuoteDetail
}> {
  assertTjxWrite(session)
  assertPermission(session, 'workorder:create')
  const quote = await loadApproved(tx, input.quoteId)
  assertVersion(quote.version, input.version, input.quoteId)
  if (!quote.siteId) {
    throw new ValidationError('Choose a site for the quote before creating a work order.')
  }

  const [primary] = await tx
    .select({ workOrderId: tjxQuoteWorkOrders.workOrderId })
    .from(tjxQuoteWorkOrders)
    .where(
      and(
        eq(tjxQuoteWorkOrders.quoteId, input.quoteId),
        eq(tjxQuoteWorkOrders.isPrimary, true),
      ),
    )
    .limit(1)
  if (primary) {
    return {
      workOrderId: primary.workOrderId,
      created: false,
      warnings: [],
      quote: await getQuoteDetail(tx, input.quoteId),
    }
  }

  const result = await createWorkOrderCore(
    tx,
    {
      series: TJX_SERIES,
      siteId: quote.siteId,
      serviceTypeId: input.serviceTypeId,
      priorityId: input.priorityId,
      categoryId: input.categoryId,
      serviceRequired: input.serviceRequired,
      notes: quote.notes,
      isProject: true,
      isTjxQuote: true,
    },
    session,
  )

  await tx.insert(tjxQuoteWorkOrders).values({
    quoteId: input.quoteId,
    workOrderId: result.id,
    isPrimary: true,
    sortOrder: 0,
    linkedBy: session.user.id,
  })
  await auditTjx(tx, session, 'tjx.quote.convert', 'tjx_quote', input.quoteId, {
    summary: `Converted TJX quote ${input.quoteId} to work order ${result.id}.`,
    after: { workOrderId: result.id },
  })

  return {
    workOrderId: result.id,
    created: true,
    warnings: result.warnings,
    quote: await getQuoteDetail(tx, input.quoteId),
  }
}

export async function linkWorkOrderCore(
  tx: Tx,
  input: { quoteId: number; version: number; workOrderId: number },
  session: AuthSessionView,
): Promise<TjxQuoteDetail> {
  assertTjxWrite(session)
  assertPermission(session, 'workorder:read')
  const quote = await loadApproved(tx, input.quoteId)
  assertVersion(quote.version, input.version, input.quoteId)

  const [workOrder] = await tx
    .select({ id: workOrders.id })
    .from(workOrders)
    .where(eq(workOrders.id, input.workOrderId))
    .limit(1)
  if (!workOrder) throw new ValidationError(`Work order ${input.workOrderId} does not exist.`)

  const [existing] = await tx
    .select({ id: tjxQuoteWorkOrders.id })
    .from(tjxQuoteWorkOrders)
    .where(
      and(
        eq(tjxQuoteWorkOrders.quoteId, input.quoteId),
        eq(tjxQuoteWorkOrders.workOrderId, input.workOrderId),
      ),
    )
    .limit(1)
  if (!existing) {
    const [next] = await tx
      .select({ sortOrder: sql<number>`coalesce(max(${tjxQuoteWorkOrders.sortOrder}), -1)::int` })
      .from(tjxQuoteWorkOrders)
      .where(eq(tjxQuoteWorkOrders.quoteId, input.quoteId))
    await tx.insert(tjxQuoteWorkOrders).values({
      quoteId: input.quoteId,
      workOrderId: input.workOrderId,
      isPrimary: false,
      sortOrder: (next?.sortOrder ?? -1) + 1,
      linkedBy: session.user.id,
    })
  }

  const [updated] = await tx
    .update(tjxQuotes)
    .set({ version: input.version + 1, updatedBy: session.user.id, updatedAt: new Date() })
    .where(and(eq(tjxQuotes.id, input.quoteId), eq(tjxQuotes.version, input.version)))
    .returning({ id: tjxQuotes.id })
  if (!updated) throw new ConflictError(`TJX quote ${input.quoteId} changed since you loaded it.`)

  await auditTjx(tx, session, 'tjx.quote.work_order_linked', 'tjx_quote', input.quoteId, {
    summary: `Linked work order ${input.workOrderId} to TJX quote ${input.quoteId}.`,
    after: { workOrderId: input.workOrderId },
  })
  return getQuoteDetail(tx, input.quoteId)
}

export async function unlinkWorkOrderCore(
  tx: Tx,
  input: { quoteId: number; version: number; workOrderId: number },
  session: AuthSessionView,
): Promise<TjxQuoteDetail> {
  assertTjxWrite(session)
  assertPermission(session, 'workorder:read')
  const quote = await loadApproved(tx, input.quoteId)
  assertVersion(quote.version, input.version, input.quoteId)

  const [link] = await tx
    .select({ id: tjxQuoteWorkOrders.id, isPrimary: tjxQuoteWorkOrders.isPrimary })
    .from(tjxQuoteWorkOrders)
    .where(
      and(
        eq(tjxQuoteWorkOrders.quoteId, input.quoteId),
        eq(tjxQuoteWorkOrders.workOrderId, input.workOrderId),
      ),
    )
    .limit(1)
  if (!link) throw new ValidationError('That work order is not linked to this quote.')
  if (link.isPrimary) {
    throw new ValidationError('The primary work order cannot be unlinked.')
  }

  await tx.delete(tjxQuoteWorkOrders).where(eq(tjxQuoteWorkOrders.id, link.id))
  const [updated] = await tx
    .update(tjxQuotes)
    .set({ version: input.version + 1, updatedBy: session.user.id, updatedAt: new Date() })
    .where(and(eq(tjxQuotes.id, input.quoteId), eq(tjxQuotes.version, input.version)))
    .returning({ id: tjxQuotes.id })
  if (!updated) throw new ConflictError(`TJX quote ${input.quoteId} changed since you loaded it.`)

  await auditTjx(tx, session, 'tjx.quote.work_order_unlinked', 'tjx_quote', input.quoteId, {
    summary: `Unlinked work order ${input.workOrderId} from TJX quote ${input.quoteId}.`,
    before: { workOrderId: input.workOrderId },
  })
  return getQuoteDetail(tx, input.quoteId)
}

export async function listWorkOrderLookups(executor: Executor): Promise<{
  serviceTypes: LookupOption[]
  priorities: LookupOption[]
  categories: LookupOption[]
}> {
  const [serviceTypes, priorities, categories] = await Promise.all([
    listServiceTypes(executor),
    listPriorities(executor),
    listCategories(executor),
  ])
  return { serviceTypes, priorities, categories }
}

export async function listQuoteWorkOrderIds(
  tx: Tx,
  quoteId: number,
): Promise<number[]> {
  const rows = await tx
    .select({ id: tjxQuoteWorkOrders.workOrderId })
    .from(tjxQuoteWorkOrders)
    .where(eq(tjxQuoteWorkOrders.quoteId, quoteId))
    .orderBy(asc(tjxQuoteWorkOrders.sortOrder))
  return rows.map((row) => row.id)
}
