/**
 * When to run a job, and how long to wait before trying again (ADR 0012 §6, §8).
 *
 * Pure: the caller supplies "now" and the last ledger row, so every rule here
 * is testable without a clock or a database.
 */
import { previousOccurrence } from './cron'
import type { JobDefinition } from './types'

export type RunDecision = 'run' | 'catch_up' | 'missed' | 'not_due'

/**
 * A slot this close to its scheduled time is on time. One minute matches the
 * ticker interval, so an ordinary tick is never labelled a catch-up.
 */
export const ON_TIME_TOLERANCE_MS = 60_000

/**
 * Retry delays after the first, second and third failed attempt (ADR 0012 §8).
 * The last value repeats if a definition allows more attempts than the table
 * has entries; `maxAttempts` is the real limit.
 */
export const RETRY_BACKOFF_MS: readonly number[] = [60_000, 300_000, 900_000]

export type LastRun = {
  /** The slot the last ledger row belongs to, or null when the job never ran. */
  scheduledFor: Date | null
} | null

export type RunDecisionInput = {
  definition: JobDefinition
  now: Date
  lastRun?: LastRun
}

/**
 * Decides what one tick should do with one job.
 *
 * - `not_due`: the current slot is already accounted for by the ledger.
 * - `run`: the current slot is due and on time.
 * - `catch_up`: the slot is late but inside the catch-up window, so it runs
 *   once and says so in `detail` (never a burst of every missed slot).
 * - `missed`: the slot is late beyond the window; it is recorded and skipped.
 *
 * `catchUp: 'never'` jobs (the every-few-minutes ones) only ever look at the
 * current slot. Because `previousOccurrence` always returns the newest slot at
 * or before `now`, such a job is never late in a way that matters: it runs the
 * current slot and the slots it slept through are simply not missed work.
 */
export function decideRun({ definition, now, lastRun }: RunDecisionInput): RunDecision {
  const slot = previousOccurrence(definition.schedule, definition.timezone, now)
  if (!slot) return 'not_due'

  const covered = lastRun?.scheduledFor
  if (covered && covered.getTime() >= slot.getTime()) return 'not_due'

  const latenessMs = now.getTime() - slot.getTime()
  if (latenessMs <= ON_TIME_TOLERANCE_MS) return 'run'
  if (definition.catchUp === 'never') return 'run'
  if (latenessMs <= definition.catchUpWindowMs) return 'catch_up'
  return 'missed'
}

/**
 * The delay before the next attempt, given the attempt number that just failed.
 * Capped at the last table entry; `maxAttempts` decides when to stop trying.
 */
export function retryDelayMs(attempt: number): number {
  const index = Math.min(Math.max(attempt, 1), RETRY_BACKOFF_MS.length) - 1
  return RETRY_BACKOFF_MS[index] as number
}

/** True when a failed attempt still has an attempt left in the budget. */
export function shouldRetry(attempt: number, maxAttempts: number): boolean {
  return attempt < maxAttempts
}

/** The whole backoff table up to `maxAttempts`, for documentation and tests. */
export function backoffSequence(maxAttempts: number): number[] {
  const delays: number[] = []
  for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
    delays.push(retryDelayMs(attempt))
  }
  return delays
}
