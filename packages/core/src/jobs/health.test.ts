/**
 * The health reducer behind `/api/health` `jobs` (ADR 0012 §8).
 */
import { describe, expect, test } from 'vitest'
import { jobHealth, type JobHealthRun } from './health'
import { defineJob } from './registry'

const TORONTO = 'America/Toronto'

const daily = defineJob({
  key: 'test.health-daily',
  schedule: '15 7 * * 1-5',
  timezone: TORONTO,
  timeoutMs: 60_000,
  maxAttempts: 3,
  catchUp: 'once',
  concurrency: 1,
  catchUpWindowMs: 6 * 60 * 60_000,
  staleAfterMs: 26 * 60 * 60_000,
})

const weekly = defineJob({
  key: 'test.health-weekly',
  schedule: '0 2 * * 0',
  timezone: TORONTO,
  timeoutMs: 60_000,
  maxAttempts: 3,
  catchUp: 'once',
  concurrency: 1,
  catchUpWindowMs: 24 * 60 * 60_000,
  staleAfterMs: 8 * 24 * 60 * 60_000,
})

const now = new Date('2026-11-16T15:00:00Z')

function run(overrides: Partial<JobHealthRun>): JobHealthRun {
  return {
    jobKey: 'test.health-daily',
    status: 'succeeded',
    scheduledFor: new Date('2026-11-16T12:15:00Z'),
    startedAt: new Date('2026-11-16T12:15:00Z'),
    finishedAt: new Date('2026-11-16T12:15:30Z'),
    ...overrides,
  }
}

describe('jobHealth', () => {
  test('reports a fresh success as healthy', () => {
    const [row] = jobHealth([daily], [run({})], now)
    expect(row?.key).toBe('test.health-daily')
    expect(row?.lastSuccessAt?.toISOString()).toBe('2026-11-16T12:15:30.000Z')
    expect(row?.stale).toBe(false)
    expect(row?.staleAfterMs).toBe(26 * 60 * 60_000)
  })

  test('a job that never succeeded is stale, so a deploy is visible', () => {
    const [row] = jobHealth([weekly], [], now)
    expect(row?.lastSuccessAt).toBeNull()
    expect(row?.stale).toBe(true)
  })

  test('uses finishedAt of the newest success and ignores failures', () => {
    const [row] = jobHealth(
      [daily],
      [
        run({ finishedAt: new Date('2026-11-15T12:16:00Z') }),
        run({ status: 'failed', finishedAt: new Date('2026-11-16T12:16:00Z') }),
        run({ status: 'skipped', finishedAt: new Date('2026-11-16T12:20:00Z') }),
        run({ finishedAt: new Date('2026-11-16T02:16:00Z') }),
      ],
      now,
    )
    expect(row?.lastSuccessAt?.toISOString()).toBe('2026-11-16T02:16:00.000Z')
    expect(row?.stale).toBe(false)
  })

  test('goes stale once the threshold passes', () => {
    // Two days without a success on a daily job.
    const [row] = jobHealth([daily], [run({ finishedAt: new Date('2026-11-14T12:15:00Z') })], now)
    expect(row?.stale).toBe(true)
  })

  test('each job keeps its own threshold, ordered by key', () => {
    const rows = jobHealth(
      [weekly, daily],
      [run({ finishedAt: new Date('2026-11-16T12:15:00Z') })],
      now,
    )
    expect(rows.map((row) => row.key)).toEqual(['test.health-daily', 'test.health-weekly'])
    expect(rows[0]?.stale).toBe(false)
    expect(rows[1]?.stale).toBe(true)
  })

  test('a row that succeeded but was never closed falls back to startedAt', () => {
    const [row] = jobHealth([daily], [run({ finishedAt: null })], now)
    expect(row?.lastSuccessAt?.toISOString()).toBe('2026-11-16T12:15:00.000Z')
  })
})
