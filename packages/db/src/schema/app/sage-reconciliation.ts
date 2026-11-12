/**
 * Reconciliation and probe state.
 *
 * `app.sage_reconciliation_runs` and `..._findings` are the artefact the finance
 * owner signs: a run is one row, every difference is a row with a decision field
 * that starts `open` and ends with a human's name against it.
 *
 * `app.sage_sync_state` is the watermark per polled resource. It advances only
 * after a batch is fully applied, so a failed poll re-reads the same window.
 *
 * `app.sage_probe_reports` stores the tenant capsule from `SAGE-CLOUD.md` §1.4
 * step 9: evidence, with a timestamp and the environment it was taken in.
 */
import {
  bigserial,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { app } from './base'

export const sageReconciliationRuns = app.table(
  'sage_reconciliation_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** daily | cutover | manual */
    mode: text('mode').notNull(),
    /** Cutover runs only: the signed baseline both phases compare against. */
    baselineId: text('baseline_id'),
    /** Cutover runs only: documents | allocations. */
    phase: text('phase'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** running | passed | failed | error */
    status: text('status').notNull().default('running'),
    docCount: integer('doc_count').notNull().default(0),
    moneyTotal: numeric('money_total', { precision: 14, scale: 2 }),
    findings: integer('findings').notNull().default(0),
    blockers: integer('blockers').notNull().default(0),
    warnings: integer('warnings').notNull().default(0),
    /** Why an `error` run could not compare anything. */
    error: text('error'),
    /**
     * Cutover runs only: the sum of tolerated legacy tax differences. This is
     * the number the finance owner signs; it is never zeroed or normalised.
     */
    divergenceTotal: numeric('divergence_total', { precision: 14, scale: 2 }),
    /** Who accepted the divergence, and with what words. */
    // No FK, for the same reason `decided_by` has none: app.users lives in
    // app.ts and referencing it from a submodule would import the barrel that
    // imports this file.
    signedBy: uuid('signed_by'),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    signedNote: text('signed_note'),
    report: jsonb('report').$type<Record<string, unknown> | null>(),
  },
  (table) => [
    index('sage_reconciliation_runs_started_idx').on(sql`${table.startedAt} desc`),
    index('sage_reconciliation_runs_status_idx').on(table.status, table.startedAt),
  ],
)

export const sageReconciliationFindings = app.table(
  'sage_reconciliation_findings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: integer('run_id')
      .notNull()
      .references(() => sageReconciliationRuns.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    /** blocker | warning | info */
    severity: text('severity').notNull(),
    docType: text('doc_type'),
    docId: text('doc_id'),
    externalRef: text('external_ref'),
    contactId: text('contact_id'),
    expected: numeric('expected', { precision: 14, scale: 2 }),
    actual: numeric('actual', { precision: 14, scale: 2 }),
    detail: jsonb('detail').$type<Record<string, unknown> | null>(),
    /** platform | finance | module-owner */
    owner: text('owner').notNull(),
    /** open | accepted | fixed_externally | excluded */
    decision: text('decision').notNull().default('open'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by'),
  },
  (table) => [
    index('sage_reconciliation_findings_run_idx').on(table.runId),
    index('sage_reconciliation_findings_code_idx').on(table.code, table.decision),
  ],
)

export const sageSyncState = app.table('sage_sync_state', {
  resource: text('resource').primaryKey(),
  watermark: timestamp('watermark', { withTimezone: true }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastError: text('last_error'),
})

export const sageProbeReports = app.table(
  'sage_probe_reports',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    environment: text('environment').notNull(),
    businessId: text('business_id'),
    businessName: text('business_name'),
    /** passed | attention */
    status: text('status').notNull(),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    report: jsonb('report').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [index('sage_probe_reports_run_idx').on(sql`${table.runAt} desc`)],
)

export type SageReconciliationRunRow = typeof sageReconciliationRuns.$inferSelect
export type SageReconciliationFindingRow = typeof sageReconciliationFindings.$inferSelect
export type SageProbeReportRow = typeof sageProbeReports.$inferSelect
