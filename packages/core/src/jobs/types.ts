/**
 * Job scheduling vocabulary (ADR 0012 §2).
 *
 * PURE: nothing here imports `@cls/db`. `@cls/db` depends on `@cls/core`, so a
 * database import in this folder would be a cycle. The runner in the web app
 * supplies the database handle as an opaque value (`JobContext.db`) and casts
 * it at the boundary; handlers live in the app and may type it freely.
 */

/** Every state a ledger row can hold; mirrors the `job_runs` CHECK constraint. */
export type JobRunStatus = 'running' | 'succeeded' | 'failed' | 'skipped' | 'missed'

/** A status a run reaches without being killed mid-flight. */
export type JobFinalStatus = Exclude<JobRunStatus, 'running'>

/**
 * `once`: a slot missed while the process was down is run late, inside the
 * definition's catch-up window, one time only.
 * `never`: only the current slot matters; a backlog is dropped (ADR 0012 §6).
 */
export type JobCatchUpMode = 'once' | 'never'

/**
 * Catalogue marker for the admin panel: does this repository ship a handler for
 * the job? `resolveHandler` is the runtime truth; this is the published state.
 */
export type JobCatalogueStatus = 'registered' | 'awaiting-handler'

/** The subset of the structured logger a job may use. */
export type JobLogger = {
  debug: (message: string, fields?: Record<string, unknown>) => void
  info: (message: string, fields?: Record<string, unknown>) => void
  warn: (message: string, fields?: Record<string, unknown>) => void
  error: (message: string, fields?: Record<string, unknown>) => void
}

/** What a handler returns. Counts and reasons only, never recipient data. */
export type JobResult = {
  /** Defaults to `succeeded`. A handler says `skipped` when its gate is closed. */
  status?: Extract<JobFinalStatus, 'succeeded' | 'skipped'>
  recordsProcessed?: number
  detail?: Record<string, unknown> | null
}

/**
 * What a handler receives.
 *
 * `db` is the database handle as the runner passes it: a transaction, so the
 * handler's writes commit or roll back with the ledger row. Core cannot name
 * `@cls/db`'s type without a cycle, so it is `unknown` here and cast once by
 * the handler (`const db = ctx.db as Db`).
 */
export type JobContext = {
  db: unknown
  /** `app.job_runs.id` of the row this attempt is writing to. */
  runId: number
  /** `<key>:<scheduledFor ISO>`: the same value for every retry of a slot. */
  idempotencyKey: string
  /** `YYYY-MM-DD` in the job's timezone. */
  businessDate: string
  scheduledFor: Date
  /** 1 on the first try, incremented per retry. */
  attempt: number
  logger: JobLogger
  /** Read-only pass: handlers must not write (ADR 0012, cutover rehearsal). */
  dryRun: boolean
  /**
   * Aborted when the definition's `timeoutMs` elapses. Long handlers should
   * pass it to their own work so a timeout stops promptly (ADR 0012 §9).
   */
  signal: AbortSignal
}

export type JobHandler = (context: JobContext) => Promise<JobResult | void> | JobResult | void

/**
 * One scheduled job (ADR 0012 §2, extended by §6 and §8).
 *
 * `handler` is optional because the catalogue ships definitions first and the
 * domain module attaches the handler afterwards with `registerJobHandler`.
 */
export type JobDefinition = {
  /** Stable, dot-scoped key: `purchasing.po-followup-reminders`. */
  key: string
  /** Five-field cron, evaluated in `timezone`. */
  schedule: string
  /** IANA zone. The rebuild has one business timezone (ADR 0012 §7). */
  timezone: string
  /** Wall-clock budget for one attempt. */
  timeoutMs: number
  /** Total tries for a slot, including the first. Default in the catalogue: 3. */
  maxAttempts: number
  catchUp: JobCatchUpMode
  /** Per-job serialisation; the value is the advisory lock the runner takes. */
  concurrency: 1
  /**
   * How late a `catchUp: 'once'` slot may still run (ADR 0012 §6). Outside it
   * the slot is recorded `missed` and skipped, so a three-day outage cannot
   * send three days of reminders.
   */
  catchUpWindowMs: number
  /** `/api/health` reports the job stale after this long without a success. */
  staleAfterMs: number
  handler?: JobHandler
  /** Human label for the admin panel. */
  description?: string
  /** Legacy script this job replaces, kept for the cutover checklist. */
  replaces?: string
  /**
   * Catalogue marker for the admin panel: does this repository ship a handler?
   * `resolveHandler` is the live truth; this records the published state and is
   * flipped in the same change that calls `registerJobHandler`.
   */
  status?: JobCatalogueStatus
}

/** The normalised outcome of `runJob` / `runJobNow`. */
export type JobExecution = {
  status: JobFinalStatus
  recordsProcessed: number
  detail: Record<string, unknown> | null
  error: string | null
}

/** One row of `GET /api/health` `jobs` (ADR 0012 §8). */
export type JobHealth = {
  key: string
  lastSuccessAt: Date | null
  stale: boolean
  staleAfterMs: number
}
