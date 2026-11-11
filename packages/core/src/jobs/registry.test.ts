/**
 * Registry behaviour: validation, duplicate keys, handler attachment by key,
 * and the awaiting-handler contract (ADR 0012 §2, §4).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  JobDefinitionError,
  UnknownJobError,
  defineJob,
  getJob,
  hasHandler,
  listJobs,
  registerJob,
  registerJobHandler,
  resetRegistryForTests,
  resolveHandler,
  runJob,
} from './registry'
import type { JobContext, JobDefinition } from './types'

const TORONTO = 'America/Toronto'

function definition(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return {
    key: 'test.registry-job',
    schedule: '15 7 * * 1-5',
    timezone: TORONTO,
    timeoutMs: 60_000,
    maxAttempts: 3,
    catchUp: 'once',
    concurrency: 1,
    catchUpWindowMs: 6 * 60 * 60_000,
    staleAfterMs: 26 * 60 * 60_000,
    ...overrides,
  }
}

function context(overrides: Partial<JobContext> = {}): JobContext {
  return {
    db: null,
    runId: 1,
    idempotencyKey: 'test.registry-job:2026-11-16T12:15:00.000Z',
    businessDate: '2026-11-16',
    scheduledFor: new Date('2026-11-16T12:15:00Z'),
    attempt: 1,
    dryRun: false,
    signal: new AbortController().signal,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  }
}

beforeEach(() => {
  resetRegistryForTests()
})

describe('defineJob', () => {
  test('accepts a well-formed definition', () => {
    const job = defineJob(definition())
    expect(job.key).toBe('test.registry-job')
  })

  test('rejects a key that is not dot-scoped', () => {
    expect(() => defineJob(definition({ key: 'NotADotKey' }))).toThrow(/dot-scoped/)
  })

  test('rejects a malformed schedule', () => {
    expect(() => defineJob(definition({ schedule: '15 7 * *' }))).toThrow(JobDefinitionError)
  })

  test('rejects an unknown timezone', () => {
    expect(() => defineJob(definition({ timezone: 'Mars/Olympus' }))).toThrow(JobDefinitionError)
  })

  test('rejects non-positive budgets', () => {
    expect(() => defineJob(definition({ timeoutMs: 0 }))).toThrow(/timeoutMs/)
    expect(() => defineJob(definition({ maxAttempts: 0 }))).toThrow(/maxAttempts/)
    expect(() => defineJob(definition({ staleAfterMs: 0 }))).toThrow(/staleAfterMs/)
  })

  test('rejects an unknown catch-up mode', () => {
    const malformed = { ...definition(), catchUp: 'sometimes' } as unknown as JobDefinition
    expect(() => defineJob(malformed)).toThrow(/catchUp/)
  })

  test('rejects concurrency above one, because the lock is per key', () => {
    const malformed = { ...definition(), concurrency: 2 } as unknown as JobDefinition
    expect(() => defineJob(malformed)).toThrow(/concurrency/)
  })
})

describe('registerJob', () => {
  test('registers once and refuses a duplicate key', () => {
    registerJob(definition())
    expect(getJob('test.registry-job')?.schedule).toBe('15 7 * * 1-5')
    expect(() => registerJob(definition({ timeoutMs: 90_000 }))).toThrow(/already registered/)
  })

  test('lists definitions in key order', () => {
    registerJob(definition({ key: 'test.b-second' }))
    registerJob(definition({ key: 'test.a-first' }))
    expect(listJobs().map((job) => job.key)).toEqual(['test.a-first', 'test.b-second'])
  })
})

describe('handlers', () => {
  test('are attached by key, in one line', () => {
    registerJob(definition())
    const handler = vi.fn(async () => ({ recordsProcessed: 2 }))
    registerJobHandler('test.registry-job', handler)

    expect(resolveHandler('test.registry-job')).toBe(handler)
    expect(hasHandler('test.registry-job')).toBe(true)
  })

  test('cannot be attached twice', () => {
    registerJob(definition())
    registerJobHandler('test.registry-job', async () => ({}))
    expect(() => registerJobHandler('test.registry-job', async () => ({}))).toThrow(
      /already has a handler/,
    )
  })

  test('a definition may carry its handler inline', async () => {
    registerJob(
      definition({
        handler: async () => ({ recordsProcessed: 7, detail: { inline: true } }),
      }),
    )
    const execution = await runJob('test.registry-job', context())
    expect(execution.status).toBe('succeeded')
    expect(execution.recordsProcessed).toBe(7)
    expect(execution.detail).toEqual({ inline: true })
  })
})

describe('runJob', () => {
  test('a job with no handler is skipped, never thrown', async () => {
    registerJob(definition())
    const execution = await runJob('test.registry-job', context())
    expect(execution).toEqual({
      status: 'skipped',
      recordsProcessed: 0,
      detail: { reason: 'handler_not_registered' },
      error: null,
    })
  })

  test('passes the context through and normalises the result', async () => {
    registerJob(definition())
    const seen: JobContext[] = []
    registerJobHandler('test.registry-job', async (ctx) => {
      seen.push(ctx)
      return { status: 'skipped', recordsProcessed: 4, detail: { gate: 'legacy' } }
    })

    const execution = await runJob('test.registry-job', context({ runId: 42 }))

    expect(seen[0]?.runId).toBe(42)
    expect(execution.status).toBe('skipped')
    expect(execution.recordsProcessed).toBe(4)
    expect(execution.detail).toEqual({ gate: 'legacy' })
  })

  test('a handler returning nothing counts as succeeded with no rows', async () => {
    registerJob(definition())
    registerJobHandler('test.registry-job', async () => undefined)
    const execution = await runJob('test.registry-job', context())
    expect(execution).toEqual({
      status: 'succeeded',
      recordsProcessed: 0,
      detail: null,
      error: null,
    })
  })

  test('an unknown key is a programming error', async () => {
    await expect(runJob('test.not-registered', context())).rejects.toBeInstanceOf(UnknownJobError)
  })
})
