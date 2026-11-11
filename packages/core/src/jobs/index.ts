/**
 * Background job scheduling (ADR 0012).
 *
 * PURE and shared: the schedule rules, the registry and the catalogue live
 * here, with no database import (`@cls/db` depends on `@cls/core`, so the
 * dependency cannot point the other way). The runner that owns the ledger and
 * the advisory locks is `apps/web/src/modules/jobs/server/runner.server.ts`.
 */
export * from './types'
export {
  CronExpressionError,
  assertTimeZone,
  businessDateFor,
  isOccurrence,
  nextOccurrence,
  parseCron,
  previousOccurrence,
  zonedParts,
  type CronFields,
  type ZonedParts,
} from './cron'
export { JOB_CATALOGUE, catalogueEntry, registerCatalogueJobs } from './catalogue'
export {
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
export {
  ON_TIME_TOLERANCE_MS,
  RETRY_BACKOFF_MS,
  backoffSequence,
  decideRun,
  retryDelayMs,
  shouldRetry,
  type LastRun,
  type RunDecision,
  type RunDecisionInput,
} from './schedule'
export { jobHealth, type JobHealthRun } from './health'
