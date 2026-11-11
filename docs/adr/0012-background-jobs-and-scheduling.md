# ADR 0012 — Background jobs and scheduling

- **Status:** Accepted
- **Date:** 2026-11-11
- **Owners:** Platform
- **Repo target:** `packages/core/src/jobs/` (runner + registry), `packages/db/src/schema/app/jobs.ts`
  (`app.job_runs`), `apps/web/src/routes/api/internal/jobs/$key.ts` (trigger)
- **Relates to:** ADR 0002 (single local process), ADR 0013 (notifications), ADR 0005 (Sage adapter),
  `plan/CUTOVER-AND-MIGRATION.md` §4 (Sage single-writer gate)

> **Post-D18 amendment (2026-11-11).** The rebuild now runs in the cloud (ADR 0014). The scheduler
> collection is unchanged — registry in code, `app.job_runs` ledger, per-job advisory locks,
> bounded catch-up, authenticated trigger — but the *wake-up* changes: a serverless platform has no
> resident process, so a platform cron calls the trigger route and the in-process ticker is only
> used on a long-lived Node host. "One instance owns the schedule" becomes "one environment holds
> the scheduler lease", enforced by the same Postgres advisory lock. Any handler that assumed a
> `setInterval` timer, process memory surviving between runs, or a local filesystem must be
> rewritten to read and write state in Postgres.

## Context

The legacy system schedules its background work as nine PHP scripts on the host's crontab, plus a
second group of scheduled scripts that never made it into the documented nine
(`green-system/MODULES.md` §16):

| Legacy script | Purpose |
|---|---|
| `cron_turn_off_pricelock.php` | release the global parts price lock |
| `cron_import_parts.php` | read parts from Sage |
| `cron_sub_stock.php` | recompute subcontractor stock counters |
| `cron_po_followup_reminders.php` | chase purchase orders by status age |
| `cron_rga_notification.php` | notify on RGAs |
| `cron_check_site_address_change.php` | detect site address changes |
| `cron_update_site_mall.php` | refresh site/mall data |
| `cron_delete_old_activity_logs.php` | retention |
| `cron-extract-sub-signoff.php` | crop signature images out of scanned sign-offs |
| `wsib_reminder_near_expiry.php`, `wsib_reminder_just_expired.php`, `wsib_reminder_expired.php` | WSIB dunning |
| `invoice_reminder.php`, `overdue_reminder.php`, `nearoverdue_reminder.php` | accounts-receivable dunning |
| `quote_reminder.php`, `dispatch_reminder.php` | sales and dispatch reminders |
| `retry_emails.php` | drain the file-based email failure queue |
| `import_sites_from_sage.php`, `import_subcontracts_from_sage.php` | Sage reads |

Four properties of that arrangement cause real failures, and each one has to be answered by the
rebuild rather than copied:

1. **Every script is reachable by URL and checks nothing.** There is no login check, no secret, no
   method check. Anyone on the network can trigger dunning emails or a full parts import by
   fetching a path.
2. **Run history is a write-only table.** `cron_run_history` records that a script ran, but nothing
   reports a *missed* run. A dead cron is discovered when a customer complains about an unpaid
   invoice.
3. **Time is the host's local clock.** The PO reminder thresholds deliberately differ on Monday from
   other weekdays and skip weekends; they are computed from "today" with no timezone in sight.
4. **Work is coupled to the web request.** Sign-off extraction shells out to ImageMagick, and the
   price-lock release assumes a single mutable global row (`parts_price_lock`, id 1) whose comment
   says "nightly 11pm" while the code releases any lock older than one hour — a documented
   contradiction, not a rule to preserve.

The rebuild is one Node process on the LAN host (ADR 0002), so the runner cannot assume a job
server, a queue daemon, or a second machine. Postgres is the only shared, transactional state
available.

## Decision

1. **One in-process scheduler, no worker process and no queue daemon.** The server starts a ticker
   that wakes every 60 seconds. It holds `pg_try_advisory_lock(hashtext('cls:scheduler'))` on a
   dedicated connection for the life of the process. A second process (during a restart overlap, or
   if someone runs a second instance) does not get the lock and acts as standby; it runs nothing and
   exposes no trigger endpoint behaviour beyond a `409`.

2. **Jobs are code, not rows.** A single registry defines each job:

   ```ts
   interface JobDefinition {
     key: string                    // 'purchasing.po-followup-reminders'
     schedule: string               // cron, evaluated in America/Toronto
     timezone: 'America/Toronto'
     timeoutMs: number
     maxAttempts: number
     catchUp: 'once' | 'never'      // see 6
     concurrency: 1                 // enforced by a per-job advisory lock
     handler: (ctx: JobContext) => Promise<JobResult>
   }
   ```

   `JobContext` carries the database handle, idempotency key, run id, business date, a logger, and
   `dryRun`. Handlers are plain functions with their own unit tests. There is no code in the
   database, no cron file on disk, and no shelling out.

