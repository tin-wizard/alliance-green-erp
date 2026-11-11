import { writeAudit } from '@cls/auth'
import type { Executor } from '@cls/db'
import type { AuthSessionView } from '../../../server/auth.types'
import { assertPermission } from '../../../server/middleware'

export function assertTjxRead(session: AuthSessionView): void {
  assertPermission(session, 'tjx:read')
}

export function assertTjxWrite(session: AuthSessionView): void {
  assertPermission(session, 'tjx:write')
}

/** Canonical part number used in every TJX master and snapshot. */
export function normalizePartNo(value: string): string {
  return value.trim().toUpperCase()
}

export async function auditTjx(
  executor: Executor,
  session: AuthSessionView,
  action: string,
  entityType: string,
  entityId: string | number,
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
    entityType,
    entityId: String(entityId),
    summary: input.summary ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
  })
}

/** Room and fixture names are unique case-insensitively; the DB is the last guard. */
export function sameName(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase()
}
