import { createStart, createCsrfMiddleware, createMiddleware } from '@tanstack/react-start'
import { setResponseHeaders } from '@tanstack/react-start/server'

/**
 * Global request middleware.
 *
 * 1. CSRF protection for server functions (same-origin RPC endpoints).
 * 2. Baseline security headers. CSP is production-only because Vite's dev
 *    client uses inline scripts; it is still permissive on inline script/style
 *    because TanStack Start hydrates with inline bootstrapping. Tighten with
 *    nonces as a follow-up; the app has no third-party script origins.
 */
const securityHeaders = createMiddleware().server(async ({ next }) => {
  const result = await next()
  const headers = new Headers({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  })
  if (!import.meta.env.DEV) {
    headers.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    )
  }
  setResponseHeaders(headers)
  return result
})

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeaders, csrfMiddleware],
}))
