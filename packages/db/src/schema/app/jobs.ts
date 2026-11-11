import {
  bigserial,
  check,
  date,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { app } from './base'

/**
 * The background job ledger (`app.job_runs`, ADR 0012 §3).
 *
 * One row per scheduled attempt. `(job_key, scheduled_for)` is unique, which is
 * what turns a double trigger (ticker plus host timer, or two instances) into a
 * no-op instead of a second dunning email. The runner claims a row *before* it
 * executes, so a crashed process leaves a visible `running` row with an expired
 * lease rather than silent work that nobody can see.
 *
 * `scheduled_for` is stored in UTC and `business_date` as the America/Toronto
 * date the slot belongs to (ADR 0012 §7). Weekday and threshold rules read the
 * business date, never the server clock.
 */
export const jobRuns = app.table(
  'job_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Registry key, e.g. `purchasing.po-followup-reminders`. */
    jobKey: text('job_key').notNull(),
    /** The slot the run belongs to, in UTC. */
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    /** `YYYY-MM-DD` in the job's timezone, for weekday and window rules. */
    businessDate: date('business_date', { mode: 'string' }).notNull(),
    /** 1 on the first try, incremented for each retry of the same slot. */
    attempt: integer('attempt').notNull().default(1),
    status: text('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    recordsProcessed: integer('records_processed').notNull().default(0),
    /** Free-form counts and reasons. Never recipient data (ADR 0012 §5). */
    detail: jsonb('detail').$type<Record<string, unknown> | null>(),
    error: text('error'),
    /**
     * Two-minute lease (ADR 0012 §3). A `running` row past its lease was
     * abandoned by a crashed process and is reaped as `failed`.
     */
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('job_runs_key_scheduled_unique').on(table.jobKey, table.scheduledFor),
    index('job_runs_key_started_idx').on(table.jobKey, table.startedAt.desc()),
    index('job_runs_status_lease_idx').on(table.status, table.leaseExpiresAt),
    check(
      'job_runs_status_check',
      sql`${table.status} in ('running', 'succeeded', 'failed', 'skipped', 'missed')`,
    ),
  ],
)

export type JobRun = typeof jobRuns.$inferSelect
export type NewJobRun = typeof jobRuns.$inferInsert
