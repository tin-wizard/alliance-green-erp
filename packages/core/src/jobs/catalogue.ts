/**
 * The job catalogue (ADR 0012, "Job catalogue to implement").
 *
 * One entry per legacy cron script, with the schedule the ADR specifies in
 * America/Toronto. The catalogue is data: importing it registers the schedules,
 * and each domain module attaches its handler later with one line:
 *
 * ```ts
 * registerJobHandler('purchasing.rga-notifications', rgaNotificationsHandler)
 * ```
 *
 * Until a handler is attached the runner records the run as `skipped` with
 * `{ reason: 'handler_not_registered' }`. That is deliberate: the schedules and
 * the ledger can go live before every domain is written, and the panel shows
 * exactly which ones are still waiting.
 *
 * Timing choices, all from the ADR:
 *  - `catchUp: 'never'` for the jobs that run every few minutes, so a restart
 *    cannot produce a burst of queued work;
 *  - `catchUp: 'once'` for daily and weekly work, with a window wider than a
 *    single tick but far shorter than a day, so a three-day outage sends one
 *    day of reminders and records the rest as `missed`;
 *  - `maxAttempts: 3` with the 1 m / 5 m / 15 m backoff (ADR 0012 §8);
 *  - `staleAfterMs` is when `/api/health` should start complaining, which is
 *    roughly two or three missed intervals rather than one.
 */
import { defineJob, getJob, registerJob } from './registry'
import type { JobDefinition } from './types'

