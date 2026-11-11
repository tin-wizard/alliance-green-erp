/**
 * The job registry (ADR 0012 §2).
 *
 * Jobs are code, not rows: a definition is validated once at import time and
 * lives in memory. Handlers are attached separately so a domain module can
 * register one line without owning the schedule:
 *
 * ```ts
 * registerJobHandler('purchasing.rga-notifications', async (ctx) => { ... })
 * ```
 *
 * The registry never touches the database. The runner claims a ledger row,
 * then calls `runJob`, which is why a job that has no handler yet degrades to a
 * recordable `skipped` outcome instead of an exception.
 */
import { assertTimeZone, parseCron, CronExpressionError } from './cron'
import type { JobContext, JobDefinition, JobExecution, JobHandler, JobResult } from './types'

/** A definition is malformed. Thrown at import time, so a bad job cannot ship. */
export class JobDefinitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JobDefinitionError'
  }
}

/** The key is not in the registry: a programming error, not a 404. */
export class UnknownJobError extends Error {
  constructor(key: string) {
    super(`Unknown job '${key}'. Register it with defineJob before running it.`)
    this.name = 'UnknownJobError'
  }
}

const KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/

const definitions = new Map<string, JobDefinition>()
const handlers = new Map<string, JobHandler>()

function requirePositiveInteger(value: number, field: string, key: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new JobDefinitionError(`job '${key}': ${field} must be a positive integer, got ${value}`)
  }
}

/**
 * Validates a definition and returns it unchanged, ready to register.
 *
 * Also refuses a key that is already registered, so two modules cannot quietly
 * disagree about what `platform.notifications-drain` does or when it runs.
 */
export function defineJob(definition: JobDefinition): JobDefinition {
  const { key } = definition
  if (!key || !KEY_PATTERN.test(key)) {
    throw new JobDefinitionError(
      `job key '${key}' must be dot-scoped lower case, e.g. 'purchasing.po-followup-reminders'`,
    )
  }
  if (definitions.has(key)) {
    throw new JobDefinitionError(`job '${key}' is already registered`)
  }
  try {
    parseCron(definition.schedule)
  } catch (error) {
    if (error instanceof CronExpressionError) {
      throw new JobDefinitionError(`job '${key}': ${error.message}`)
    }
    throw error
  }
  try {
    assertTimeZone(definition.timezone)
  } catch (error) {
    if (error instanceof CronExpressionError) {
      throw new JobDefinitionError(`job '${key}': ${error.message}`)
    }
    throw error
  }
  requirePositiveInteger(definition.timeoutMs, 'timeoutMs', key)
  requirePositiveInteger(definition.maxAttempts, 'maxAttempts', key)
  if (definition.catchUp !== 'once' && definition.catchUp !== 'never') {
    throw new JobDefinitionError(`job '${key}': catchUp must be 'once' or 'never'`)
  }
  if (definition.concurrency !== 1) {
    // The per-job advisory lock serialises the job; wider concurrency needs a
    // different design (a claim-per-row queue), not a bigger number.
    throw new JobDefinitionError(`job '${key}': concurrency must be 1`)
  }
  if (!Number.isInteger(definition.catchUpWindowMs) || definition.catchUpWindowMs < 0) {
    throw new JobDefinitionError(`job '${key}': catchUpWindowMs must be a whole number of ms`)
  }
  requirePositiveInteger(definition.staleAfterMs, 'staleAfterMs', key)
  if (
    definition.status !== undefined &&
    definition.status !== 'registered' &&
    definition.status !== 'awaiting-handler'
  ) {
    throw new JobDefinitionError(`job '${key}': status must be 'registered' or 'awaiting-handler'`)
  }
  return { ...definition }
}

/** Validates and registers a definition. A duplicate key throws. */
export function registerJob(definition: JobDefinition): JobDefinition {
  const validated = defineJob(definition)
  definitions.set(validated.key, validated)
  if (validated.handler) handlers.set(validated.key, validated.handler)
  return validated
}

/**
 * Attaches a handler to a registered (or catalogue) job.
 *
 * This is the one line a domain module needs. Registering twice for the same
 * key throws, because two handlers for one schedule is a merge mistake, not a
 * configuration.
 */
export function registerJobHandler(key: string, handler: JobHandler): void {
  if (typeof handler !== 'function') {
    throw new JobDefinitionError(`job '${key}': handler must be a function`)
  }
  if (handlers.has(key)) {
    throw new JobDefinitionError(`job '${key}' already has a handler registered`)
  }
  handlers.set(key, handler)
}

export function getJob(key: string): JobDefinition | undefined {
  return definitions.get(key)
}

/** Every registered definition, ordered by key so output is reproducible. */
export function listJobs(): JobDefinition[] {
  return [...definitions.values()].sort((left, right) => left.key.localeCompare(right.key))
}

/** The attached handler, falling back to the one on the definition. */
export function resolveHandler(key: string): JobHandler | undefined {
  return handlers.get(key) ?? definitions.get(key)?.handler
}

export function hasHandler(key: string): boolean {
  return resolveHandler(key) !== undefined
}

function normaliseResult(result: JobResult | void): JobExecution {
  if (!result) {
    return { status: 'succeeded', recordsProcessed: 0, detail: null, error: null }
  }
  const status = result.status === 'skipped' ? 'skipped' : 'succeeded'
  const records = result.recordsProcessed
  const recordsProcessed =
    records === undefined || !Number.isInteger(records) || records < 0 ? 0 : records
  return {
    status,
    recordsProcessed,
    detail: result.detail ?? null,
    error: null,
  }
}

/**
 * Runs one attempt of a job.
 *
 * A missing handler is a `skipped` outcome with `handler_not_registered` in
 * `detail`, never a throw: the catalogue can ship before its domains, and the
 * ledger should say "nothing to do yet" rather than "the scheduler is broken".
 */
export async function runJob(key: string, context: JobContext): Promise<JobExecution> {
  if (!definitions.has(key)) throw new UnknownJobError(key)
  const handler = resolveHandler(key)
  if (!handler) {
    return {
      status: 'skipped',
      recordsProcessed: 0,
      detail: { reason: 'handler_not_registered' },
      error: null,
    }
  }
  return normaliseResult(await handler(context))
}

/** Test helper: forget everything registered so far. */
export function resetRegistryForTests(): void {
  definitions.clear()
  handlers.clear()
}
