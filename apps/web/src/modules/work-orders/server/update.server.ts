/**
 * Edit a work order header.
 *
 * SERVER ONLY. The update is conditional on the version the caller loaded, so a
 * stale edit returns 409 instead of overwriting someone else's change.
 */
import { and, eq } from 'drizzle-orm'
import { ConflictError, ValidationError } from '@cls/core'
import { getDb, type Db, type Tx } from '@cls/db'
import { workOrderAssignments, workOrders } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type { WorkOrderUpdateInput } from '../types'
import { evaluateWsibGate } from '../lib/rules'
import { getSite, getSubcontractorWsibState } from '../lib/lookups'
import { hasScopedGrant, loadAccessibleWorkOrder } from './access.server'
import { auditWorkOrder, captureRevision } from './records.server'

export interface UpdateResult {
  id: number
  version: number
}

export async function updateWorkOrderCore(
  tx: Tx,
  input: WorkOrderUpdateInput,
  session: AuthSessionView,
): Promise<UpdateResult> {
  const before = await loadAccessibleWorkOrder(session, input.id, tx)
  if (before.version !== input.version) {
    throw new ConflictError('This work order changed since you loaded it.')
  }

  const changes: Record<string, unknown> = {}
  const assign = <K extends keyof WorkOrderUpdateInput>(key: K, column: string) => {
    const value = input[key]
    if (value !== undefined) changes[column] = value
  }

  if (input.siteId !== undefined) {
    const site = await getSite(input.siteId, tx)
    if (!site) throw new ValidationError('Choose a valid site for this work order.')
    changes.siteId = input.siteId
  }

  assign('serviceTypeId', 'serviceTypeId')
  assign('priorityId', 'priorityId')
  assign('categoryId', 'categoryId')
  assign('expectedCompletion', 'expectedCompletion')
  assign('serviceRequired', 'serviceRequired')
  assign('notes', 'notes')
  assign('securityCode', 'securityCode')
  assign('customerPo', 'customerPo')
  assign('isLocal', 'isLocal')
  assign('isProject', 'isProject')
  assign('isTjxQuote', 'isTjxQuote')
  assign('isPmaOrder', 'isPmaOrder')
  assign('dateTaken', 'dateTaken')

  let wsibOverrideUsed = false
  if (input.subcontractorId !== undefined && input.subcontractorId !== before.subcontractorId) {
    changes.subcontractorId = input.subcontractorId
    if (input.subcontractorId) {
      const state = await getSubcontractorWsibState(input.subcontractorId, tx)
      const gate = evaluateWsibGate({
        subcontractorId: input.subcontractorId,
        wsibValid: state.valid,
        overrideRequested: Boolean(input.wsibOverride),
        hasOverridePermission: hasScopedGrant(
          session,
          'workorder:override_wsib_hold',
          input.subcontractorId,
        ),
      })
      if (!gate.allowed) throw new ValidationError(gate.reason ?? 'WSIB check failed.')
      wsibOverrideUsed = gate.overrideUsed
    }
  }

  if (Object.keys(changes).length === 0) {
    return { id: before.id, version: before.version }
  }

  const [after] = await tx
    .update(workOrders)
    .set({
      ...changes,
      version: before.version + 1,
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(and(eq(workOrders.id, input.id), eq(workOrders.version, input.version)))
    .returning()

  if (!after) throw new ConflictError('This work order changed since you loaded it.')

  if (input.subcontractorId !== undefined && input.subcontractorId !== before.subcontractorId) {
    await tx
      .delete(workOrderAssignments)
      .where(
        and(
          eq(workOrderAssignments.workOrderId, input.id),
          eq(workOrderAssignments.role, 'subcontractor'),
        ),
      )
    if (input.subcontractorId) {
      await tx.insert(workOrderAssignments).values({
        workOrderId: input.id,
        subcontractorId: input.subcontractorId,
        role: 'subcontractor',
        assignedBy: session.user.id,
      })
    }
  }

  await auditWorkOrder(tx, session, 'workorder.update', input.id, {
    summary: wsibOverrideUsed
      ? 'Work order updated; subcontractor assigned with a WSIB/insurance override.'
      : 'Work order updated.',
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
  })
  await captureRevision(tx, input.id, 'update', session.user.id)

  return { id: after.id, version: after.version }
}

export async function updateWorkOrder(
  input: WorkOrderUpdateInput,
  session: AuthSessionView,
  executor?: Db,
): Promise<UpdateResult> {
  const db = executor ?? getDb()
  return db.transaction((tx) => updateWorkOrderCore(tx, input, session))
}
