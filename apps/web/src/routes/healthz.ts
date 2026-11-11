import { createFileRoute } from '@tanstack/react-router'

/**
 * GET /healthz — liveness only. Does not touch the database or Sage.
 * Use this for "is the process alive"; use /api/ready for "can it serve".
 */
export const Route = createFileRoute('/healthz')({
  server: {
    handlers: {
      GET: async () =>
        new Response('ok', {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
        }),
    },
  },
})
