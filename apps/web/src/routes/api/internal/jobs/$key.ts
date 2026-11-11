import { createFileRoute } from '@tanstack/react-router'

/**
 * Manual / external trigger for one job (ADR 0012 §5).
 *
 * POST /api/internal/jobs/<key> with `x-job-secret: JOB_RUNNER_SECRET`.
 * Modelled on /api/cron/compliance-expiry: `503` when the secret is not set,
 * `403` on a mismatch, `no-store` everywhere.
 *
 * The run is not a separate code path. It takes the same per-job advisory lock
 * and writes the same `app.job_runs` row as the ticker, so:
 *  - a slot that already succeeded returns its row (`200`) instead of running
 *    twice, which is what makes the host timer safe to retry;
 *  - a run in progress returns `202 { runId, alreadyRunning }`;
 *  - an unknown key returns `404` and never reaches the database.
 *
 * `?dryRun=1` passes read-only mode through to the handler. Responses carry a
 * run id and counts, never recipient data.
 */
export const Route = createFileRoute('/api/internal/jobs/$key')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { verifyJobSecret } = await import('../../../../modules/jobs/server/auth.server')
        const refused = verifyJobSecret(request)
        if (refused) return refused

        const { runJobNow } = await import('../../../../modules/jobs/server/runner.server')
        const dryRun = new URL(request.url).searchParams.get('dryRun') === '1'
        const noStore = { 'cache-control': 'no-store' }

        const result = await runJobNow(params.key, { dryRun })
        if (!result) {
          return Response.json(
            { error: `Unknown job '${params.key}'.` },
            { status: 404, headers: noStore },
          )
        }
        if (result.alreadyRunning) {
          return Response.json(
            { runId: result.runId, alreadyRunning: true },
            { status: 202, headers: noStore },
          )
        }
        return Response.json(
          {
            status: result.status,
            recordsProcessed: result.recordsProcessed,
            runId: result.runId,
          },
          { headers: noStore },
        )
      },
    },
  },
})
