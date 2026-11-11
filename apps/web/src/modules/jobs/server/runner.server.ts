/**
 * The background job runner: ledger, advisory locks, leases and retries.
 * SERVER ONLY (ADR 0012 §1-§9).
 *
 * The rules this file exists to enforce:
 *  - one environment owns a tick, enforced by a Postgres advisory lock, so a
 *    second instance is a standby rather than a double sender;
 *  - one execution per `(job_key, scheduled_for)`, enforced by the unique index
 *    in `app.job_runs` and claimed before the handler runs;
 *  - a crashed run leaves a visible `running` row with an expired two-minute
 *    lease, which the next tick reaps as `failed`, so nothing disappears
 *    silently;
 *  - a failing job never stops the others, and a retry backs off 1 m / 5 m /
 *    15 m instead of hammering a broken integration.
 *
 * Why the claim is its own transaction: the row has to be committed before the
 * handler starts, or a second trigger could not tell "already running" from
 * "not started", and a crash mid-handler would leave no trace. The handler then
 * runs inside a second transaction that holds the per-job advisory lock and
 * writes the result, so domain writes and the ledger row commit together.
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import postgres from 'postgres'
import { getDb, type Db, type Tx } from '@cls/db'
import { jobRuns } from '@cls/db/schema'
import { ServiceUnavailableError } from '@cls/core'
import { getConfig } from '@cls/core/env.server'
import { logger as rootLogger } from '@cls/core/logger'
import {
  businessDateFor,
  decideRun,
  getJob,
  jobHealth,
  listJobs,
  previousOccurrence,
  registerCatalogueJobs,
  retryDelayMs,
  runJob,
  shouldRetry,
  type JobContext,
  type JobDefinition,
  type JobExecution,
  type JobHealth,
  type JobHealthRun,
  type JobLogger,
  type JobRunStatus,
  type RunDecision,
} from '@cls/core/jobs'

/** The scheduler lock: one environment ticks at a time (ADR 0012 §1). */
const SCHEDULER_LOCK = 'cls:scheduler'

/** Per-job lock, so a manual trigger and a tick cannot double-run (§3, §5). */
function jobLock(key: string): string {
  return `cls:job:${key}`
}

/** Two-minute lease (ADR 0012 §3). */
const LEASE_MS = 2 * 60_000

/** How many expired leases one tick will reap, so a repair cannot stall a tick. */
const REAP_BATCH = 50

/** Raised when a handler outlives its definition's `timeoutMs`. */
class JobTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`timed out after ${timeoutMs}ms`)
    this.name = 'JobTimeoutError'
  }
}

export type JobTickDecision = RunDecision | 'already_running' | 'duplicate' | 'error'

/** What one tick did with one job. Small and serialisable for logs and tests. */
export type JobTickOutcome = {
  key: string
  decision: JobTickDecision
  status?: JobRunStatus
  runId?: number
  recordsProcessed?: number
  error?: string
}

export type DueJobsResult = {
  /** False means another instance holds the scheduler lock: nothing was done. */
  acquired: boolean
  reaped: number
  outcomes: JobTickOutcome[]
}

export type RunJobNowResult = {
  /** `running` when another run holds the slot and nothing was executed. */
  status: JobRunStatus
  runId: number
  recordsProcessed: number
  alreadyRunning: boolean
  detail?: Record<string, unknown> | null
  error?: string | null
}

type LedgerRow = {
  id: number
  scheduledFor: Date
  status: JobRunStatus
  attempt: number
  leaseExpiresAt: Date | null
  startedAt: Date
  finishedAt: Date | null
  recordsProcessed: number
}

/**
 * The catalogue is data, so it is registered on first use rather than at import
 * time: importing this module must not depend on the order another module
 * happened to import `@cls/core/jobs`.
 */
function ensureCatalogue(): void {
  registerCatalogueJobs()
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'unknown error'
}

/** Wraps the shared logger so every line from a run carries the job and row. */
function loggerFor(key: string, runId: number): JobLogger {
  const fields = { job: key, runId }
  return {
    debug: (message, extra) => rootLogger.debug(message, { ...fields, ...extra }),
    info: (message, extra) => rootLogger.info(message, { ...fields, ...extra }),
    warn: (message, extra) => rootLogger.warn(message, { ...fields, ...extra }),
    error: (message, extra) => rootLogger.error(message, { ...fields, ...extra }),
  }
}