3. **The run ledger replaces `cron_run_history`.** `app.job_runs` records one row per scheduled
   attempt: `job_key`, `scheduled_for` (timestamptz), `business_date` (date, America/Toronto),
   `attempt`, `status` (`running | succeeded | failed | skipped | missed`), `started_at`,
   `finished_at`, `records_processed`, `detail` (jsonb), `error`. A unique index on
   `(job_key, scheduled_for)` makes a double trigger a no-op instead of a double send.

4. **Every handler is idempotent and declares its domain key.** The reminder jobs already do this:
   compliance expiry dedupes on the document and the window, PO follow-ups dedupe on the day. A
   handler that cannot state an idempotency key is not allowed on the schedule; it has to be a
   manual, audit-logged action. Handlers may queue notifications, and may not send them (ADR 0013).

5. **One trigger path, two ways to reach it.** `POST /api/internal/jobs/<key>` with header
   `x-job-secret: JOB_RUNNER_SECRET`, modelled on the existing
   `/api/cron/compliance-expiry` route (`x-cron-secret`, `503` when unset, `403` on mismatch,
   `no-store`). The host timer (Windows Task Scheduler or a systemd timer) calls it for the daily
   jobs, so a wedged ticker cannot silently stop dunning. Both paths take the same per-job advisory
   lock and write the same ledger row; a double call returns `202` with `alreadyRunning` or a
   `409`, never a second execution. Responses carry counts and the run id, no recipient data.

6. **Catch-up is bounded.** If the process was down past a job's scheduled time, the job runs once
   with `catchUp: true` when it is within a per-job grace window, otherwise the missed slot is
   recorded as `missed` and skipped. There is no replay of every missed day: a three-day outage
   must not send three days of reminders in a burst.

7. **Time is a business date, not a timestamp.** Schedules and weekday rules are evaluated in
   `America/Toronto` (DST-aware). `scheduled_for` is stored UTC, `business_date` is stored as the
   local date. The PO reminder job keeps the legacy thresholds (challenged 4/3 days, approved 5/4,
   submitted 5/4, in transit 9/8, active and partial from expected delivery ≥1, Monday variants,
   weekends skipped) because they are business policy, and it keeps the
   `last_followup_reminder_date` semantics as a per-PO dedupe key rather than re-deriving them.

8. **Retries are per attempt, with backoff.** `maxAttempts` defaults to 3 with 1 m, 5 m, 15 m
   backoff. After the last attempt the run is `failed`, the error is visible in the admin job panel,
   and `/api/health` reports `jobs: { key, lastSuccessAt, stale }` with a per-job staleness
   threshold. A failing job does not take the app down; the legacy `under_maintenance.php` reflex is
   not reproduced.

9. **Expensive jobs get their own lane.** Sign-off extraction is CPU bound and runs with
   `concurrency: 1`, a 10-minute timeout, and `sharp` instead of an ImageMagick shell-out. A
   timeout leaves the work item untouched and recorded so the next run retries it; marker rows are
   advanced only after the output object is stored, which is the same rule the cutover harness uses
   for partial failure.

10. **The price-lock job does not reproduce the global row.** Locks are per-record rows with
    `owner_user_id`, `acquired_at` and `expires_at`. A sweeper job expires stale locks and the UI
    shows a stale-lock badge with the owner's name. A one-hour expiry is a property of the lock, not
    a nightly 11 pm ritual, and no cron is load-bearing for correctness.

11. **Sage work is gated inside the job.** Sage writes refuse and record `skipped` unless the Sage
    write gate is `new` (`plan/CUTOVER-AND-MIGRATION.md` §4). Sage reads are allowed while the
    adapter health is `verified`. A job never becomes a way to bypass the single-writer decision.

### Job catalogue to implement

