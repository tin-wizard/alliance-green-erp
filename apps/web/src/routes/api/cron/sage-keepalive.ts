import { createFileRoute } from '@tanstack/react-router'

/**
 * GET /api/cron/sage-keepalive
 *
 * One refresh a day keeps the 31-day idle death away, and writes the
 * `sage_health_samples` row that lets the dashboard answer "was the token alive
 * last Tuesday". A failed keep-alive flips the connection to `needs_reauth` the
 * same day, so the outage is a banner rather than a month-end surprise.
 */
export const Route = createFileRoute('/api/cron/sage-keepalive')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { assertCronSecret } = await import('../../../modules/sage/server/cron-auth.server')
        const denied = assertCronSecret(request)
        if (denied) return denied

        const { sageConfig, sageCredentialsPresent, getTokenService } = await import(
          '../../../modules/sage/server/gateway.server'
        )
        const config = sageConfig()
        if (!config.enabled || config.fake) {
          return Response.json(
            { skipped: true, reason: 'Sage is disabled or running the fake adapter.' },
            { headers: { 'cache-control': 'no-store' } },
          )
        }
        if (!sageCredentialsPresent()) {
          return Response.json(
            { error: 'Sage is enabled but its credentials are missing.' },
            { status: 503, headers: { 'cache-control': 'no-store' } },
          )
        }

        try {
          const result = await getTokenService().keepAlive()
          return Response.json(result, { headers: { 'cache-control': 'no-store' } })
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : 'The keep-alive failed.'
          return Response.json(
            { error: message },
            { status: 500, headers: { 'cache-control': 'no-store' } },
          )
        }
      },
    },
  },
})
