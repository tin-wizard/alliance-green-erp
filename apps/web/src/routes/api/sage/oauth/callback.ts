import { createFileRoute } from '@tanstack/react-router'

/**
 * GET /api/sage/oauth/callback
 *
 * Verifies the single-use state, exchanges the code, and records which business
 * was authorised. A multi-business tenant is not guessed at: the response says
 * the choice is outstanding.
 */
export const Route = createFileRoute('/api/sage/oauth/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const error = url.searchParams.get('error')
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const headers = { 'cache-control': 'no-store' }

        if (error) {
          return Response.json(
            { connected: false, error: `Sage returned "${error}".` },
            { status: 400, headers },
          )
        }
        if (!code || !state) {
          return Response.json(
            { connected: false, error: 'The callback is missing its code or state.' },
            { status: 400, headers },
          )
        }

        try {
          const { completeAuthorisation } = await import(
            '../../../../modules/sage/server/oauth.server'
          )
          const outcome = await completeAuthorisation({ code, state })
          return Response.json(outcome, { headers })
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : 'The Sage connection failed.'
          return Response.json({ connected: false, error: message }, { status: 400, headers })
        }
      },
    },
  },
})
