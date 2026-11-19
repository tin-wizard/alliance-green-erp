import { createFileRoute } from '@tanstack/react-router'

/**
 * GET /api/cron/jobs
 *
 * The serverless ticker. A host with a long-lived Node process runs the
 * in-process ticker; a serverless deploy has nothing to keep alive, so Vercel
 * Cron calls this and `runDueJobs` runs whatever is due, including compliance
 * reminders and Sage reconciliation.
 *
 * The scheduler advisory lock makes an overlapping or duplicated invocation a
 * standby rather than a second sender, and each job's own slot row makes a
 * retried call a no-op.
 */
export const Route = createFileRoute('/api/cron/jobs')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { assertCronSecret } = await import('../../../modules/sage/server/cron-auth.server')
        const denied = assertCronSecret(request)
        if (denied) return denied

        const { runDueJobs } = await import('../../../modules/jobs/server/runner.server')
        const result = await runDueJobs()
        return Response.json(result, { headers: { 'cache-control': 'no-store' } })
      },
    },
  },
})
