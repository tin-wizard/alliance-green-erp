import { writeAudit } from '@cls/auth'
import type { Executor } from '@cls/db'
import type { AuthSessionView } from '../../../server/auth.types'
import type { RgaRow } from './access.server'

export async function auditRga(
  executor: Executor,
  session: AuthSessionView,
  action: string,
  rgaId: number,
  input: {
    summary?: string
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
  } = {},
): Promise<void> {
  await writeAudit(executor, {
    action,
    actorUserId: session.user.id,
    actorLabel: session.user.email,
    actorRole: session.user.role,
    entityType: 'rga',
    entityId: String(rgaId),
    summary: input.summary ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
  })
}

export function rgaSnapshot(row: RgaRow): Record<string, unknown> {
  return {
    supplierId: row.supplierId,
    poId: row.poId,
    workOrderId: row.workOrderId,
    siteId: row.siteId,
    subcontractorId: row.subcontractorId,
    rgaType: row.rgaType,
    replacementType: row.replacementType,
    status: row.status,
    requestDate: row.requestDate,
    rgaNotes: row.rgaNotes,
    internalNotes: row.internalNotes,
    shippingAddress: row.shippingAddress,
    version: row.version,
  }
}
