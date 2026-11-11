import { createFileRoute } from '@tanstack/react-router'
import { buildHealthReport } from '../../server/health.server'

/**
 * GET /api/ready
 *
 * 200 only when Postgres is reachable. 503 otherwise, with the reason.
 * This is the probe a process manager or load balancer should use.
 */
export const Route = createFileRoute('/api/ready')({
  server: {
    handlers: {
      GET: async () => {
        const report = await buildHealthReport()
        const ready = report.checks.database.status === 'ok'
        return Response.json(
          { ready, status: report.status, checks: report.checks },
          { status: ready ? 200 : 503, headers: { 'cache-control': 'no-store' } },
        )
      },
    },
  },
})
