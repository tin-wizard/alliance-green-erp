import { createFileRoute } from '@tanstack/react-router'

/**
 * POST /api/sage/probe
 *
 * Admin-only, read only. This is the first thing run after consent: it proves
 * the tenant offers businesses, tax rates, ledger accounts, stock items, products
 * and quota headers *before* an invoice is posted, and stores the capsule as
 * evidence. It never writes to Sage.
 */
export const Route = createFileRoute('/api/sage/probe')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { loadSessionFromRequest } = await import('@cls/auth')
        const session = await loadSessionFromRequest(request)
        if (!session) return Response.json({ error: 'Unauthorized.' }, { status: 401 })
        const { grantsInclude } = await import('@cls/auth/permissions')
        if (!grantsInclude(session.user.grants, 'sage:write')) {
          return Response.json({ error: 'Forbidden.' }, { status: 403 })
        }

        const { runTenantProbe } = await import('../../../modules/sage/server/probe.server')
        const { SageError } = await import('@cls/sage')
        try {
          const result = await runTenantProbe()
          return Response.json(result, { headers: { 'cache-control': 'no-store' } })
        } catch (error) {
          if (error instanceof SageError) {
            return Response.json(
              { error: error.message, code: error.code },
              { status: error.kind === 'unconfigured' ? 503 : 502 },
            )
          }
          return Response.json(
            { error: error instanceof Error ? error.message : 'Probe failed.' },
            { status: 500 },
          )
        }
      },
    },
  },
})
