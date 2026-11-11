import { createFileRoute } from '@tanstack/react-router'

/**
 * Daily compliance expiry job. Runs on the LAN host's scheduler with
 * `COMPLIANCE_CRON_SECRET`; the job is idempotent, so a double call is safe.
 */
export const Route = createFileRoute('/api/cron/compliance-expiry')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.COMPLIANCE_CRON_SECRET
        if (!secret) {
          return Response.json(
            { error: 'COMPLIANCE_CRON_SECRET is not configured.' },
            { status: 503 },
          )
        }
        if (request.headers.get('x-cron-secret') !== secret) {
          return Response.json({ error: 'Forbidden.' }, { status: 403 })
        }
        const { runExpiryReminders } = await import(
          '../../../modules/master-data/server/reminders.server'
        )
        const { getDb } = await import('@cls/db')
        const result = await runExpiryReminders(getDb())
        return Response.json(result, { headers: { 'cache-control': 'no-store' } })
      },
    },
  },
})