let schedulerConnection: ReturnType<typeof postgres> | undefined

/**
 * TLS rules, mirroring `packages/db/src/client.ts`: verified against the system
 * CA, `sslmode=disable` only for a throwaway local database.
 */
function sslFor(url: string): postgres.Options<Record<string, never>>['ssl'] {
  if (/sslmode=disable/.test(url)) return false
  if (/sslmode=(verify-ca|verify-full|require|prefer)/.test(url)) {
    return { rejectUnauthorized: true }
  }
  if (/neon\.tech/.test(url)) return { rejectUnauthorized: true }
  return undefined
}

/**
 * The connection the scheduler lock is taken on.
 *
 * It uses the **unpooled** endpoint on purpose. Session advisory locks do not
 * survive a PgBouncer-style transaction pool (Neon's `-pooler` host): two client
 * connections are multiplexed onto the same server backend, so
 * `pg_try_advisory_lock` neither excludes a second instance nor stays held
 * between statements. Verified against the dev branch, where two reserved
 * connections reported the same `pg_backend_pid()`.
 *
 * The per-job locks are transaction scoped (`pg_try_advisory_xact_lock`) and
 * are therefore safe through the pool: a transaction always lands on one
 * backend for its whole life.
 *
 * When `DATABASE_URL_UNPOOLED` is absent the pool URL is used, which is correct
 * for a direct local Postgres and degraded for a pooled endpoint; the ticker
 * logs that case at start-up.
 */
export function getSchedulerConnection(): ReturnType<typeof postgres> {
  if (!schedulerConnection) {
    const url = getConfig().databaseUrlUnpooled
    if (!url) {
      throw new ServiceUnavailableError(
        'Postgres',
        'DATABASE_URL is not configured. Add the Neon connection string to .env.',
      )
    }
    schedulerConnection = postgres(url, {
      max: 2,
      idle_timeout: 30,
      connect_timeout: 10,
      prepare: false,
      ssl: sslFor(url),
      onnotice: () => {},
    })
  }
  return schedulerConnection
}

/** Reads the single boolean a `pg_try_*_lock` query returns. */
function lockGranted(rows: unknown): boolean {
  return (rows as Array<{ locked?: boolean }>)[0]?.locked === true
}

/** `select pg_try_advisory_xact_lock(hashtext(...))`, released at commit. */
async function tryXactLock(executor: Db | Tx, key: string): Promise<boolean> {
  return lockGranted(
    await executor.execute(sql`select pg_try_advisory_xact_lock(hashtext(${key})) as locked`),
  )
}

/**
 * Holds the scheduler lock for the duration of `work`.
 *
 * The lock is session scoped, so it must be taken and released on one
 * connection: `reserve()` gives us that instead of hoping the pool hands the
 * same connection back (it will not, under load). The pass itself uses pooled
 * connections; ownership of the schedule is about who holds the lock, not which
 * connection runs the queries. `finally` always releases, even when the work
 * throws, or the next instance would stand by forever.
 */
async function withSchedulerLock<T>(
  work: () => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const reserved = await getSchedulerConnection().reserve()
  try {
    const taken = await reserved`select pg_try_advisory_lock(hashtext(${SCHEDULER_LOCK})) as locked`
    if (!lockGranted(taken)) return { acquired: false }
    return { acquired: true, value: await work() }
  } finally {
    try {
      // Releases the scheduler lock and anything else left on this connection.
      // Per-job locks are transaction scoped and never reach this point.
      await reserved`select pg_advisory_unlock_all()`
    } catch {
      // The connection is already gone; Postgres released the lock with it.
    }
    reserved.release()
  }
}

