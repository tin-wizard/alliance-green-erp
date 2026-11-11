/**
 * Status transitions.
 *
 * SERVER ONLY. The allowed graph is a pure rule in `lib/status.ts`; this file
 * only loads the record, checks scope and permission, applies preconditions
 * (subcontractor assignment, WSIB), and writes the note, audit row, revision and
 * notification in one transaction.
 */
import { and, eq } from 'drizzle-orm'
import { ConflictError, ForbiddenError, ValidationError } from '@cls/core'
import { getDb, type Db, type Tx } from '@cls/db'
import { workOrderAssignments, workOrderNotes, workOrders } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type { WorkOrderStatusCode, WorkOrderTransitionInput } from '../types'
import {
  allowedNextStatuses,
  canTransition,
  statusDefinition,
  statusLabel,
  transitionPermission,
} from '../lib/status'
import { evaluateWsibGate } from '../lib/rules'
import { getSubcontractorWsibState } from '../lib/lookups'
import { hasScopedGrant, loadAccessibleWorkOrder } from './access.server'
import { auditWorkOrder, captureRevision } from './records.server'
import { queueDispatchNotification, queueNotification, renderTemplate } from './notifications.server'

export interface TransitionResult {
  id: number
  status: WorkOrderStatusCode
  version: number
}

function illegalTransition(from: WorkOrderStatusCode, to: WorkOrderStatusCode): ValidationError {
  const allowed = allowedNextStatuses(from)
  const allowedText =
    allowed.length === 0
      ? 'This status is terminal.'
      : `Allowed next: ${allowed.map((code) => statusLabel(code)).join(', ')}.`
  return new ValidationError(
    `Illegal status change: ${statusLabel(from)} → ${statusLabel(to)}. ${allowedText}`,
  )
}

export async function transitionWorkOrderCore(
  tx: Tx,
  input: WorkOrderTransitionInput,
  session: AuthSessionView,
): Promise<TransitionResult> {
  const permission = transitionPermission(input.to)
  if (!session.user.grants.some((grant) => grant.key === permission)) {
    throw new ForbiddenError(permission)
  }

  const before = await loadAccessibleWorkOrder(session, input.id, tx)
  if (before.version !== input.version) {
    throw new ConflictError('This work order changed since you loaded it.')
  }
  const from = before.status as WorkOrderStatusCode
  if (!canTransition(from, input.to)) throw illegalTransition(from, input.to)

  let subcontractorId = before.subcontractorId
  if (input.to === 7) {
    const requested = input.subcontractorId ?? before.subcontractorId
    if (!requested) {
      throw new ValidationError(
        'Assign a subcontractor before dispatching this work order.',
      )
    }
    if (requested !== before.subcontractorId) {
      const state = await getSubcontractorWsibState(requested, tx)
      const gate = evaluateWsibGate({
        subcontractorId: requested,
        wsibValid: state.valid,
        overrideRequested: Boolean(input.wsibOverride),
        hasOverridePermission: hasScopedGrant(
          session,
          'workorder:override_wsib_hold',
          requested,
        ),
      })
      if (!gate.allowed) throw new ValidationError(gate.reason ?? 'WSIB check failed.')
    }
    subcontractorId = requested
  }

  const now = new Date()
  const patch: Record<string, unknown> = {
    status: input.to,
    subcontractorId,
    version: before.version + 1,
    updatedBy: session.user.id,
    updatedAt: now,
  }
  if (input.to === 7) patch.expectedCompletion = before.expectedCompletion
  if (input.to === 2) patch.completedAt = now
  if (input.to === 6) patch.cancelledAt = now
  if (input.to === 11) patch.invoicedAt = now

  const [after] = await tx
    .update(workOrders)
    .set(patch)
    .where(and(eq(workOrders.id, input.id), eq(workOrders.version, input.version)))
    .returning()
  if (!after) throw new ConflictError('This work order changed since you loaded it.')

  if (input.to === 7 && subcontractorId !== before.subcontractorId && subcontractorId) {
    await tx
      .delete(workOrderAssignments)
      .where(
        and(
          eq(workOrderAssignments.workOrderId, input.id),
          eq(workOrderAssignments.role, 'subcontractor'),
        ),
      )
    await tx.insert(workOrderAssignments).values({
      workOrderId: input.id,
      subcontractorId,
      role: 'subcontractor',
      assignedBy: session.user.id,
    })
  }

  await tx.insert(workOrderNotes).values({
    workOrderId: input.id,
    userId: session.user.id,
    title: `Status: ${statusDefinition(input.to).legacyLabel}`,
    notes: input.note ?? null,
    notesType: 'status',
    previousStatus: from,
    statusId: input.to,
    createdAt: now,
  })

  if (input.to === 7) {
    await queueDispatchNotification(tx, input.id)
  } else if (input.to === 2) {
    await queueNotification(tx, {
      workOrderId: input.id,
      event: 'completed',
      recipient: null,
      template: renderTemplate('completed', {
        workOrderId: input.id,
        siteName: null,
        expectedCompletion: after.expectedCompletion,
        serviceRequired: after.serviceRequired,
      }),
    })
  }

  const revisionType =
    input.to === 7
      ? 'dispatch'
      : input.to === 2
        ? 'complete'
        : input.to === 6
          ? 'cancel'
          : 'update'

  await auditWorkOrder(tx, session, 'workorder.transition', input.id, {
    summary: `Status ${statusLabel(from)} → ${statusLabel(input.to)}.`,
    before: { status: from, version: before.version },
    after: { status: input.to, version: after.version },
  })
  await captureRevision(tx, input.id, revisionType, session.user.id)

  return { id: after.id, status: input.to, version: after.version }
}

export async function transitionWorkOrder(
  input: WorkOrderTransitionInput,
  session: AuthSessionView,
  executor?: Db,
): Promise<TransitionResult> {
  const db = executor ?? getDb()
  return db.transaction((tx) => transitionWorkOrderCore(tx, input, session))
}
