import { createFileRoute } from '@tanstack/react-router'

/**
 * GET /api/sage/oauth/start
 *
 * Admin-only. Stores a single-use `state` and sends the browser to Sage. Refuses
 * when Sage is disabled or unconfigured rather than bouncing the operator to a
 * broken consent screen.
 */
export const Route = createFileRoute('/api/sage/oauth/start')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { sageConfig } = await import('../../../../modules/sage/server/gateway.server')
        const config = sageConfig()
        if (!config.enabled) {
          return Response.json(
            { error: 'Sage posting is disabled (SAGE_ENABLED=false).' },
            { status: 503 },
          )
        }
        if (!config.clientId || !config.clientSecret || !config.redirectUri || !config.tokenEncKey) {
          return Response.json(
            {
              error:
                'Sage is enabled but not configured. Set SAGE_CLIENT_ID, SAGE_CLIENT_SECRET, SAGE_REDIRECT_URI and SAGE_TOKEN_ENC_KEY.',
            },
            { status: 503 },
          )
        }

        const { loadSessionFromRequest } = await import('@cls/auth')
        const session = await loadSessionFromRequest(request)
        if (!session) return Response.json({ error: 'Unauthorized.' }, { status: 401 })
        const { grantsInclude } = await import('@cls/auth/permissions')
        if (!grantsInclude(session.user.grants, 'sage:write')) {
          return Response.json({ error: 'Forbidden.' }, { status: 403 })
        }

        const { beginAuthorisation } = await import('../../../../modules/sage/server/oauth.server')
        const location = await beginAuthorisation(session.user.id)
        return new Response(null, {
          status: 302,
          headers: { location, 'cache-control': 'no-store' },
        })
      },
    },
  },
})
