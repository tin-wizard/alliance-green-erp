import { createMiddleware } from '@tanstack/react-start'
import { ForbiddenError, UnauthorizedError, type PermissionKey } from '@cls/core'
import { grantsInclude, grantsIncludeScoped } from '@cls/auth/permissions'
import type { AuthSessionView } from './auth.types'

/**
 * Authorization middleware. CLIENT-SAFE module: the top level imports only
 * client-safe code. The server-only session loader is imported inside the
 * `.server()` callback, which never ships to the browser.
 *
 * Server functions are the security boundary: a route `beforeLoad` guard is UX,
 * not protection. Every server function that reads or writes private data must
 * declare `authMiddleware` or `permissionMiddleware('<key>')`.
 */
export const sessionMiddleware = createMiddleware().server(async ({ next, request }) => {
  const { loadSessionFromRequest } = await import('@cls/auth')
  const session = await loadSessionFromRequest(request)
  return next({ context: { session } })
})

export const authMiddleware = createMiddleware()
  .middleware([sessionMiddleware])
  .server(async ({ next, context }) => {
    if (!context.session) throw new UnauthorizedError()
    return next({ context: { session: context.session } })
  })

export function permissionMiddleware(permission: PermissionKey) {
  return createMiddleware()
    .middleware([authMiddleware])
    .server(async ({ next, context }) => {
      if (!grantsInclude(context.session.user.grants, permission)) {
        // Audit the capability, not the person's username. Best effort: a
        // failed audit write must not turn a 403 into a 500.
        const { getDb } = await import('@cls/db')
        const { writeAudit } = await import('@cls/auth')
        await writeAudit(getDb(), {
          action: 'auth.permission_denied',
          actorUserId: context.session.user.id,
          actorLabel: context.session.user.username,
          actorRole: context.session.user.role,
          entityType: 'permission',
          entityId: permission,
          summary: `Denied ${permission}`,
          permission,
        }).catch(() => undefined)
        throw new ForbiddenError(permission)
      }
      return next({ context: { permission } })
    })
}

/** For handlers where the scope (e.g. subcontractor id) comes from input. */
export function assertPermission(session: AuthSessionView, permission: PermissionKey): void {
  if (!grantsInclude(session.user.grants, permission)) {
    throw new ForbiddenError(permission)
  }
}

export function assertScopedPermission(
  session: AuthSessionView,
  permission: PermissionKey,
  scopeId: number,
): void {
  if (!grantsIncludeScoped(session.user.grants, permission, scopeId)) {
    throw new ForbiddenError(permission)
  }
}