async function latestRun(db: Db, key: string): Promise<LedgerRow | null> {
  const rows = await db
    .select({
      id: jobRuns.id,
      scheduledFor: jobRuns.scheduledFor,
      status: jobRuns.status,
      attempt: jobRuns.attempt,
      leaseExpiresAt: jobRuns.leaseExpiresAt,
      startedAt: jobRuns.startedAt,
      finishedAt: jobRuns.finishedAt,
      recordsProcessed: jobRuns.recordsProcessed,
    })
    .from(jobRuns)
    .where(eq(jobRuns.jobKey, key))
    .orderBy(desc(jobRuns.scheduledFor), desc(jobRuns.id))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return { ...row, status: row.status as JobRunStatus }
}

/**
 * Turns abandoned `running` rows into `failed` rows (ADR 0012 §3).
 *
 * A live run is never reaped even when its lease looks stale: the run holds the
 * per-job advisory lock, and this transaction refuses to take a row whose lock
 * is held. That is what makes the lease a backstop for a dead process rather
 * than a race against a slow one.
 */
async function reapExpiredLeases(db: Db, now: Date): Promise<number> {
  return db.transaction(async (tx) => {
    // Compared against the tick's own clock rather than `now()`, so the whole
    // pass agrees on what "expired" means. The ISO string plus an explicit cast
    // keeps the parameter a plain text literal, which the driver can send.
    const rows = (await tx.execute(sql`
      select id, job_key
      from app.job_runs
      where status = 'running'
        and lease_expires_at is not null
        and lease_expires_at < ${now.toISOString()}::timestamptz
      order by id
      limit ${REAP_BATCH}
      for update skip locked
    `)) as unknown as Array<{ id: string | number; job_key: string }>

    let reaped = 0
    for (const row of rows) {
      if (!(await tryXactLock(tx, jobLock(row.job_key)))) continue
      await tx
        .update(jobRuns)
        .set({
          status: 'failed',
          error: 'lease expired',
          finishedAt: now,
          detail: { reason: 'lease_expired' },
        })
        .where(and(eq(jobRuns.id, Number(row.id)), eq(jobRuns.status, 'running')))
      reaped += 1
    }
    return reaped
  })
}

type Claim =
  | { kind: 'claimed'; runId: number }
  | { kind: 'busy'; runId: number | null }
  | {
      kind: 'duplicate'
      runId: number
      status: JobRunStatus
      recordsProcessed: number
      detail: Record<string, unknown> | null
    }

/**
 * Claims the ledger row for a slot, committed before the handler runs.
 *
 * `INSERT ... ON CONFLICT DO NOTHING RETURNING id` is the whole double-run
 * guard: no row means the slot is already accounted for, and Postgres resolves
 * two simultaneous inserts by waiting for the winner and then reporting the
 * conflict, so the loser sees a committed `running` row and a live lease.
 *
 * The per-job advisory lock is deliberately *not* taken here. It belongs to the
 * execution transaction, and taking it in this short transaction as well lets a
 * second trigger win the lock in the gap between claim and execution, which
 * would leave a claimed slot unexecuted until its lease lapsed.
 *
 * A manual trigger may re-open a `failed` or `missed` row (an operator pressing
 * the button is not an automatic retry); a `succeeded` or `skipped` row is never
 * re-run.
 */
async function claimSlot(
  db: Db,
  options: { definition: JobDefinition; slot: Date; attempt: number; now: Date; manual: boolean },
): Promise<Claim> {
  const { definition, slot, attempt, now, manual } = options
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(jobRuns)
      .values({
        jobKey: definition.key,
        scheduledFor: slot,
        businessDate: businessDateFor(slot, definition.timezone),
        attempt,
        status: 'running',
        startedAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      })
      .onConflictDoNothing({ target: [jobRuns.jobKey, jobRuns.scheduledFor] })
      .returning({ id: jobRuns.id })

    const claimed = inserted[0]
    if (claimed) return { kind: 'claimed', runId: claimed.id }

    const existing = await tx
      .select({
        id: jobRuns.id,
        status: jobRuns.status,
        attempt: jobRuns.attempt,
        leaseExpiresAt: jobRuns.leaseExpiresAt,
        recordsProcessed: jobRuns.recordsProcessed,
        detail: jobRuns.detail,
      })
      .from(jobRuns)
      .where(and(eq(jobRuns.jobKey, definition.key), eq(jobRuns.scheduledFor, slot)))
      .limit(1)
    const row = existing[0]
    if (!row) {
      // Somebody inserted and deleted between the two statements; treat it as
      // busy rather than guessing.
      return { kind: 'busy', runId: null }
    }

    const liveLease = row.leaseExpiresAt !== null && row.leaseExpiresAt.getTime() > now.getTime()
    if (row.status === 'running' && liveLease) {
      return { kind: 'busy', runId: row.id }
    }

    const mayRerun = manual || row.status === 'failed' || row.status === 'missed'
    if (mayRerun && row.status !== 'succeeded' && row.status !== 'skipped') {
      const reopened = await tx
        .update(jobRuns)
        .set({
          status: 'running',
          attempt: Math.max(attempt, row.attempt + 1),
          startedAt: now,
          finishedAt: null,
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
          error: null,
          detail: null,
          recordsProcessed: 0,
        })
        .where(eq(jobRuns.id, row.id))
        .returning({ id: jobRuns.id })
      return { kind: 'claimed', runId: reopened[0]?.id ?? row.id }
    }

    return {
      kind: 'duplicate',
      runId: row.id,
      status: row.status as JobRunStatus,
      recordsProcessed: row.recordsProcessed,
      detail: row.detail ?? null,
    }
  })
}

