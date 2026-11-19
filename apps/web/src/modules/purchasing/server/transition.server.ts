/**
 * Purchase-order lifecycle transitions.
 *
 * SERVER ONLY. Every edge is checked against the transition table, the caller's
 * permission, the version and the row state. Approval records the approving
 * user, timestamp, PO version and whether it was their own PO. Editing after
 * approval is handled by `update.server.ts`, which resets to 3.
 */
import { and, eq } from 'drizzle-orm'
import { ConflictError, ValidationError } from '@cls/core'
import type { Db, Tx } from '@cls/db'
import { purchaseOrderApprovals, purchaseOrders } from '@cls/db/schema'
import { assertPermission } from '../../../server/middleware'
import type { AuthSessionView } from '../../../server/auth.types'
import type { PurchaseOrderStatus, PurchaseOrderTransitionInput } from '../types'
import { isTerminalStatus, loadPurchaseOrder, loadSupplier } from './access.server'
import {
  canTransitionPurchaseOrder,
  illegalTransitionMessage,
  transitionPermission,
} from '../lib/status'
import { auditPurchaseOrder, recordStatus } from './records.server'

export interface TransitionResult {
  id: number
  status: PurchaseOrderStatus
  version: number
  selfApproved: boolean
}

export async function transitionPurchaseOrderCore(
  tx: Tx,
  input: PurchaseOrderTransitionInput,
  session: AuthSessionView,
): Promise<TransitionResult> {
  const current = await loadPurchaseOrder(session, input.id, tx, true)
  const from = current.status as PurchaseOrderStatus
  const to = input.to

  if (current.version !== input.version) {
    throw new ConflictError('This purchase order changed since it was loaded. Reload and retry.')
  }
  if (isTerminalStatus(from)) {
    throw new ValidationError(`Purchase order ${input.id} is ${from === 10 ? 'cancelled' : 'invoiced'} and cannot move again.`)
  }
  if (!canTransitionPurchaseOrder(from, to)) {
    throw new ValidationError(illegalTransitionMessage(from, to))
  }
  if ((to === 4 && from !== 5) || to === 5 || to === 11) {
    throw new ValidationError('Receipts and invoice close are recorded through their own actions.')
  }

  const permission = transitionPermission(from, to)
  assertPermission(session, permission)

  let selfApproved = false
  let approvalRequestBy = current.approvalRequestBy

  if (to === 8 || to === 9) {
    // Approval and challenge are both approver actions. Self-approval is legal
    // when the user holds both purchasing:write and po.approve: the control is
    // the explicit self_approved marker, not an identity rule.
    assertPermission(session, 'purchasing:write')
    selfApproved = current.approvalRequestBy === session.user.id
    if (to === 9 && !input.reason?.trim()) {
      throw new ValidationError('A challenge needs a reason.')
    }
  }

  if (to === 7) {
    approvalRequestBy = session.user.id
    await tx.insert(purchaseOrderApprovals).values({
      poId: current.id,
      decision: 'request',
      requestedBy: session.user.id,
      poVersion: current.version,
      selfApproved: false,
      reason: input.reason ?? null,
    })
  }
  if (to === 8 || to === 9) {
    await tx.insert(purchaseOrderApprovals).values({
      poId: current.id,
      decision: to === 8 ? 'approve' : 'challenge',
      requestedBy: current.approvalRequestBy,
      approvedBy: session.user.id,
      approvedAt: new Date(),
      poVersion: current.version,
      selfApproved,
      reason: input.reason ?? null,
    })
  }

  if (to === 2) {
    const supplier = await loadSupplier(tx, current.supplierId)
    const bypass = supplier.bypassPoApproval || current.isTransfer
    if (from !== 8 && !bypass) {
      throw new ValidationError('This purchase order must be approved before it can be issued.')
    }
  }

  if (to === 10 && (from === 5 || from === 4) && !input.reason?.trim()) {
    throw new ValidationError('Cancelling after a receipt needs a reason.')
  }
  if (to === 4 && from === 5 && !input.reason?.trim()) {
    throw new ValidationError('A short close needs a reason.')
  }

  const nextVersion = current.version + 1
  const now = new Date()
  const [row] = await tx
    .update(purchaseOrders)
    .set({
      status: to,
      version: nextVersion,
      updatedBy: session.user.id,
      updatedAt: now,
      approvalRequestBy: to === 7 ? approvalRequestBy : to === 3 ? null : current.approvalRequestBy,
      isApproved: to === 8,
      approvedBy: to === 8 ? session.user.id : to === 3 ? null : current.approvedBy,
      approvedAt: to === 8 ? now : to === 3 ? null : current.approvedAt,
      approvalRevision: to === 8 ? current.version : to === 3 ? null : current.approvalRevision,
      selfApproved: to === 8 ? selfApproved : to === 3 ? false : current.selfApproved,
      approvalRequestedAt: to === 7 ? now : current.approvalRequestedAt,
      poSubmittedBy: to === 2 ? session.user.id : current.poSubmittedBy,
      submittedAt: to === 2 ? now : current.submittedAt,
      cancelledAt: to === 10 ? now : current.cancelledAt,
      cancelledReason: to === 10 ? (input.reason ?? null) : current.cancelledReason,
      closedShort: to === 4 && from === 5 ? true : current.closedShort,
      shortCloseReason: to === 4 && from === 5 ? (input.reason ?? null) : current.shortCloseReason,
    })
    .where(and(eq(purchaseOrders.id, current.id), eq(purchaseOrders.version, input.version)))
    .returning()

  if (!row) throw new ConflictError('This purchase order changed since it was loaded. Reload and retry.')

  await recordStatus(tx, session, {
    poId: row.id,
    from,
    to,
    action: to === 8 ? 'approve' : to === 9 ? 'challenge' : to === 7 ? 'request_approval' : `status_${to}`,
    version: nextVersion,
    selfApproved,
    note: input.reason ?? null,
  })
  await auditPurchaseOrder(tx, session, `purchase_order.${to === 8 ? 'approve' : 'transition'}`, row.id, {
    summary: `Purchase order ${row.id}: ${from} → ${to}${selfApproved ? ' (self-approved)' : ''}.`,
    permission,
    before: { status: current.status, version: current.version, approvedBy: current.approvedBy },
    after: {
      status: to,
      version: nextVersion,
      approvedBy: to === 8 ? session.user.id : null,
      approvedAt: to === 8 ? now.toISOString() : null,
      approvalRevision: to === 8 ? current.version : null,
      selfApproved,
      reason: input.reason ?? null,
    },
  })

  return { id: row.id, status: to, version: nextVersion, selfApproved }
}

export async function transitionPurchaseOrder(
  input: PurchaseOrderTransitionInput,
  session: AuthSessionView,
  executor?: Db,
): Promise<TransitionResult> {
  const db = executor ?? (await import('@cls/db')).getDb()
  return db.transaction((tx) => transitionPurchaseOrderCore(tx, input, session))
}
