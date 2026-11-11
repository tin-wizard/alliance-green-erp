/**
 * RGA status transitions. Raw legacy codes are stored; the allowed edges come
 * from `lib/lifecycle` so the UI and the server cannot disagree.
 */
import { and, eq } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import type { Tx } from '@cls/db'
import { rgas, rgaStatusHistory } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import {
  allowedNextStatuses,
  canApprove,
  canCancel,
  isRgaStatus,
  isTerminal,
  statusLabel,
} from '../lib/lifecycle'
import { assertRgaApprove, loadRga } from './access.server'
import { auditRga, rgaSnapshot } from './records.server'

async function writeTransition(
  tx: Tx,
  input: {
    rgaId: number
    fromStatus: number
    toStatus: number
    action: string
    note?: string | null
    session: AuthSessionView
    version: number
  },
) {
  await tx.insert(rgaStatusHistory).values({
    rgaId: input.rgaId,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    action: input.action,
    actorId: input.session.user.id,
    actorLabel: input.session.user.email,
    note: input.note ?? null,
    rgaVersion: input.version,
  })
}

export async function approveRgaCore(
  tx: Tx,
  input: { rgaId: number; version: number; note?: string | null },
  session: AuthSessionView,
) {
  assertRgaApprove(session)
  const row = await loadRga(session, input.rgaId, tx)
  if (!canApprove(row.status)) {
    throw new ValidationError(
      `Only an active RGA can be approved. R-${row.id} is ${statusLabel(row.status)}.`,
    )
  }
  if (row.version !== input.version) {
    throw new ValidationError('This RGA changed since you loaded it. Reload and try again.')
  }

  const now = new Date()
  const [updated] = await tx
    .update(rgas)
    .set({
      status: 3,
      approvedBy: session.user.id,
      approvedAt: now,
      isSubmitted: true,
      version: row.version + 1,
      updatedAt: now,
    })
    .where(and(eq(rgas.id, row.id), eq(rgas.version, row.version)))
    .returning()
  if (!updated) {
    throw new ValidationError('This RGA changed since you loaded it. Reload and try again.')
  }

  await writeTransition(tx, {
    rgaId: row.id,
    fromStatus: 2,
    toStatus: 3,
    action: 'approved',
    note: input.note,
    session,
    version: updated.version,
  })
  await auditRga(tx, session, 'rga.approve', row.id, {
    summary: `Approved RGA R-${row.id}.`,
    before: rgaSnapshot(row),
    after: rgaSnapshot(updated),
  })
  return updated
}

export async function transitionRgaCore(
  tx: Tx,
  input: {
    rgaId: number
    version: number
    toStatus: number
    note?: string | null
  },
  session: AuthSessionView,
) {
  assertRgaApprove(session)
  const row = await loadRga(session, input.rgaId, tx)
  if (!isRgaStatus(input.toStatus)) {
    throw new ValidationError(`Unknown RGA status: ${input.toStatus}`)
  }
  if (isTerminal(row.status)) {
    throw new ValidationError(`RGA R-${row.id} is already ${statusLabel(row.status)}.`)
  }
  if (input.toStatus === 10 && !canCancel(row.status)) {
    throw new ValidationError(`RGA R-${row.id} cannot be cancelled from ${statusLabel(row.status)}.`)
  }
  if (!allowedNextStatuses(row.status).includes(input.toStatus)) {
    throw new ValidationError(
      `RGA R-${row.id} cannot move from ${statusLabel(row.status)} to ${statusLabel(input.toStatus)}.`,
    )
  }
  if (row.version !== input.version) {
    throw new ValidationError('This RGA changed since you loaded it. Reload and try again.')
  }

  const now = new Date()
  const [updated] = await tx
    .update(rgas)
    .set({
      status: input.toStatus,
      completedAt: input.toStatus === 4 ? now : row.completedAt,
      version: row.version + 1,
      updatedAt: now,
    })
    .where(and(eq(rgas.id, row.id), eq(rgas.version, row.version)))
    .returning()
  if (!updated) {
    throw new ValidationError('This RGA changed since you loaded it. Reload and try again.')
  }

  await writeTransition(tx, {
    rgaId: row.id,
    fromStatus: row.status,
    toStatus: input.toStatus,
    action: input.toStatus === 10 ? 'cancelled' : 'status',
    note: input.note,
    session,
    version: updated.version,
  })
  await auditRga(tx, session, 'rga.status', row.id, {
    summary: `RGA R-${row.id} moved from ${statusLabel(row.status)} to ${statusLabel(input.toStatus)}.`,
    before: { status: row.status, version: row.version },
    after: { status: updated.status, version: updated.version },
  })
  return updated
}