| Job key | Schedule (America/Toronto) | Replaces | Notes |
|---|---|---|---|
| `platform.notifications-drain` | every minute | `retry_emails.php` | ADR 0013; batched, `FOR UPDATE SKIP LOCKED` |
| `pricing.expire-price-locks` | every 15 min | `cron_turn_off_pricelock.php` | per-record TTL |
| `work-orders.extract-signoff` | every 10 min | `cron-extract-sub-signoff.php` | concurrency 1, `sharp` |
| `sage.post-pending` | every 5 min | `sageimport_local_submit.php` | skipped unless gate `new` |
| `purchasing.po-followup-reminders` | 07:00 weekdays | `cron_po_followup_reminders.php` | legacy weekday thresholds |
| `purchasing.rga-notifications` | 07:15 weekdays | `cron_rga_notification.php` | queues notifications |
| `compliance.document-expiry` | 07:30 daily | WSIB reminder scripts | already implemented; needs the scheduler |
| `compliance.wsib-reminders` | 08:00 daily | `wsib_reminder_*.php` | 10-day, just-expired, expired tracks |
| `quotes.quote-reminders` | 08:30 weekdays | `quote_reminder.php` | |
| `finance.dunning-reminders` | 08:45 weekdays | `invoice_reminder.php`, `overdue_reminder.php`, `nearoverdue_reminder.php` | one job, three tracks, one send per invoice per track |
| `dispatch.reminders` | 09:00 weekdays | `dispatch_reminder.php` | |
| `master-data.import-parts` | 02:30 daily | `cron_import_parts.php` | Sage read, dry-run diff first |
| `master-data.import-sites` | Sun 02:00 | `import_sites_from_sage.php` | weekly |
| `master-data.import-subcontractors` | Sun 02:20 | `import_subcontracts_from_sage.php` | weekly |
| `master-data.site-address-change-check` | 03:00 daily | `cron_check_site_address_change.php` | read-only report + notification |
| `master-data.site-mall-refresh` | 03:30 daily | `cron_update_site_mall.php` | |
| `inventory.subcontractor-stock` | 06:00 daily | `cron_sub_stock.php` | recompute + drift report |
| `platform.retention-activity-log` | 04:00 daily | `cron_delete_old_activity_logs.php` | dry-run for the first month |

## Alternatives considered

1. **BullMQ/Agenda with Redis.** A queue daemon on a Windows LAN host for a handful of daily jobs is
   a second process, a second failure mode and a second backup to forget. Postgres is already
   there, transactional and backed up.
2. **A separate worker process.** ADR 0002 rejected it and nothing has changed: the load is trivial
   and the host is one machine. The advisory lock keeps the door open for a second process later.
3. **A real crontab/cron file.** Windows has no cron, the two supported host platforms would then
   have two different definitions, and the parsing is exactly the sort of shell dependency the
   rebuild is removing. The host timer calling an authenticated HTTP endpoint is the portable form.
4. **Keep job definitions in a table so an admin can edit schedules.** It sounds flexible and is a
   way to run unversioned code against production with no review. Schedules change rarely; a code
   change and a deploy are the correct cost.
5. **Replay every missed slot on restart.** Correct-looking, and wrong: it turns a ten-minute
   restart into a burst of duplicate reminder emails. Bounded catch-up plus idempotent handlers is
   sufficient.
6. **Reproduce the hourly global price-lock reset.** It is a documented defect (comment and code
   disagree) and a global row is the reason one editor can unlock another's quote. Per-record locks
   with an expiry sweeper carry the intent without the coupling.

## Consequences

- **Positive:** no background endpoint is reachable without a secret, and a trigger cannot be
  replayed into a duplicate send.
- **Positive:** run history is queryable, so "did the reminder job run" is a query rather than a
  support call, and a stale job shows on the health endpoint.
- **Positive:** the same handler runs from the ticker, the host timer and a manual admin action,
  which is also how the cutover rehearsal drives it.
- **Negative:** one process owns the schedule. A crash stops jobs until the process manager
  restarts it, which is why the host timer is part of the design rather than a nicety.
- **Negative:** `app.job_runs` grows forever; retention follows the activity-log job, with `detail`
  trimmed after 90 days and the row kept for the audit trail.
- **Negative:** `JOB_RUNNER_SECRET` is a new secret and a new operational obligation (set it, do not
  commit it, rotate it with the others).
- **Risk:** two instances started by hand share one database. Without the advisory lock they would
  double-send; the lock and the `(job_key, scheduled_for)` unique index are what make that safe.

## Verification

- Unit tests: cron resolution across a DST boundary in `America/Toronto`; the Monday-vs-weekday PO
  threshold table; catch-up `once` vs `never`; backoff sequence; timeout leaves no partial state.
- Integration tests on a scratch database: a handler running twice for the same
  `(job_key, scheduled_for)` yields one ledger row and no duplicate domain rows; two runners
  contending for the scheduler lock, only one executes; a trigger with a missing or wrong secret
  returns `403`, an unset secret returns `503`.
- `/api/health` reports each registered job with `lastSuccessAt` and `stale`, and a stale job is
  visible without reading logs.
- The cutover rehearsal (`plan/CUTOVER-AND-MIGRATION.md` §2) runs the import and parity jobs through
  this runner in `dryRun` before any scheduled job is enabled in production.
