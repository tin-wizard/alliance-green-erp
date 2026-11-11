/**
 * Job health for `/api/health` (ADR 0012 §8).
 *
 * A pure reducer over the ledger rows the caller already loaded: "did the
 * reminder job run" becomes a small computation instead of a support call, and
 * a stale job is visible without reading logs.
 */
import type { JobDefinition, JobHealth, JobRunStatus } from './types'

/** The columns this reducer needs from `app.job_runs`. */
export type JobHealthRun = {
  jobKey: string
  status: JobRunStatus
  /** The slot the row belongs to, in UTC. */
  scheduledFor: Date
  startedAt: Date
  finishedAt: Date | null
}

/**
 * When a run finished. `finishedAt` is the honest timestamp for a completed
 * row; `startedAt` covers a row that succeeded but was never closed (an
 * interrupted write, which the reaper normally turns into `failed`).
 */
function completionTime(run: JobHealthRun): Date {
  return run.finishedAt ?? run.startedAt
}

/**
 * One row per definition, ordered by key.
 *
 * A job that has never succeeded is stale: the scheduler is meant to run it,
 * and "no success yet" is exactly the condition an operator needs to see after
 * a deploy. `staleAfterMs` is per definition because a one-minute job and a
 * weekly one cannot share a threshold.
 */
export function jobHealth(
  jobs: readonly JobDefinition[],
  runs: readonly JobHealthRun[],
  now: Date = new Date(),
): JobHealth[] {
  const lastSuccess = new Map<string, Date>()
  for (const run of runs) {
    if (run.status !== 'succeeded') continue
    const finished = completionTime(run)
    const current = lastSuccess.get(run.jobKey)
    if (!current || finished.getTime() > current.getTime()) {
      lastSuccess.set(run.jobKey, finished)
    }
  }

  return [...jobs]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((definition) => {
      const lastSuccessAt = lastSuccess.get(definition.key) ?? null
      const stale =
        lastSuccessAt === null || now.getTime() - lastSuccessAt.getTime() > definition.staleAfterMs
      return {
        key: definition.key,
        lastSuccessAt,
        stale,
        staleAfterMs: definition.staleAfterMs,
      }
    })
}
