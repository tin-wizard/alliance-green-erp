/**
 * The in-process scheduler ticker (ADR 0012 §1). SERVER ONLY.
 *
 * A long-lived Node host owns the schedule; a serverless deploy never starts
 * this and relies on its platform cron calling the trigger route instead. The
 * ticker is therefore opt-out, not opt-in:
 *
 *  - `NODE_ENV=test` never starts it (tests drive the runner directly);
 *  - `JOBS_SCHEDULER=off` never starts it (serverless, or a host where the
 *    external timer owns every job);
 *  - `JOBS_TICK_MS` changes the interval from the 60-second default.
 *
 * Ticks chain with `setTimeout` rather than `setInterval`, so a slow pass can
 * never overlap the next one, and the timer is `unref`d so it never keeps the
 * process alive on its own.
 */
import { getConfig } from '@cls/core/env.server'
import { logger } from '@cls/core/logger'
import { runDueJobs } from './runner.server'

const DEFAULT_INTERVAL_MS = 60_000

/** Give the server a moment to finish booting before the first pass. */
const START_DELAY_MS = 5_000

/** Anything faster than this is a configuration mistake, not a schedule. */
const MIN_INTERVAL_MS = 5_000

let timer: NodeJS.Timeout | undefined
let started = false

function disabled(): boolean {
  if (process.env.NODE_ENV === 'test') return true
  return (process.env.JOBS_SCHEDULER ?? '').toLowerCase() === 'off'
}

function intervalFromEnv(): number {
  const configured = Number(process.env.JOBS_TICK_MS)
  if (!Number.isFinite(configured) || configured < MIN_INTERVAL_MS) return DEFAULT_INTERVAL_MS
  return configured
}

/**
 * Starts the ticker. Idempotent: the first request after boot calls this, and
 * every later request is a no-op.
 */
export function startScheduler(options: { intervalMs?: number } = {}): void {
  if (started || disabled()) return
  started = true

  const intervalMs = options.intervalMs ?? intervalFromEnv()

  const schedule = (delayMs: number): void => {
    timer = setTimeout(() => {
      void tick(intervalMs, schedule)
    }, delayMs)
    // Do not hold the event loop open: the HTTP server already does that.
    timer.unref?.()
  }

  schedule(START_DELAY_MS)

  // The scheduler lock needs the direct endpoint; say so once rather than
  // discovering it when two instances double-send.
  const config = getConfig()
  if (config.databaseUrlUnpooled === config.databaseUrl) {
    logger.warn(
      'job scheduler: DATABASE_URL_UNPOOLED is not set, so the scheduler lock runs on the pooled endpoint',
    )
  }
  logger.info('job scheduler started', { intervalMs })
}

async function tick(intervalMs: number, schedule: (delayMs: number) => void): Promise<void> {
  try {
    const result = await runDueJobs()
    if (!result.acquired) {
      // Another instance owns the schedule. Say so once per pass at debug level.
      logger.debug('job scheduler standby: lock held elsewhere')
    } else if (result.reaped > 0 || result.outcomes.some((outcome) => outcome.status)) {
      logger.info('job scheduler tick', {
        reaped: result.reaped,
        ran: result.outcomes.filter((outcome) => outcome.status).length,
      })
    }
  } catch (error) {
    // A tick that cannot reach Postgres must not kill the timer.
    logger.error('job scheduler tick failed', { error })
  } finally {
    schedule(intervalMs)
  }
}

/** Stops the ticker. Used by tests and by a graceful shutdown hook. */
export function stopScheduler(): void {
  if (timer) clearTimeout(timer)
  timer = undefined
  started = false
}
