import { createFileRoute } from '@tanstack/react-router'

/**
 * Sage outbox worker. Invoice issuance only queues; this job drains the queue.
 * It is idempotent by external reference, so overlapping runs are safe.
 *
 * Two things happen before a single posting is attempted:
 *
 * 1. the shared secret is checked (`503` unset, `403` mismatch);
 * 2. the pause conditions are read. A paused queue returns `200` with the reason
 *    and processes nothing — a paused job is not a failed job.
 */
export const Route = createFileRoute('/api/cron/sage-postings')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { assertCronSecret } = await import('../../../modules/sage/server/cron-auth.server')
        const denied = assertCronSecret(request)
        if (denied) return denied

        const { getDb } = await import('@cls/db')
        const { sagePostings } = await import('@cls/db/schema')
        const { and, asc, inArray } = await import('drizzle-orm')
        const { processSagePostingCore } = await import(
          '../../../modules/invoicing/server/posting.server'
        )
        const { installSagePostingGateway, getPauseGovernor } = await import(
          '../../../modules/sage/server/gateway.server'
        )

        installSagePostingGateway()
        const pause = getPauseGovernor()
        const before = await pause.report()
        if (before.paused) {
          return Response.json(
            { paused: before.reason, message: before.message, processed: 0, sent: 0, failed: 0 },
            { headers: { 'cache-control': 'no-store' } },
          )
        }

        const db = getDb()
        const rows = await db
          .select({ id: sagePostings.id })
          .from(sagePostings)
          .where(and(inArray(sagePostings.status, ['queued', 'failed'])))
          .orderBy(asc(sagePostings.requestedAt))
          .limit(50)

        let sent = 0
        let failed = 0
        for (const row of rows) {
          const outcome = await db.transaction((tx) =>
            processSagePostingCore(tx, row.id, null),
          )
          if (outcome.status === 'sent') sent += 1
          else failed += 1
          const current = await pause.report()
          if (current.paused) break
        }

        const after = await pause.report()
        return Response.json(
          { processed: sent + failed, sent, failed, paused: after.paused ? after.reason : null },
          { headers: { 'cache-control': 'no-store' } },
        )
      },
    },
  },
})
