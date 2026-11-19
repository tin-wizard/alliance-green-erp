import { createFileRoute } from '@tanstack/react-router'
import { buildPublicHealth } from '../../server/health.server'

/**
 * GET /api/ready
 *
 * 200 only when Postgres is reachable. 503 otherwise. This is the probe a
 * process manager or load balancer should use; it says ready or not, so it can
 * sit on a public port without describing the infrastructure.
 */
export const Route = createFileRoute('/api/ready')({
  server: {
    handlers: {
      GET: async () => {
        const health = await buildPublicHealth()
        const ready = health.status === 'ok'
        return Response.json(
          { ready, status: health.status },
          { status: ready ? 200 : 503, headers: { 'cache-control': 'no-store' } },
        )
      },
    },
  },
})