/**
 * Resolves `run`, or aborts it at `timeoutMs` (ADR 0012 §9).
 *
 * A promise cannot be killed, so a handler that outlives its budget is
 * abandoned rather than stopped. `ctx.signal` is the cooperative escape hatch
 * and handlers should pass it to their own work; the attempt is recorded as
 * `failed` either way, and the row stays retryable.
 */
async function runWithTimeout(
  run: Promise<JobExecution>,
  timeoutMs: number,
  controller: AbortController,
): Promise<JobExecution> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      run,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          // Cooperative: the handler's own work sees the abort and can stop.
          controller.abort()
          reject(new JobTimeoutError(timeoutMs))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Executes a claimed attempt.
 *
 * The handler runs inside the transaction that holds the per-job lock, so its
 * writes and the ledger row commit together: a timeout or a throw leaves no
 * partial domain state, only a `failed` row the next tick can retry.
 */
async function executeAttempt(
  db: Db,
  options: {
    definition: JobDefinition
    slot: Date
    attempt: number
    runId: number
    dryRun: boolean
    decision: RunDecision
  },
): Promise<JobTickOutcome> {
  const { definition, slot, attempt, runId, dryRun, decision } = options

  try {
    const execution = await db.transaction(async (tx) => {
      if (!(await tryXactLock(tx, jobLock(definition.key)))) return null

      const controller = new AbortController()
      const context: JobContext = {
        db: tx,
        runId,
        idempotencyKey: `${definition.key}:${slot.toISOString()}`,
        businessDate: businessDateFor(slot, definition.timezone),
        scheduledFor: slot,
        attempt,
        logger: loggerFor(definition.key, runId),
        dryRun,
        signal: controller.signal,
      }

      const result = await runWithTimeout(
        runJob(definition.key, context),
        definition.timeoutMs,
        controller,
      )

      // The lease is refreshed in the same transaction that writes the result.
      // The row is terminal from here, so the reaper ignores it either way.
      await tx
        .update(jobRuns)
        .set({
          status: result.status,
          recordsProcessed: result.recordsProcessed,
          detail: result.detail,
          error: result.error,
          finishedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        })
        .where(eq(jobRuns.id, runId))

      return result
    })

    if (!execution) {
      // The lock changed hands between claim and execution. Leaving the lease
      // alone means the row is reaped and retried rather than falsely closed.
      return { key: definition.key, decision: 'already_running', runId, status: 'running' }
    }

    return {
      key: definition.key,
      decision,
      status: execution.status,
      runId,
      recordsProcessed: execution.recordsProcessed,
    }
  } catch (error) {
    // The transaction rolled back, so the handler's writes are gone. Record the
    // failure on the claim row; retries are scheduled by the next tick.
    const message = messageOf(error)
    await db
      .update(jobRuns)
      .set({
        status: 'failed',
        error: message,
        finishedAt: new Date(),
        detail: { attempt, decision, dryRun },
      })
      .where(eq(jobRuns.id, runId))
      .catch(() => undefined)
    rootLogger.error('job attempt failed', { job: definition.key, runId, error })
    return { key: definition.key, decision: 'error', status: 'failed', runId, error: message }
  }
}

