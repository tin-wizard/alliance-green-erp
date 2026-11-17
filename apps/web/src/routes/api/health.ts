import { createFileRoute } from '@tanstack/react-router'
import { buildHealthReport, buildPublicHealth } from '../../server/health.server'

/**
 * GET /api/health
 *
 * Always 200 while the process can answer. Anonymous callers get ok/degraded
 * and nothing else; a signed-in caller gets the full report, including the
 * dependency detail.
 */
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { loadSessionFromRequest } = await import('@cls/auth')
        const session = await loadSessionFromRequest(request).catch(() => null)
        const body = session ? await buildHealthReport() : await buildPublicHealth()
        return Response.json(body, { headers: { 'cache-control': 'no-store' } })
      },
    },
  },
})
