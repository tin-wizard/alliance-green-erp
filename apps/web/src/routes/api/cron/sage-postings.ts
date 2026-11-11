import { createFileRoute } from '@tanstack/react-router'

/**
 * Sage outbox worker. Invoice issuance only queues; this job drains the queue.
 * It is idempotent by external reference, so overlapping runs are safe.
 */
export const Route = createFileRoute('/api/cron/sage-postings')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.SAGE_CRON_SECRET
        if (!secret) {
          return Response.json({ error: 'SAGE_CRON_SECRET is not configured.' }, { status: 503 })
        }
        if (request.headers.get('x-cron-secret') !== secret) {
          return Response.json({ error: 'Forbidden.' }, { status: 403 })
        }
        const { getDb } = await import('@cls/db')
        const { sagePostings } = await import('@cls/db/schema')
        const { and, asc, inArray } = await import('drizzle-orm')
        const { processSagePostingCore } = await import(
          '../../../modules/invoicing/server/posting.server'
        )
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
        }
        return Response.json(
          { processed: rows.length, sent, failed },
          { headers: { 'cache-control': 'no-store' } },
        )
      },
    },
  },
})
