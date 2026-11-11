/**
 * Job runner integration tests. Real database, real advisory locks.
 *
 * These tests cannot roll back: the runner owns its transactions and the whole
 * point is that a claim commits before the handler runs. They use their own
 * `test.jobs-<run>-*` keys and delete every row they create, so the shared
 * ledger is left as they found it.
 *
 * The keys carry a per-run token because the dev database is shared: a second
 * `pnpm test` (another agent, a CI job) running this file at the same time must
 * not see, or delete, these rows.
 *
 * The ledger table arrives with the ADR 0012 migration; until that has been
 * applied the suite skips itself rather than reporting a failure the tests
 * cannot fix.
 */
import { eq, like, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

// The scheduler lock is global to the database, so a running app instance would
// block this file. Tests take their own key; production uses the default.
vi.stubEnv('JOB_SCHEDULER_LOCK_KEY', 'cls:scheduler:test')

import { getConfig } from '@cls/core/env.server'
import {
  businessDateFor,
  defineJob,
  previousOccurrence,
  registerJob,
  registerJobHandler,
  type JobResult,
} from '@cls/core/jobs'
import { getDb } from '@cls/db'
import { jobRuns } from '@cls/db/schema'
import { Route } from '../../../routes/api/internal/jobs/$key'
import { getSchedulerConnection, runDueJobs, runJobNow } from './runner.server'

const TZ = 'America/Toronto'

/** Alphanumeric token, because a job key may only contain dots and hyphens. */
const RUN_TOKEN = crypto.randomUUID().replace(/-/g, '').slice(0, 8)

const PREFIX = `test.jobs-${RUN_TOKEN}-`
const SECRET = 'integration-job-secret'

/** Handler invocations per key, so "executed once" is asserted, not assumed. */
const executions = new Map<string, number>()

/** When set to a key, that key's handler throws once. */
let failingKey: string | null = null

function track(key: string, delayMs = 0): void {
  registerJobHandler(key, async (ctx): Promise<JobResult> => {
    executions.set(key, (executions.get(key) ?? 0) + 1)
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    if (failingKey === key) throw new Error('handler exploded')
    return { recordsProcessed: 1, detail: { idempotencyKey: ctx.idempotencyKey } }
  })
}

/**
 * One slot a day, so the slot a test is working on cannot change underneath it:
 * assertions about "the same slot" must not depend on where the minute boundary
 * fell. `catchUp: 'never'` means a late tick still runs that slot.
 */
const SCHEDULE = '0 3 * * *'

function defineTestJob(key: string): void {
  registerJob(
    defineJob({
      key,
      schedule: SCHEDULE,
      timezone: TZ,
      timeoutMs: 30_000,
      maxAttempts: 3,
      catchUp: 'never',
      concurrency: 1,
      catchUpWindowMs: 0,
      staleAfterMs: 15 * 60_000,
      status: 'registered',
      description: 'Runner integration test job.',
    }),
  )
}

const LEDGER = `${PREFIX}ledger`
const CONCURRENT = `${PREFIX}concurrent`
const SLOW = `${PREFIX}slow`
const SKIPPED = `${PREFIX}skipped`
const LEASE = `${PREFIX}lease`
const FAILING = `${PREFIX}failing`

defineTestJob(LEDGER)
defineTestJob(CONCURRENT)
defineTestJob(SLOW)
defineTestJob(SKIPPED)
defineTestJob(LEASE)
defineTestJob(FAILING)

track(LEDGER)
track(CONCURRENT)
track(SLOW, 400)
track(LEASE)
track(FAILING)
// SKIPPED deliberately has no handler.

type PostHandler = (input: { request: Request; params: { key: string } }) => Promise<Response>

const post = (Route.options as unknown as { server?: { handlers?: { POST?: PostHandler } } }).server
  ?.handlers?.POST

function trigger(
  key: string,
  headers: Record<string, string> = { 'x-job-secret': SECRET },
): Request {
  return new Request(`http://localhost/api/internal/jobs/${key}`, { method: 'POST', headers })
}

function databaseConfigured(): boolean {
  try {
    return Boolean(getConfig().databaseUrl)
  } catch {
    return false
  }
}

/** False when DATABASE_URL is unset or the ADR 0012 migration has not run. */
async function ledgerAvailable(): Promise<boolean> {
  if (!databaseConfigured()) return false
  try {
    const rows = (await getDb().execute(
      sql`select to_regclass('app.job_runs') as table_name`,
    )) as unknown as Array<{ table_name: string | null }>
    return rows[0]?.table_name != null
  } catch {
    return false
  }
}

const READY = await ledgerAvailable()

async function ledgerRows(key: string) {
  return getDb().select().from(jobRuns).where(eq(jobRuns.jobKey, key)).orderBy(jobRuns.id)
}

async function clearTestRows(): Promise<void> {
  if (!READY) return
  await getDb()
    .delete(jobRuns)
    .where(like(jobRuns.jobKey, `${PREFIX}%`))
}

const originalSecret = process.env.JOB_RUNNER_SECRET

beforeEach(async () => {
  executions.clear()
  failingKey = null
  await clearTestRows()
})

afterEach(() => {
  if (originalSecret === undefined) delete process.env.JOB_RUNNER_SECRET
  else process.env.JOB_RUNNER_SECRET = originalSecret
})

afterAll(async () => {
  await clearTestRows()
  vi.unstubAllEnvs()
})

describe.skipIf(!READY)('job runner', () => {
  test('a slot runs once, however often it is triggered', async () => {
    await runJobNow(LEDGER)
    const second = await runJobNow(LEDGER)

    expect(executions.get(LEDGER)).toBe(1)
    const rows = await ledgerRows(LEDGER)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('succeeded')
    expect(rows[0]?.recordsProcessed).toBe(1)
    expect(second?.alreadyRunning).toBe(false)
    expect(second?.status).toBe('succeeded')
  })

  test('two concurrent triggers: one execution, one ledger row', async () => {
    const [first, second] = await Promise.all([runJobNow(CONCURRENT), runJobNow(CONCURRENT)])

    expect(executions.get(CONCURRENT)).toBe(1)
    const rows = await ledgerRows(CONCURRENT)
    expect(rows).toHaveLength(1)
    // Both callers are told about the same run row, and never about two.
    expect(first?.runId).toBe(rows[0]?.id)
    expect(second?.runId).toBe(rows[0]?.id)
  })

  test('a job whose handler is not written yet records skipped', async () => {
    const result = await runJobNow(SKIPPED)

    expect(result?.status).toBe('skipped')
    expect(result?.recordsProcessed).toBe(0)
    const [row] = await ledgerRows(SKIPPED)
    expect(row?.status).toBe('skipped')
    expect(row?.detail).toEqual({ reason: 'handler_not_registered' })
  })

  test('an expired lease is reaped as failed and the slot can run again', async () => {
    const now = new Date()
    const slot = previousOccurrence(SCHEDULE, TZ, now) ?? now
    const db = getDb()

    // A process that died mid-run: the row is running and its lease has lapsed.
    await db.insert(jobRuns).values({
      jobKey: LEASE,
      scheduledFor: slot,
      businessDate: businessDateFor(slot, TZ),
      attempt: 1,
      status: 'running',
      startedAt: new Date(now.getTime() - 5 * 60_000),
      leaseExpiresAt: new Date(now.getTime() - 60_000),
    })

    const tick = await runDueJobs({ keys: [LEASE], now })
    expect(tick.acquired).toBe(true)
    expect(tick.reaped).toBeGreaterThanOrEqual(1)

    const [reaped] = await ledgerRows(LEASE)
    expect(reaped?.status).toBe('failed')
    expect(reaped?.error).toBe('lease expired')

    // The operator (or the next retry) can now run the same slot again, and the
    // ledger keeps one row with the attempt counted.
    const rerun = await runJobNow(LEASE, { now })
    expect(rerun?.status).toBe('succeeded')
    expect(rerun?.runId).toBe(reaped?.id)
    expect(executions.get(LEASE)).toBe(1)

    const rows = await ledgerRows(LEASE)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.attempt).toBe(2)
  })

  test('a failing handler is recorded and does not retry inside its backoff', async () => {
    failingKey = FAILING
    const result = await runJobNow(FAILING)
    failingKey = null

    expect(result?.status).toBe('failed')
    const [row] = await ledgerRows(FAILING)
    expect(row?.status).toBe('failed')
    expect(row?.error).toContain('handler exploded')

    // The next tick is inside the one-minute backoff, so it must not retry yet.
    const tick = await runDueJobs({ keys: [FAILING] })
    expect(tick.outcomes[0]?.decision).toBe('not_due')
    expect(executions.get(FAILING)).toBe(1)
  })

  test('a standby does nothing while another instance holds the scheduler lock', async () => {
    // The scheduler lock is session scoped, so it must be held on the direct
    // (unpooled) endpoint; through the pool both callers can land on the same
    // backend and the lock would neither exclude nor persist.
    const holder = await getSchedulerConnection().reserve()
    try {
      // A concurrent `pnpm test` on the shared database may hold the lock for a
      // moment; wait for it rather than flaking.
      let held = false
      for (let attempt = 0; attempt < 20 && !held; attempt += 1) {
        const rows =
          (await holder`select pg_try_advisory_lock(hashtext('cls:scheduler:test')) as locked`) as unknown as Array<{
            locked: boolean
          }>
        held = rows[0]?.locked === true
        if (!held) await new Promise((resolve) => setTimeout(resolve, 250))
      }
      expect(held).toBe(true)

      const result = await runDueJobs({ keys: [LEDGER] })

      expect(result.acquired).toBe(false)
      expect(result.outcomes).toEqual([])
      expect(executions.get(LEDGER)).toBeUndefined()
      expect(await ledgerRows(LEDGER)).toEqual([])
    } finally {
      await holder`select pg_advisory_unlock_all()`
      holder.release()
    }
  })

  test('the trigger route answers 200 with the run row and 202 while one is in progress', async () => {
    process.env.JOB_RUNNER_SECRET = SECRET

    const [first, second] = await Promise.all([
      post?.({ request: trigger(SLOW), params: { key: SLOW } }),
      post?.({ request: trigger(SLOW), params: { key: SLOW } }),
    ])

    const statuses = [first?.status, second?.status].sort()
    expect(statuses).toEqual([200, 202])
    expect(executions.get(SLOW)).toBe(1)

    const accepted = first?.status === 202 ? first : second
    const acceptedBody = (await accepted?.json()) as { runId: number; alreadyRunning: boolean }
    expect(acceptedBody.alreadyRunning).toBe(true)
    expect(typeof acceptedBody.runId).toBe('number')

    const finished = first?.status === 200 ? first : second
    const finishedBody = (await finished?.json()) as {
      status: string
      recordsProcessed: number
      runId: number
    }
    expect(finishedBody.status).toBe('succeeded')
    expect(finishedBody.recordsProcessed).toBe(1)
    expect(finished?.headers.get('cache-control')).toBe('no-store')
  })
})