/** Records a slot that arrived while the process was down and is now too old. */
async function recordMissed(
  db: Db,
  definition: JobDefinition,
  slot: Date,
  now: Date,
): Promise<JobTickOutcome> {
  const inserted = await db
    .insert(jobRuns)
    .values({
      jobKey: definition.key,
      scheduledFor: slot,
      businessDate: businessDateFor(slot, definition.timezone),
      attempt: 1,
      status: 'missed',
      startedAt: now,
      finishedAt: now,
      leaseExpiresAt: null,
      detail: { reason: 'catch_up_window_exceeded', catchUpWindowMs: definition.catchUpWindowMs },
    })
    .onConflictDoNothing({ target: [jobRuns.jobKey, jobRuns.scheduledFor] })
    .returning({ id: jobRuns.id })
  return {
    key: definition.key,
    decision: 'missed',
    status: 'missed',
    runId: inserted[0]?.id,
  }
}

/**
 * A failed slot with attempts left, once its backoff has elapsed.
 *
 * Retries do not block the ticker: the wait happens between ticks, and a retry
 * is only offered while the failed row still belongs to the current slot, so a
 * daily job never retries yesterday's run.
 */
function retrySlot(
  definition: JobDefinition,
  latest: LedgerRow | null,
  now: Date,
): { slot: Date; attempt: number } | null {
  if (!latest || latest.status !== 'failed') return null
  if (!shouldRetry(latest.attempt, definition.maxAttempts)) return null
  const slot = previousOccurrence(definition.schedule, definition.timezone, now)
  if (!slot || slot.getTime() !== latest.scheduledFor.getTime()) return null
  const finishedAt = latest.finishedAt ?? latest.startedAt
  const dueAt = finishedAt.getTime() + retryDelayMs(latest.attempt)
  if (now.getTime() < dueAt) return null
  return { slot, attempt: latest.attempt + 1 }
}

/** One job, one tick: retry first, then the schedule decides. */
async function tickOne(
  db: Db,
  definition: JobDefinition,
  now: Date,
  dryRun: boolean,
): Promise<JobTickOutcome> {
  const latest = await latestRun(db, definition.key)

  const retry = retrySlot(definition, latest, now)
  if (retry) {
    const claim = await claimSlot(db, {
      definition,
      slot: retry.slot,
      attempt: retry.attempt,
      now,
      manual: false,
    })
    return settle(db, definition, retry.slot, retry.attempt, dryRun, 'run', claim)
  }

  const decision = decideRun({
    definition,
    now,
    lastRun: latest ? { scheduledFor: latest.scheduledFor } : null,
  })
  if (decision === 'not_due') return { key: definition.key, decision }

  const slot = previousOccurrence(definition.schedule, definition.timezone, now)
  if (!slot) return { key: definition.key, decision: 'not_due' }
  if (decision === 'missed') return recordMissed(db, definition, slot, now)

  const claim = await claimSlot(db, { definition, slot, attempt: 1, now, manual: false })
  return settle(db, definition, slot, 1, dryRun, decision, claim)
}

/** Executes a claim, or reports why it was not executed. */
async function settle(
  db: Db,
  definition: JobDefinition,
  slot: Date,
  attempt: number,
  dryRun: boolean,
  decision: RunDecision,
  claim: Claim,
): Promise<JobTickOutcome> {
  if (claim.kind === 'busy') {
    return { key: definition.key, decision: 'already_running', runId: claim.runId ?? undefined }
  }
  if (claim.kind === 'duplicate') {
    return {
      key: definition.key,
      decision: 'duplicate',
      status: claim.status,
      runId: claim.runId,
      recordsProcessed: claim.recordsProcessed,
    }
  }
  return executeAttempt(db, {
    definition,
    slot,
    attempt,
    runId: claim.runId,
    dryRun,
    decision,
  })
}

