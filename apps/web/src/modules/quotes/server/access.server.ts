/**
 * Quote authorization boundary.
 *
 * SERVER ONLY. Quotes are an internal office surface today: there is no
 * customer portal, so even a role that carries `quote:read` (subcontractor)
 * is denied. Hiding a route or button is never the control.
 */
import { and, eq } from 'drizzle-orm'
import { ForbiddenError, NotFoundError, type PermissionKey } from '@cls/core'
import { getDb, type Executor } from '@cls/db'
import { quotes } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import { isQuoteStaff } from '../lib/rules'

export function hasGrant(session: AuthSessionView, key: PermissionKey | string): boolean {
  return session.user.grants.some((grant) => grant.key === key)
}

export function assertQuoteStaff(session: AuthSessionView): void {
  if (!isQuoteStaff(session.user.role)) {
    throw new ForbiddenError('Quotes are limited to office staff.')
  }
}

export function assertQuotePermission(
  session: AuthSessionView,
  key: PermissionKey,
): void {
  assertQuoteStaff(session)
  if (!hasGrant(session, key)) throw new ForbiddenError(key)
}

export async function loadQuoteRow(
  session: AuthSessionView,
  id: number,
  executor?: Executor,
  options: { allowDeleted?: boolean } = {},
) {
  assertQuotePermission(session, 'quote:read')
  const db = executor ?? getDb()
  const [row] = await db
    .select()
    .from(quotes)
    .where(
      options.allowDeleted
        ? eq(quotes.id, id)
        : and(eq(quotes.id, id), eq(quotes.isDeleted, false)),
    )
    .limit(1)
  if (!row) throw new NotFoundError('Quote')
  return row
}

export function assertQuoteWrite(session: AuthSessionView): void {
  assertQuotePermission(session, 'quote:write')
}

export function assertQuoteApprove(session: AuthSessionView): void {
  assertQuotePermission(session, 'quote:approve')
}
