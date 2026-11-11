/**
 * Server-side authorization and tenant scoping.
 *
 * SERVER ONLY. This is the security boundary, not a UI helper: every read and
 * write resolves the actor's scope here, and every list query carries the scope
 * predicate. A subcontractor sees its own company; a technician sees assigned
 * work orders only; a supplier sees none.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm'
import { ForbiddenError, NotFoundError, type PermissionKey } from '@cls/core'
import { getDb, type Executor } from '@cls/db'
import { workOrders } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'

export type Scope =
  | { kind: 'all' }
  | { kind: 'subcontractor'; subcontractorId: number | null }
  | { kind: 'technician'; userId: string }
  | { kind: 'none' }

export function hasGrant(session: AuthSessionView, key: PermissionKey | string): boolean {
  return session.user.grants.some((grant) => grant.key === key)
}

export function hasScopedGrant(
  session: AuthSessionView,
  key: string,
  scopeId: number,
): boolean {
  return session.user.grants.some(
    (grant) =>
      grant.key === key &&
      (grant.scopeSubcontractorId === null || grant.scopeSubcontractorId === scopeId),
  )
}

export function assertPermission(session: AuthSessionView, key: PermissionKey): void {
  if (!hasGrant(session, key)) throw new ForbiddenError(key)
}

export function resolveScope(session: AuthSessionView): Scope {
  if (session.user.role === 'admin') return { kind: 'all' }
  if (session.user.role === 'subcontractor') {
    return { kind: 'subcontractor', subcontractorId: session.user.subcontractorId }
  }
  if (session.user.role === 'technician') {
    return { kind: 'technician', userId: session.user.id }
  }
  return { kind: 'none' }
}

/** Predicate that limits a `work_orders` query to the actor's scope. */
export function scopeCondition(scope: Scope): SQL | undefined {
  switch (scope.kind) {
    case 'all':
      return undefined
    case 'none':
      return sql`false`
    case 'subcontractor':
      if (!scope.subcontractorId) return sql`false`
      return sql`(
        ${workOrders.subcontractorId} = ${scope.subcontractorId}
        or exists (
          select 1 from app.work_order_assignments a
          where a.work_order_id = ${workOrders.id}
            and a.subcontractor_id = ${scope.subcontractorId}
        )
      )`
    case 'technician':
      return sql`(
        exists (
          select 1 from app.work_order_assignments a
          where a.work_order_id = ${workOrders.id}
            and a.tech_user_id = ${scope.userId}::uuid
        )
        or exists (
          select 1 from app.local_work_order_techs t
          where t.work_order_id = ${workOrders.id}
            and t.tech_user_id = ${scope.userId}::uuid
        )
      )`
  }
}

/**
 * Loads a work order only when the actor's scope covers it. A scoped actor
 * gets NotFound rather than Forbidden so the endpoint does not disclose that a
 * record exists in another company.
 */
export async function loadAccessibleWorkOrder(
  session: AuthSessionView,
  id: number,
  executor?: Executor,
) {
  assertPermission(session, 'workorder:read')
  const scope = resolveScope(session)
  const db = executor ?? getDb()
  const condition = scopeCondition(scope)
  const rows = await db
    .select()
    .from(workOrders)
    .where(condition ? and(eq(workOrders.id, id), condition) : eq(workOrders.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) throw new NotFoundError('Work order')
  return row
}

/** Same as above but raises Forbidden for a permission problem and NotFound for scope. */
export async function assertWorkOrderWrite(
  session: AuthSessionView,
  id: number,
  executor?: Executor,
) {
  assertPermission(session, 'workorder:write')
  return loadAccessibleWorkOrder(session, id, executor)
}

export function canCalculateInvoice(session: AuthSessionView): boolean {
  // Owned by the Invoicing module; the Work Orders snapshot withholds totals
  // without it. Checked here on the server, never inferred from the UI.
  return hasGrant(session, 'invoice.calculate')
}
