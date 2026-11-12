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

/**
 * Starts the background job ticker on the first server request (ADR 0012 §1).
 *
 * The app has no other long-lived boot hook: `scripts/start.mjs` loads .env and
 * hands over to the Nitro output, and the compliance job is driven by an
 * external timer calling an HTTP route. Starting on the first request keeps the
 * ticker out of the serverless path entirely (a serverless deploy sets
 * `JOBS_SCHEDULER=off` and its platform cron calls the trigger route), and the
 * import sits inside a `.server()` body, so it is server code only.
 *
 * `startScheduler` is idempotent, so this stays a cheap no-op after the first
 * request.
 */
const jobsScheduler = createMiddleware().server(async ({ next }) => {
  // Domain handlers attach before the ticker starts. Each registration is
  // idempotent, so a second request is a no-op.
  void Promise.all([
    import('./modules/rga/server/job.server').then(({ registerRgaNotificationsJob }) =>
      registerRgaNotificationsJob(),
    ),
    import('./modules/sage/server/jobs.server').then(({ registerSageJobs }) => registerSageJobs()),
    import('./modules/compliance/server/jobs.server').then(({ registerComplianceJobs }) =>
      registerComplianceJobs(),
    ),
  ])
    .then(() => import('./modules/jobs/server/ticker.server'))
    .then(({ startScheduler }) => startScheduler())
  return next()
})

export const startInstance = createStart(() => ({
  requestMiddleware: [jobsScheduler, securityHeaders, csrfMiddleware],
}))
