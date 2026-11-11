/**
 * Audit and revision helpers.
 *
 * SERVER ONLY. Both run inside the caller's transaction so the business change,
 * its audit row and its revision snapshot commit or roll back together
 * (MODULE-CONTRACT §1.3).
 */
import { eq } from 'drizzle-orm'
import { getDb } from '@cls/db'
import { writeAudit } from '@cls/auth'
import {
  localWorkOrderHours,
  workOrderHours,
  workOrderNotes,
  workOrderParts,
  workOrderReports,
  workOrderRevisions,
  workOrderSpecialParts,
  workOrderTax,
  workOrders,
} from '@cls/db/schema'
import type { Db, Executor, Tx } from '@cls/db'
import type { AuthSessionView } from '../../../server/auth.types'
import type { WorkOrderRevisionDetail } from '../types'
import { assertPermission, loadAccessibleWorkOrder } from './access.server'

export async function auditWorkOrder(
  executor: Executor,
  session: AuthSessionView,
  action: string,
  workOrderId: number,
  options: {
    summary?: string
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
    requestId?: string | null
  } = {},
): Promise<void> {
  await writeAudit(executor, {
    action,
    actorUserId: session.user.id,
    actorLabel: session.user.displayName,
    actorRole: session.user.role,
    entityType: 'work_order',
    entityId: String(workOrderId),
    summary: options.summary ?? null,
    before: options.before ?? null,
    after: options.after ?? null,
    requestId: options.requestId ?? null,
  })
}

/**
 * Full snapshot of the work order and every child row, with the
 * `is_last_revision` chain end moved to the new row (BUSINESS-RULES C7).
 */
export async function captureRevision(
  tx: Tx,
  workOrderId: number,
  revisionType:
    | 'create'
    | 'update'
    | 'dispatch'
    | 'capture'
    | 'complete'
    | 'cancel'
    | 'manual',
  actorUserId: string | null,
): Promise<number> {
  const [row] = await tx.select().from(workOrders).where(eq(workOrders.id, workOrderId))
  if (!row) throw new Error(`Work order ${workOrderId} disappeared during revision capture.`)

  const [hours, parts, specialParts, localHours, report, tax, notes] = await Promise.all([
    tx.select().from(workOrderHours).where(eq(workOrderHours.workOrderId, workOrderId)),
    tx.select().from(workOrderParts).where(eq(workOrderParts.workOrderId, workOrderId)),
    tx
      .select()
      .from(workOrderSpecialParts)
      .where(eq(workOrderSpecialParts.workOrderId, workOrderId)),
    tx
      .select()
      .from(localWorkOrderHours)
      .where(eq(localWorkOrderHours.workOrderId, workOrderId)),
    tx
      .select()
      .from(workOrderReports)
      .where(eq(workOrderReports.workOrderId, workOrderId))
      .limit(1),
    tx.select().from(workOrderTax).where(eq(workOrderTax.workOrderId, workOrderId)).limit(1),
    tx.select().from(workOrderNotes).where(eq(workOrderNotes.workOrderId, workOrderId)),
  ])

  await tx
    .update(workOrderRevisions)
    .set({ isLastRevision: false })
    .where(eq(workOrderRevisions.workOrderId, workOrderId))

  const [inserted] = await tx
    .insert(workOrderRevisions)
    .values({
      workOrderId,
      revisedByUserId: actorUserId,
      revisionType,
      dataWorkorder: row as unknown as Record<string, unknown>,
      dataWoHours: hours as unknown as unknown[],
      dataWoLocalHours: localHours as unknown as unknown[],
      dataWoParts: parts as unknown as unknown[],
      dataWoSoparts: specialParts as unknown as unknown[],
      dataWoReport: (report[0] ?? null) as unknown as Record<string, unknown> | null,
      dataWoTax: (tax[0] ?? null) as unknown as Record<string, unknown> | null,
      dataWoNotes: notes as unknown as unknown[],
      isLastRevision: true,
    })
    .returning({ revisionId: workOrderRevisions.revisionId })

  if (!inserted) throw new Error('Revision insert returned no row.')
  return inserted.revisionId
}

export async function saveManualRevision(
  input: { workOrderId: number },
  session: AuthSessionView,
  executor?: Db,
): Promise<{ revisionId: number }> {
  assertPermission(session, 'workorder:write')
  const db = executor ?? getDb()
  return db.transaction(async (tx) => {
    await loadAccessibleWorkOrder(session, input.workOrderId, tx)
    const revisionId = await captureRevision(tx, input.workOrderId, 'manual', session.user.id)
    await auditWorkOrder(tx, session, 'workorder.revision', input.workOrderId, {
      summary: `Revision ${revisionId} saved.`,
    })
    return { revisionId }
  })
}

export async function getRevision(
  workOrderId: number,
  revisionId: number,
  executor: Executor,
): Promise<WorkOrderRevisionDetail | null> {
  const [row] = await executor
    .select()
    .from(workOrderRevisions)
    .where(eq(workOrderRevisions.revisionId, revisionId))
  if (!row || row.workOrderId !== workOrderId) return null
  return {
    revisionId: row.revisionId,
    createdAt: row.createdAt.toISOString(),
    revisionType: row.revisionType,
    revisedByUserId: row.revisedByUserId,
    isLastRevision: row.isLastRevision,
    dataWorkorder: (row.dataWorkorder ?? null) as WorkOrderRevisionDetail['dataWorkorder'],
    dataWoHours: (row.dataWoHours as WorkOrderRevisionDetail['dataWoHours']) ?? null,
    dataWoLocalHours:
      (row.dataWoLocalHours as WorkOrderRevisionDetail['dataWoLocalHours']) ?? null,
    dataWoParts: (row.dataWoParts as WorkOrderRevisionDetail['dataWoParts']) ?? null,
    dataWoSoparts: (row.dataWoSoparts as WorkOrderRevisionDetail['dataWoSoparts']) ?? null,
    dataWoReport: (row.dataWoReport ?? null) as WorkOrderRevisionDetail['dataWoReport'],
    dataWoTax: (row.dataWoTax ?? null) as WorkOrderRevisionDetail['dataWoTax'],
    dataWoNotes: (row.dataWoNotes as WorkOrderRevisionDetail['dataWoNotes']) ?? null,
  }
}
