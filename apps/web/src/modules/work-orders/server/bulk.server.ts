/**
 * Triage flags and bulk actions.
 *
 * SERVER ONLY. Triage flags (red / green / critical) are independent of status.
 * A bulk action is applied per record inside its own transaction; records that
 * fail a precondition are rejected with a reason instead of failing the batch.
 */
import { and, eq } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import { getDb, type Db, type Tx } from '@cls/db'
import { workOrderAssignments, workOrders } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type {
  BulkUpdateInput,
  BulkUpdateResult,
  TriageFlag,
  TriageInput,
} from '../types'
import { evaluateWsibGate, triageColumns } from '../lib/rules'
import { getSubcontractorWsibState } from '../lib/lookups'
import { assertPermission, hasGrant, hasScopedGrant, loadAccessibleWorkOrder } from './access.server'
import { auditWorkOrder } from './records.server'
import { transitionWorkOrderCore } from './transition.server'
import { ALLOWED_TRANSITIONS, transitionPermission } from '../lib/status'

export async function setTriage(
  input: TriageInput,
  session: AuthSessionView,
  executor?: Db,
): Promise<{ id: number; version: number }> {
  assertPermission(session, 'workorder:write')
  const db = executor ?? getDb()
  return db.transaction(async (tx) => {
    const before = await loadAccessibleWorkOrder(session, input.id, tx)
    const columns = triageColumns(input.flags as TriageFlag[])
    const [after] = await tx
      .update(workOrders)
      .set({ ...columns, version: before.version + 1, updatedBy: session.user.id, updatedAt: new Date() })
      .where(and(eq(workOrders.id, input.id), eq(workOrders.version, input.version)))
      .returning()
    if (!after) throw new ValidationError('This work order changed since you loaded it.')
    await auditWorkOrder(tx, session, 'workorder.triage', input.id, {
      summary: `Triage flags: ${input.flags.length > 0 ? input.flags.join(', ') : 'cleared'}.`,
      before: {
        red: before.isMarkedRed,
        green: before.isMarkedGreen,
        critical: before.isMarkedCritical,
      },
      after: columns,
    })
    return { id: after.id, version: after.version }
  })
}

async function applyOne(
  tx: Tx,
  input: BulkUpdateInput,
  id: number,
  session: AuthSessionView,
): Promise<void> {
  if (input.change.kind === 'status') {
    const row = await loadAccessibleWorkOrder(session, id, tx)
    await transitionWorkOrderCore(
      tx,
      {
        id,
        version: row.version,
        to: input.change.to,
        note: input.change.note ?? 'Bulk status change.',
      },
      session,
    )
    return
  }

  assertPermission(session, 'workorder:write')
  const before = await loadAccessibleWorkOrder(session, id, tx)

  if (input.change.kind === 'priority') {
    const [after] = await tx
      .update(workOrders)
      .set({
        priorityId: input.change.priorityId,
        version: before.version + 1,
        updatedBy: session.user.id,
        updatedAt: new Date(),
      })
      .where(and(eq(workOrders.id, id), eq(workOrders.version, before.version)))
      .returning({ version: workOrders.version })
    if (!after) throw new ValidationError('This work order changed since you loaded it.')
    await auditWorkOrder(tx, session, 'workorder.bulk_priority', id, {
      summary: 'Priority changed by bulk action.',
      before: { priorityId: before.priorityId },
      after: { priorityId: input.change.priorityId },
    })
    return
  }

  const subcontractorId = input.change.subcontractorId
  if (subcontractorId) {
    const state = await getSubcontractorWsibState(subcontractorId, tx)
    const gate = evaluateWsibGate({
      subcontractorId,
      wsibValid: state.valid,
      overrideRequested: Boolean(input.change.wsibOverride),
      hasOverridePermission: hasScopedGrant(
        session,
        'workorder:override_wsib_hold',
        subcontractorId,
      ),
    })
    if (!gate.allowed) throw new ValidationError(gate.reason ?? 'WSIB check failed.')
  }

  const [after] = await tx
    .update(workOrders)
    .set({
      subcontractorId,
      version: before.version + 1,
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(and(eq(workOrders.id, id), eq(workOrders.version, before.version)))
    .returning({ version: workOrders.version })
  if (!after) throw new ValidationError('This work order changed since you loaded it.')
  await tx
    .delete(workOrderAssignments)
    .where(
      and(eq(workOrderAssignments.workOrderId, id), eq(workOrderAssignments.role, 'subcontractor')),
    )
  if (subcontractorId) {
    await tx.insert(workOrderAssignments).values({
      workOrderId: id,
      subcontractorId,
      role: 'subcontractor',
      assignedBy: session.user.id,
    })
  }
  await auditWorkOrder(tx, session, 'workorder.bulk_assignment', id, {
    summary: 'Subcontractor changed by bulk action.',
    before: { subcontractorId: before.subcontractorId },
    after: { subcontractorId },
  })
}

export async function bulkUpdate(
  input: BulkUpdateInput,
  session: AuthSessionView,
  executor?: Db,
): Promise<BulkUpdateResult> {
  const db = executor ?? getDb()
  const updated: number[] = []
  const rejected: Array<{ id: number; reason: string }> = []

  for (const id of [...new Set(input.ids)]) {
    try {
      await db.transaction((tx) => applyOne(tx, input, id, session))
      updated.push(id)
    } catch (error) {
      rejected.push({
        id,
        reason: error instanceof Error ? error.message : 'The change was rejected.',
      })
    }
  }

  return { updated, rejected }
}

export function canBulkChangeStatus(session: AuthSessionView): boolean {
  return Object.values(ALLOWED_TRANSITIONS)
    .flat()
    .some((to) => hasGrant(session, transitionPermission(to)))
}
