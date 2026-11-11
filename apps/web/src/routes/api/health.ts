import { createFileRoute } from '@tanstack/react-router'
import { buildHealthReport } from '../../server/health.server'

/**
 * GET /api/health
 *
 * Always 200 while the process can answer. `status: "degraded"` means a
 * dependency is down; use /api/ready for a 503 readiness probe.
 */
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        const report = await buildHealthReport()
        return Response.json(report, {
          headers: { 'cache-control': 'no-store' },
        })
      },
    },
  },
})