/**
 * One ticker pass (ADR 0012 §1).
 *
 * Returns `{ acquired: false }` when another instance owns the schedule: a
 * standby must do nothing at all, not even reap.
 *
 * `keys` restricts the pass to named jobs. The cutover rehearsal uses it to
 * drive the import jobs alone, and a caller repairing one job does not want the
 * whole catalogue woken up.
 */
export async function runDueJobs(
  options: { now?: Date; dryRun?: boolean; keys?: readonly string[] } = {},
): Promise<DueJobsResult> {
  ensureCatalogue()
  const now = options.now ?? new Date()
  const dryRun = options.dryRun ?? false
  const selected = options.keys
    ? listJobs().filter((definition) => options.keys?.includes(definition.key))
    : listJobs()

  const locked = await withSchedulerLock(async () => {
    const db = getDb()
    const reaped = await reapExpiredLeases(db, now)
    const outcomes: JobTickOutcome[] = []
    for (const definition of selected) {
      try {
        outcomes.push(await tickOne(db, definition, now, dryRun))
      } catch (error) {
        // One broken job must not stop the rest of the schedule.
        rootLogger.error('job tick errored', { job: definition.key, error })
        outcomes.push({ key: definition.key, decision: 'error', error: messageOf(error) })
      }
    }
    return { reaped, outcomes }
  })

  if (!locked.acquired) return { acquired: false, reaped: 0, outcomes: [] }
  return { acquired: true, reaped: locked.value.reaped, outcomes: locked.value.outcomes }
}

/**
 * Manual trigger for `POST /api/internal/jobs/<key>` (ADR 0012 §5).
 *
 * The same ledger row and the same per-job lock as the ticker: a double call
 * returns the row and never a second execution. `null` means the key is not in
 * the catalogue, which the route turns into a 404.
 *
 * Deliberately not gated on the scheduler lock: the trigger is the supported
 * path when the in-process ticker is off (serverless) or wedged, and the per-job
 * lock plus the unique index are what make it safe.
 */
export async function runJobNow(
  key: string,
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<RunJobNowResult | null> {
  ensureCatalogue()
  const definition = getJob(key)
  if (!definition) return null

  const now = options.now ?? new Date()
  const dryRun = options.dryRun ?? false
  const slot = previousOccurrence(definition.schedule, definition.timezone, now) ?? now
  const db = getDb()

  const claim = await claimSlot(db, { definition, slot, attempt: 1, now, manual: true })

  if (claim.kind === 'busy') {
    return {
      status: 'running',
      runId: claim.runId ?? 0,
      recordsProcessed: 0,
      alreadyRunning: true,
    }
  }
  if (claim.kind === 'duplicate') {
    return {
      status: claim.status,
      runId: claim.runId,
      recordsProcessed: claim.recordsProcessed,
      alreadyRunning: false,
      detail: claim.detail,
      error: null,
    }
  }

  const outcome = await executeAttempt(db, {
    definition,
    slot,
    attempt: 1,
    runId: claim.runId,
    dryRun,
    decision: 'run',
  })
  return {
    status: outcome.status ?? 'failed',
    runId: claim.runId,
    recordsProcessed: outcome.recordsProcessed ?? 0,
    alreadyRunning: outcome.decision === 'already_running',
    error: outcome.error ?? null,
  }
}

/**
 * The `/api/health` `jobs` rows (ADR 0012 §8).
 *
 * Reads a week of ledger rows and reduces them in core, so a stale job is
 * visible without reading logs. Deliberately tolerant: a health check that
 * throws is worse than one that reports a problem.
 */
export async function getJobsHealth(now: Date = new Date()): Promise<JobHealth[]> {
  ensureCatalogue()
  try {
    const db = getDb()
    const rows = await db
      .select({
        jobKey: jobRuns.jobKey,
        status: jobRuns.status,
        scheduledFor: jobRuns.scheduledFor,
        startedAt: jobRuns.startedAt,
        finishedAt: jobRuns.finishedAt,
      })
      .from(jobRuns)
      .where(sql`${jobRuns.startedAt} > now() - interval '7 days'`)
      .limit(5000)
    return jobHealth(listJobs(), rows as unknown as JobHealthRun[], now)
  } catch (error) {
    rootLogger.warn('job health unavailable', { error })
    return jobHealth(listJobs(), [], now)
  }
}
