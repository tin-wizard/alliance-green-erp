/**
 * The migration harness's own schema (`migration`), separate from `app`.
 *
 * `plan/CUTOVER-AND-MIGRATION.md` §2.2 defines these tables; §2.7's promotion flag
 * and §6's invitation queue are added here because both need durable state, not
 * a printed checklist. Nothing in the running application reads `migration.*`
 * except the harness and the cutover controller.
 */
import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const migration = pgSchema('migration')

export const migrationRuns = migration.table(
  'runs',
  {
    runId: uuid('run_id').primaryKey().defaultRandom(),
    dumpId: text('dump_id').notNull(),
    /** master-data | work-orders | quotes | ... (the group name). */
    module: text('module').notNull(),
    /** load | normalise | transform | reconcile | verify */
    phase: text('phase').notNull(),
    /** running | passed | failed | blocked | needs_review */
    status: text('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    sourceRows: bigint('source_rows', { mode: 'number' }).notNull().default(0),
    transformedRows: bigint('transformed_rows', { mode: 'number' }).notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    manifestVersion: text('manifest_version').notNull(),
    gitSha: text('git_sha').notNull().default('unknown'),
    details: jsonb('details').$type<Record<string, unknown> | null>(),
  },
  (table) => [index('migration_runs_dump_idx').on(table.dumpId, table.module)],
)

export const migrationDumpObjects = migration.table(
  'dump_objects',
  {
    dumpId: text('dump_id').notNull(),
    tableName: text('table_name').notNull(),
    engine: text('engine').notNull(),
    sourceRows: bigint('source_rows', { mode: 'number' }),
    stagedRows: bigint('staged_rows', { mode: 'number' }),
    checksum: text('checksum'),
    loadedAt: timestamp('loaded_at', { withTimezone: true }),
    /** loaded | skipped_dated_duplicate | missing | failed */
    status: text('status').notNull().default('loaded'),
    note: text('note'),
  },
  (table) => [primaryKey({ columns: [table.dumpId, table.tableName] })],
)

export const migrationRowMap = migration.table(
  'row_map',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** customer | site | work_order | quote | po | ... */
    entity: text('entity').notNull(),
    sourceTable: text('source_table').notNull(),
    sourceKey: text('source_key').notNull(),
    targetTable: text('target_table').notNull(),
    targetKey: text('target_key').notNull(),
    dumpId: text('dump_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('migration_row_map_unique').on(table.entity, table.sourceTable, table.sourceKey),
    index('migration_row_map_target_idx').on(table.targetTable, table.targetKey),
  ],
)

export const migrationCheckpoints = migration.table(
  'checkpoints',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => migrationRuns.runId, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    lastSourceKey: text('last_source_key'),
    batchNo: integer('batch_no').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.entity] })],
)

export const migrationErrors = migration.table(
  'errors',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => migrationRuns.runId, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    sourceKey: text('source_key'),
    errorCode: text('error_code').notNull(),
    message: text('message').notNull(),
    payloadHash: text('payload_hash'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: text('resolution'),
  },
  (table) => [index('migration_errors_run_idx').on(table.runId, table.entity)],
)

export const migrationExceptions = migration.table(
  'exceptions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    exceptionClass: text('exception_class').notNull(),
    entity: text('entity').notNull(),
    sourceKey: text('source_key').notNull(),
    rowCount: bigint('row_count', { mode: 'number' }).notNull().default(1),
    migrationAction: text('migration_action').notNull(),
    /** pending | accepted | fixed | excluded */
    decision: text('decision').notNull().default('pending'),
    owner: text('owner'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (table) => [
    unique('migration_exceptions_unique').on(table.exceptionClass, table.entity, table.sourceKey),
    index('migration_exceptions_open_idx').on(table.decision, table.exceptionClass),
  ],
)

/** §2.7's promotion flag, made physical. A module not `passed` cannot be enabled. */
export const migrationModules = migration.table('modules', {
  module: text('module').primaryKey(),
  /** passed | failed | needs_review | blocked */
  status: text('status').notNull(),
  runId: uuid('run_id'),
  approvedBy: text('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** §6's invitation queue: hashes only, never a token or a password. */
export const migrationUserInvites = migration.table(
  'user_invites',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    legacyId: integer('legacy_id').notNull(),
    /** unique-email | shared-email | no-email | disabled | duplicate-username | orphan-vendor */
    cohort: text('cohort').notNull(),
    emailHash: text('email_hash'),
    tokenHash: text('token_hash'),
    /** pending | ready | sent | claimed | disabled | blocked */
    state: text('state').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('migration_user_invites_legacy_unique').on(table.legacyId)],
)

/** The manifest a run used, so a report can be reproduced from the dump alone. */
export const migrationDumpManifests = migration.table('dump_manifests', {
  dumpId: text('dump_id').primaryKey(),
  manifestVersion: text('manifest_version').notNull(),
  tableCount: integer('table_count').notNull(),
  checksum: text('checksum'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().default(sql`now()`),
  details: jsonb('details').$type<Record<string, unknown> | null>(),
})

export type MigrationRunRow = typeof migrationRuns.$inferSelect
export type MigrationExceptionRow = typeof migrationExceptions.$inferSelect
export type MigrationRowMapRow = typeof migrationRowMap.$inferSelect
