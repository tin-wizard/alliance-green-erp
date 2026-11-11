import { randomUUID } from 'node:crypto'
import type { Executor } from '@cls/db'
import { auditLog, type NewAuditLogRow } from '@cls/db/schema'

/**
 * Audit writes.
 *
 * `writeAudit` must be called with the transaction that performs the business
 * change, so the audit row and the change commit or roll back together.
 */
export interface AuditEvent {
  action: string
  actorUserId?: string | null
  actorLabel?: string | null
  actorRole?: string | null
  entityType?: string | null
  entityId?: string | null
  summary?: string | null
  /**
   * Permission key that authorised the action, e.g. `invoice.calculate`.
   * Recorded inside `after` so a financial decision is attributable to a
   * capability rather than to a hard-coded username.
   */
  permission?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  requestId?: string | null
  ip?: string | null
  userAgent?: string | null
}

export async function writeAudit(executor: Executor, event: AuditEvent): Promise<void> {
  const row: NewAuditLogRow = {
    action: event.action,
    actorUserId: event.actorUserId ?? null,
    actorLabel: event.actorLabel ?? null,
    actorRole: event.actorRole ?? null,
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    summary: event.summary ?? null,
    before: event.before ?? null,
    after: event.permission
      ? { ...(event.after ?? {}), permission: event.permission }
      : (event.after ?? null),
    requestId: event.requestId ?? null,
    ip: event.ip ?? null,
    userAgent: event.userAgent ?? null,
  }
  // The union of Db and Tx does not expose one callable insert signature.
  const writer = executor as unknown as {
    insert: (table: typeof auditLog) => { values: (value: NewAuditLogRow) => Promise<unknown> }
  }
  await writer.insert(auditLog).values(row)
}

export function newRequestId(): string {
  return randomUUID()
}

/** Best-effort client metadata. Trusts proxy headers only for logging, never for auth. */
export function requestMeta(request: Request): { ip: string | null; userAgent: string | null } {
  const forwarded = request.headers.get('x-forwarded-for')
  return {
    ip: forwarded ? (forwarded.split(',')[0]?.trim() ?? null) : request.headers.get('x-real-ip'),
    userAgent: request.headers.get('user-agent'),
  }
}
