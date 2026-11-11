import { writeAudit } from '@cls/auth'
import type { Tx } from '@cls/db'
import type { PermissionKey } from '@cls/core'
import type { AuthSessionView } from '../../../server/auth.types'

export async function auditInvoice(
  tx: Tx,
  session: AuthSessionView,
  action: string,
  invoiceId: number | string,
  input: {
    summary: string
    permission?: PermissionKey
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
  },
): Promise<void> {
  await writeAudit(tx, {
    action,
    actorUserId: session.user.id,
    actorLabel: session.user.displayName,
    actorRole: session.user.role,
    entityType: 'sales_invoice',
    entityId: String(invoiceId),
    summary: input.summary,
    permission: input.permission ?? 'invoice:write',
    before: input.before ?? null,
    after: input.after ?? null,
  })
}

export async function auditSubInvoice(
  tx: Tx,
  session: AuthSessionView,
  action: string,
  invoiceId: number | string,
  input: {
    summary: string
    permission?: PermissionKey
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
  },
): Promise<void> {
  await writeAudit(tx, {
    action,
    actorUserId: session.user.id,
    actorLabel: session.user.displayName,
    actorRole: session.user.role,
    entityType: 'subcontractor_invoice',
    entityId: String(invoiceId),
    summary: input.summary,
    permission: input.permission ?? 'invoice:read',
    before: input.before ?? null,
    after: input.after ?? null,
  })
}
