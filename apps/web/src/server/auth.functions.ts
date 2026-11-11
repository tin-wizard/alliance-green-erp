import { createServerFn } from '@tanstack/react-start'
import { loginSchema } from './auth.schemas'
import type { SessionView } from './auth.types'
import { authMiddleware, sessionMiddleware } from './middleware'

/**
 * Auth server functions. Client-safe to import: Start replaces each handler
 * with an RPC stub. Server-only work is dynamically imported inside the
 * handler so it cannot reach the browser bundle.
 */
export const loginFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => loginSchema.parse(input))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { authenticate } = await import('./auth.server')
    await authenticate(data)
    return { ok: true }
  })

export const logoutFn = createServerFn({ method: 'POST' })
  .middleware([sessionMiddleware])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const { endSession } = await import('./auth.server')
    await endSession(context.session)
    return { ok: true }
  })

export const getSessionFn = createServerFn({ method: 'GET' })
  .middleware([sessionMiddleware])
  .handler(async ({ context }): Promise<SessionView | null> => {
    if (!context.session) return null
    const { sessionView } = await import('./auth.server')
    return sessionView(context.session)
  })

export const requireSessionFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<SessionView> => {
    const { sessionView } = await import('./auth.server')
    return sessionView(context.session)
  })