/** The rebuild has one business timezone (ADR 0012 §7). */
const TORONTO = 'America/Toronto'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export const JOB_CATALOGUE: readonly JobDefinition[] = [
  defineJob({
    key: 'platform.notifications-drain',
    schedule: '* * * * *',
    timezone: TORONTO,
    timeoutMs: 60_000,
    maxAttempts: 3,
    catchUp: 'never',
    concurrency: 1,
    catchUpWindowMs: 0,
    staleAfterMs: 15 * MINUTE,
    description: 'Drain the notification outbox, batched with FOR UPDATE SKIP LOCKED.',
    replaces: 'retry_emails.php',
    status: 'awaiting-handler',
  }),
  defineJob({
    key: 'pricing.expire-price-locks',
    schedule: '*/15 * * * *',
    timezone: TORONTO,
    timeoutMs: 2 * MINUTE,
    maxAttempts: 3,
    catchUp: 'never',
    concurrency: 1,
    catchUpWindowMs: 0,
    staleAfterMs: HOUR,
    description: 'Expire stale per-record price locks. TTL is a property of the lock.',
    replaces: 'cron_turn_off_pricelock.php',
    status: 'awaiting-handler',
  }),
  defineJob({
    key: 'work-orders.extract-signoff',
    // Its own lane (ADR 0012 §9): CPU bound, one at a time, ten-minute timeout.
    schedule: '*/10 * * * *',
    timezone: TORONTO,
    timeoutMs: 10 * MINUTE,
    maxAttempts: 3,
    catchUp: 'never',
    concurrency: 1,
    catchUpWindowMs: 0,
    staleAfterMs: 45 * MINUTE,
    description: 'Crop signature images out of scanned sign-offs with sharp.',
    replaces: 'cron-extract-sub-signoff.php',
    status: 'awaiting-handler',
  }),
  defineJob({
    key: 'sage.post-pending',
    schedule: '*/5 * * * *',
    timezone: TORONTO,
    timeoutMs: 2 * MINUTE,
    maxAttempts: 3,
    catchUp: 'never',
    concurrency: 1,
    catchUpWindowMs: 0,
    staleAfterMs: 30 * MINUTE,
    description: 'Push queued Sage postings. Records skipped unless the write gate is new.',
    replaces: 'sageimport_local_submit.php',
    status: 'awaiting-handler',
  }),
  defineJob({
    key: 'sage.keepalive',
    // 03:00 Toronto, after the nightly backup window and before the 06:00 run.
    schedule: '0 3 * * *',
    timezone: TORONTO,
    timeoutMs: 2 * MINUTE,
    maxAttempts: 3,
    catchUp: 'once',
    concurrency: 1,
    catchUpWindowMs: 6 * HOUR,
    staleAfterMs: 26 * HOUR,
    description: 'Refresh the Sage token before it ages, and record a health sample.',
    status: 'registered',
  }),
  defineJob({
    key: 'sage.quota-guard',
    // Every ten minutes: cheap, and it is the check that keeps a month-end
    // posting day from spending the whole daily allowance before 10:00.
    schedule: '*/10 * * * *',
    timezone: TORONTO,
    timeoutMs: MINUTE,
    maxAttempts: 1,
    catchUp: 'never',
    concurrency: 1,
    catchUpWindowMs: 0,
    staleAfterMs: 20 * MINUTE,
    description: 'Read the quota state and pause posting classes that must not spend.',
    status: 'registered',
  }),
  defineJob({
    key: 'sage.poll-external',
    // Daytime only: nothing changes in the books at 03:00 that we need within
    // half an hour. 06:00-20:00 keeps the change feed inside working hours.
    schedule: '*/30 6-20 * * *',
    timezone: TORONTO,
    timeoutMs: 3 * MINUTE,
    maxAttempts: 3,
    catchUp: 'never',
    concurrency: 1,
    catchUpWindowMs: 0,
    staleAfterMs: 45 * MINUTE,
    description: 'Poll updated_or_created_since and deleted_since, classify, and advance watermarks.',
    status: 'registered',
  }),
  defineJob({
    key: 'sage.reconcile',
    // 06:00, before the 07:00 follow-ups, so the day starts with yesterday's verdict.
    schedule: '0 6 * * *',
    timezone: TORONTO,
    timeoutMs: 10 * MINUTE,
    maxAttempts: 2,
    catchUp: 'once',
    concurrency: 1,
    catchUpWindowMs: 6 * HOUR,
    staleAfterMs: 26 * HOUR,
    description: 'Run the six reconciliation checks and record one run row plus findings.',
    status: 'registered',
  }),
  defineJob({
    key: 'sage.probe',
    // The probe is normally triggered once, by hand, straight after consent. The
    // weekly schedule exists so tenant drift (a new tax rate, a stock item
    // appearing) is noticed later without anyone remembering to look.
    schedule: '0 4 * * 0',
    timezone: TORONTO,
    timeoutMs: 5 * MINUTE,
    maxAttempts: 2,
    catchUp: 'once',
    concurrency: 1,
    catchUpWindowMs: 24 * HOUR,
    staleAfterMs: 8 * 24 * HOUR,
    description: 'Probe the tenant: businesses, tax rates, accounts, stock, quota headers. Read only.',
    status: 'registered',
  }),
  defineJob({
    key: 'purchasing.po-followup-reminders',
    schedule: '0 7 * * 1-5',
    timezone: TORONTO,
    timeoutMs: 5 * MINUTE,
    maxAttempts: 3,
    catchUp: 'once',
    concurrency: 1,
    catchUpWindowMs: 6 * HOUR,
    staleAfterMs: 26 * HOUR,
    description: 'Chase purchase orders by status age, legacy weekday thresholds.',
    replaces: 'cron_po_followup_reminders.php',
    status: 'awaiting-handler',
  }),
  defineJob({
    key: 'purchasing.rga-notifications',
    // 07:15 on weekdays, between the PO chase and the compliance sweep.
    schedule: '15 7 * * 1-5',
    timezone: TORONTO,
    timeoutMs: 2 * MINUTE,
    maxAttempts: 3,
    catchUp: 'once',
    concurrency: 1,
    catchUpWindowMs: 6 * HOUR,
    staleAfterMs: 26 * HOUR,
    description: 'Queue RGA notifications. Queues only; sending belongs to the messaging module.',
    replaces: 'cron_rga_notification.php',
    status: 'registered',
  }),
  defineJob({
    key: 'compliance.document-expiry',
    schedule: '30 7 * * *',
    timezone: TORONTO,
    timeoutMs: 2 * MINUTE,
    maxAttempts: 3,
    catchUp: 'once',
    concurrency: 1,
    catchUpWindowMs: 6 * HOUR,
    staleAfterMs: 26 * HOUR,
    description: 'WSIB and insurance expiry reminders, one per document and window.',
    replaces: 'WSIB reminder scripts (see compliance.wsib-reminders)',
    status: 'registered',
  }),
  defineJob({
    key: 'compliance.wsib-reminders',
    schedule: '0 8 * * *',
    timezone: TORONTO,
    timeoutMs: 5 * MINUTE,
    maxAttempts: 3,
    catchUp: 'once',
    concurrency: 1,
    catchUpWindowMs: 6 * HOUR,
    staleAfterMs: 26 * HOUR,
    description: 'WSIB tracks: ten-day warning, just expired, expired.',
    replaces:
      'wsib_reminder_near_expiry.php, wsib_reminder_just_expired.php, wsib_reminder_expired.php',
    status: 'registered',
  }),
  defineJob({
    key: 'quotes.quote-reminders',
    schedule: '30 8 * * 1-5',
    timezone: TORONTO,
    timeoutMs: 5 * MINUTE,
    maxAttempts: 3,
    catchUp: 'once',
    concurrency: 1,
    catchUpWindowMs: 6 * HOUR,
    staleAfterMs: 26 * HOUR,
    description: 'Quote follow-ups.',
    replaces: 'quote_reminder.php',
    status: 'awaiting-handler',
  }),
  defineJob({
    key: 'finance.dunning-reminders',
    schedule: '45 8 * * 1-5',
    timezone: TORONTO,
    timeoutMs: 5 * MINUTE,
    maxAttempts: 3,
    catchUp: 'once',
    concurrency: 1,
    catchUpWindowMs: 6 * HOUR,
    staleAfterMs: 26 * HOUR,
    description: 'One job, three tracks, one send per invoice per track.',
    replaces: 'invoice_reminder.php, overdue_reminder.php, nearoverdue_reminder.php',
    status: 'awaiting-handler',
  }),
  defineJob({
    key: 'dispatch.reminders',
    schedule: '0 9 * * 1-5',
    timezone: TORONTO,
    timeoutMs: 5 * MINUTE,
    maxAttempts: 3,
    catchUp: 'once',
    concurrency: 1,
    catchUpWindowMs: 6 * HOUR,
    staleAfterMs: 26 * HOUR,
    description: 'Dispatch reminders.',
    replaces: 'dispatch_reminder.php',
    status: 'awaiting-handler',
  }),
  defineJob({
    key: 'master-data.import-parts',
    // Sage read, so a long timeout and a dry-run diff before it writes.
    schedule: '30 2 * * *',
    timezone: TORONTO,
    timeoutMs: 15 * MINUTE,
    maxAttempts: 3,
    catchUp: 'once',
    concurrency: 1,
    catchUpWindowMs: 6 * HOUR,
    staleAfterMs: 26 * HOUR,
    description: 'Read parts from Sage. Diff first, then write.',
    replaces: 'cron_import_parts.php',
    status: 'awaiting-handler',
  }),
  defineJob({
    key: 'master-data.import-sites',
    schedule: '0 2 * * 0',
    timezone: TORONTO,
    timeoutMs: 15 * MINUTE,
    maxAttempts: 3,
    catchUp: 'once',
    concurrency: 1,
    // A weekly slot missed by a few hours should still run; a missed week should not.
    catchUpWindowMs: 24 * HOUR,
    staleAfterMs: 8 * 24 * HOUR,
    description: 'Weekly site import from Sage.',
    replaces: 'import_sites_from_sage.php',
    status: 'awaiting-handler',
  }),
  defineJob({
    key: 'master-data.import-subcontractors',
    schedule: '20 2 * * 0',
    timezone: TORONTO,
    timeoutMs: 15 * MINUTE,
    maxAttempts: 3,
    catchUp: 'once',
    concurrency: 1,
    catchUpWindowMs: 24 * HOUR,
    staleAfterMs: 8 * 24 * HOUR,
    description: 'Weekly subcontractor import from Sage.',
    replaces: 'import_subcontracts_from_sage.php',
    status: 'awaiting-handler',
  }),
  defineJob({
    key: 'master-data.site-address-change-check',
    schedule: '0 3 * * *',
    timezone: TORONTO,
    timeoutMs: 5 * MINUTE,
    maxAttempts: 3,
    catchUp: 'once',
    concurrency: 1,
    catchUpWindowMs: 6 * HOUR,
    staleAfterMs: 26 * HOUR,
    description: 'Read-only site address change report plus a notification.',
    replaces: 'cron_check_site_address_change.php',
    status: 'awaiting-handler',
  }),
  defineJob({
    key: 'master-data.site-mall-refresh',
    schedule: '30 3 * * *',
    timezone: TORONTO,
    timeoutMs: 5 * MINUTE,
    maxAttempts: 3,
    catchUp: 'once',
    concurrency: 1,
    catchUpWindowMs: 6 * HOUR,
    staleAfterMs: 26 * HOUR,
    description: 'Refresh site and mall reference data.',
    replaces: 'cron_update_site_mall.php',
    status: 'awaiting-handler',
  }),
  defineJob({
    key: 'inventory.subcontractor-stock',
    schedule: '0 6 * * *',
    timezone: TORONTO,
    timeoutMs: 10 * MINUTE,
    maxAttempts: 3,
    catchUp: 'once',
    concurrency: 1,
    catchUpWindowMs: 6 * HOUR,
    staleAfterMs: 26 * HOUR,
    description: 'Recompute subcontractor stock counters and report drift.',
    replaces: 'cron_sub_stock.php',
    status: 'awaiting-handler',
  }),
  defineJob({
    key: 'platform.retention-activity-log',
    schedule: '0 4 * * *',
    timezone: TORONTO,
    timeoutMs: 5 * MINUTE,
    maxAttempts: 3,
    catchUp: 'once',
    concurrency: 1,
    catchUpWindowMs: 6 * HOUR,
    staleAfterMs: 26 * HOUR,
    description: 'Activity-log retention. Dry run for the first month.',
    replaces: 'cron_delete_old_activity_logs.php',
    status: 'awaiting-handler',
  }),
]

/**
 * Registers every catalogue schedule.
 *
 * Idempotent by inspection rather than by a flag: a key that is already
 * registered is left alone, so the runner can call this at module scope and a
 * test can call it again after `resetRegistryForTests` without a duplicate-key
 * error.
 */
export function registerCatalogueJobs(): readonly JobDefinition[] {
  for (const definition of JOB_CATALOGUE) {
    if (!getJob(definition.key)) registerJob(definition)
  }
  return JOB_CATALOGUE
}

/** The catalogue entry for a key, registered or not. */
export function catalogueEntry(key: string): JobDefinition | undefined {
  return JOB_CATALOGUE.find((definition) => definition.key === key)
}
