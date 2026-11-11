/**
 * Catch-up decisions and retry backoff (ADR 0012 §6, §8). Pure: "now" and the
 * last ledger row are inputs, so no clock and no database are involved.
 */
import { describe, expect, test } from 'vitest'
import { defineJob } from './registry'
import {
  ON_TIME_TOLERANCE_MS,
  RETRY_BACKOFF_MS,
  backoffSequence,
  decideRun,
  retryDelayMs,
  shouldRetry,
} from './schedule'
import type { JobDefinition } from './types'

const TORONTO = 'America/Toronto'

function dailyOnce(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return defineJob({
    key: 'test.daily-once',
    schedule: '15 7 * * 1-5',
    timezone: TORONTO,
    timeoutMs: 60_000,
    maxAttempts: 3,
    catchUp: 'once',
    concurrency: 1,
    catchUpWindowMs: 6 * 60 * 60_000,
    staleAfterMs: 26 * 60 * 60_000,
    ...overrides,
  })
}

function frequentNever(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return defineJob({
    key: 'test.frequent-never',
    schedule: '*/5 * * * *',
    timezone: TORONTO,
    timeoutMs: 60_000,
    maxAttempts: 3,
    catchUp: 'never',
    concurrency: 1,
    catchUpWindowMs: 0,
    staleAfterMs: 30 * 60_000,
    ...overrides,
  })
}

describe('decideRun', () => {
  const slot = new Date('2026-11-16T12:15:00Z') // Monday 07:15 EST

  test('runs a slot that is on time', () => {
    expect(decideRun({ definition: dailyOnce(), now: slot })).toBe('run')
    expect(
      decideRun({ definition: dailyOnce(), now: new Date(slot.getTime() + ON_TIME_TOLERANCE_MS) }),
    ).toBe('run')
  })

  test('catches up a late slot inside the window', () => {
    // 07:20 local, five minutes late, window is six hours.
    expect(decideRun({ definition: dailyOnce(), now: new Date(slot.getTime() + 5 * 60_000) })).toBe(
      'catch_up',
    )
  })

  test('marks a slot missed beyond the window rather than replaying it', () => {
    // 15:00 local, seven hours and forty-five minutes late.
    expect(decideRun({ definition: dailyOnce(), now: new Date('2026-11-16T20:00:00Z') })).toBe(
      'missed',
    )
  })

  test('is not due when the ledger already holds the slot', () => {
    expect(
      decideRun({
        definition: dailyOnce(),
        now: new Date('2026-11-16T12:20:00Z'),
        lastRun: { scheduledFor: slot },
      }),
    ).toBe('not_due')
  })

  test('is not due at the weekend once Friday has run', () => {
    // Saturday 2026-11-14 09:00 EST, Friday s slot is in the ledger.
    expect(
      decideRun({
        definition: dailyOnce(),
        now: new Date('2026-11-14T14:00:00Z'),
        lastRun: { scheduledFor: new Date('2026-11-13T12:15:00Z') },
      }),
    ).toBe('not_due')
  })

  test('a catchUp: never job simply runs its current slot, however late the tick is', () => {
    // 12:07Z: the newest five-minute slot is 12:05Z, so the backlog is dropped
    // and the current slot runs. That is the difference from catch_up: nothing
    // is replayed, and the delay is never reported as a missed day.
    expect(decideRun({ definition: frequentNever(), now: new Date('2026-11-16T12:07:00Z') })).toBe(
      'run',
    )
  })

  test('a catchUp: never job is not due twice for one slot', () => {
    expect(
      decideRun({
        definition: frequentNever(),
        now: new Date('2026-11-16T12:07:00Z'),
        lastRun: { scheduledFor: new Date('2026-11-16T12:05:00Z') },
      }),
    ).toBe('not_due')
  })

  test('the same lateness is catch_up for once and run for never', () => {
    const late = new Date('2026-11-16T12:22:00Z')
    expect(decideRun({ definition: dailyOnce(), now: late })).toBe('catch_up')
    expect(decideRun({ definition: frequentNever(), now: late })).toBe('run')
  })
})

describe('retry backoff', () => {
  test('is one minute, five minutes, then fifteen', () => {
    expect(RETRY_BACKOFF_MS).toEqual([60_000, 300_000, 900_000])
    expect(retryDelayMs(1)).toBe(60_000)
    expect(retryDelayMs(2)).toBe(300_000)
    expect(retryDelayMs(3)).toBe(900_000)
  })

  test('caps at the last entry', () => {
    expect(retryDelayMs(4)).toBe(900_000)
    expect(retryDelayMs(99)).toBe(900_000)
  })

  test('the sequence stops at maxAttempts', () => {
    expect(backoffSequence(3)).toEqual([60_000, 300_000])
    expect(backoffSequence(1)).toEqual([])
  })

  test('shouldRetry counts the failed attempt against the budget', () => {
    expect(shouldRetry(1, 3)).toBe(true)
    expect(shouldRetry(2, 3)).toBe(true)
    expect(shouldRetry(3, 3)).toBe(false)
  })
})
