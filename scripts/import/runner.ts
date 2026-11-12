/**
 * The loader and the transform runner.
 *
 * Load: every manifest table goes into `migration.stg_<table>` as text, with a
 * row hash and a per-table checksum, recorded in `migration.dump_objects`.
 *
 * Transform: rows are replayed in dump order per entity, batched and
 * checkpointed, one advisory lock per entity, one savepoint per row. A bad row
 * becomes a `migration.errors` row and the batch continues; the entity ends
 * `needs_review`, never `passed`. Nothing is ever deleted from `app`.
 */
import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { Db, Tx } from '@cls/db'
import {
  migrationCheckpoints,
  migrationDumpObjects,
  migrationDumpManifests,
  migrationErrors,
  migrationExceptions,
  migrationModules,
  migrationRuns,
} from '@cls/db/schema'
import { ALL_TABLES, GROUPS, MANIFEST_VERSION, SKIPPED_DATED_DUPLICATES, stagingTable, type ManifestGroup, type ManifestTable } from './manifest'
import { createHelpers } from './helpers'
import type { GroupTransformer, LegacySource, SourceTable } from './types'
import legacy from './legacy-schema.json' with { type: 'json' }

const BATCH_SIZE = 1_000

const legacyTables = (legacy as { tables: Record<string, { columns: { name: string }[] }> }).tables

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Canonical JSON so a row hash does not depend on column iteration order. */
export function rowHash(values: Record<string, string | null>): string {
  const sorted = Object.keys(values)
    .sort()
    .map((key) => [key, values[key]] as const)
  return sha256(JSON.stringify(sorted))
}

export function sourceKey(table: ManifestTable, values: Record<string, string | null>): string {
  const keys = table.primaryKey.length > 0 ? table.primaryKey : ['_row_no']
  const parts = keys.map((key) => values[key] ?? '')
  if (parts.every((part) => part === '')) {
    return `row:${values._row_no ?? ''}`
  }
  return parts.join('|')
}

export interface LoadReport {
  dumpId: string
  tables: Array<{ table: string; rows: number; checksum: string; status: string }>
  skipped: string[]
  missing: string[]
  totalRows: number
}

/**
 * Load every manifest table into staging.
 *
 * Idempotent for the same dump: rows are replaced, not appended, because the
 * dump id is part of the staging primary key.
 */
export async function loadSource(
  db: Db,
  source: LegacySource,
  dumpId: string,
): Promise<LoadReport> {
  const available = new Set(await source.listTables())
  const report: LoadReport = { dumpId, tables: [], skipped: [], missing: [], totalRows: 0 }
  const objects: Array<typeof migrationDumpObjects.$inferInsert> = []

  await db
    .insert(migrationDumpManifests)
    .values({
      dumpId,
      manifestVersion: MANIFEST_VERSION,
      tableCount: ALL_TABLES.length,
      details: { groups: GROUPS.map((group) => ({ name: group.name, tables: group.tables.length })) },
    })
    .onConflictDoUpdate({
      target: migrationDumpManifests.dumpId,
      set: { manifestVersion: MANIFEST_VERSION, tableCount: ALL_TABLES.length },
    })

  for (const table of ALL_TABLES) {
    const engine = (legacyTables[table.table] as { engine?: string } | undefined)?.engine ?? 'unknown'
    if (!available.has(table.table)) {
      report.missing.push(table.table)
      objects.push({
        dumpId,
        tableName: table.table,
        engine,
        sourceRows: null,
        stagedRows: 0,
        checksum: null,
        status: 'missing',
        note: 'absent from the source',
        loadedAt: new Date(),
      })
      continue
    }
    const loaded = await source.readTable(table.table)
    const checksum = await stageTable(db, dumpId, loaded)
    report.tables.push({ table: table.table, rows: loaded.rows.length, checksum, status: 'loaded' })
    report.totalRows += loaded.rows.length
    objects.push({
      dumpId,
      tableName: table.table,
      engine,
      sourceRows: loaded.rows.length,
      stagedRows: loaded.rows.length,
      checksum,
      status: 'loaded',
      note: null,
      loadedAt: new Date(),
    })
  }

  // Dated duplicates are recorded as skipped: their absence from staging is a
  // decision with a reason, not an oversight.
  for (const skipped of SKIPPED_DATED_DUPLICATES) {
    if (!available.has(skipped)) continue
    report.skipped.push(skipped)
    objects.push({
      dumpId,
      tableName: skipped,
      engine: 'unknown',
      sourceRows: null,
      stagedRows: 0,
      checksum: null,
      status: 'skipped_dated_duplicate',
      note: 'frozen copy taken before a mass edit; never migrated',
      loadedAt: new Date(),
    })
  }

  // One round trip for the whole table inventory: a real dump has ~175 tables
  // and the loader's speed must not scale with the network's latency.
  for (let offset = 0; offset < objects.length; offset += 100) {
    await db
      .insert(migrationDumpObjects)
      .values(objects.slice(offset, offset + 100))
      .onConflictDoUpdate({
        target: [migrationDumpObjects.dumpId, migrationDumpObjects.tableName],
        set: {
          sourceRows: sql`excluded.source_rows`,
          stagedRows: sql`excluded.staged_rows`,
          checksum: sql`excluded.checksum`,
          status: sql`excluded.status`,
          note: sql`excluded.note`,
          loadedAt: sql`excluded.loaded_at`,
        },
      })
  }

  return report
}

async function stageTable(db: Db, dumpId: string, table: SourceTable): Promise<string> {
  const staging = stagingTable(table.table)
  const columns = table.columns
  const hashes: string[] = []

  await db.execute(
    sql`delete from ${sql.raw(`migration."${staging}"`)} where "_dump_id" = ${dumpId}`,
  )

  for (const row of table.rows) {
    const values: Record<string, string | null> = {}
    for (const column of columns) values[column] = row.values[column] ?? null
    const hash = rowHash(values)
    hashes.push(hash)

    const names = ['_row_no', '_source_pk', '_row_hash', '_dump_id', ...columns]
    const manifestTable = ALL_TABLES.find((entry) => entry.table === table.table)
    const key = manifestTable
      ? sourceKey(manifestTable, { ...values, _row_no: String(row.rowNo) })
      : String(row.rowNo)
    const params: Array<string | number | null> = [
      row.rowNo,
      key,
      hash,
      dumpId,
      ...columns.map((column) => values[column] ?? null),
    ]
    const insert = sql`insert into ${sql.raw(`migration."${staging}"`)} (${sql.raw(
      names.map((name) => `"${name}"`).join(', '),
    )}) values (${sql.join(
      params.map((param) => sql`${param}`),
      sql`, `,
    )})`
    await db.execute(insert)
  }

  return sha256(hashes.join('\n'))
}

export interface TransformReport {
  group: string
  entities: Array<{
    entity: string
    sourceRows: number
    transformed: number
    errors: number
    status: string
  }>
  status: 'passed' | 'needs_review' | 'blocked'
}

/** Loads a group's transformer, or refuses when it has not been written yet. */
export async function loadGroupTransformer(group: ManifestGroup): Promise<GroupTransformer | null> {
  if (!group.transformer) return null
  try {
    const module = (await import(`./groups/${group.transformer}.ts`)) as {
      transformer?: GroupTransformer
    }
    return module.transformer ?? null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('Cannot find module')) return null
    throw error
  }
}

export interface TransformOptions {
  dumpId: string
  groups?: string[]
  gitSha?: string
  /** transform | settle | verify — what this invocation is for. */
  phase?: 'transform' | 'settle' | 'verify'
  /** Replay every row again even when a checkpoint says it was done. */
  force?: boolean
}

export async function transformGroups(
  db: Db,
  options: TransformOptions,
): Promise<TransformReport[]> {
  const reports: TransformReport[] = []
  const selected = GROUPS.filter(
    (group) => !options.groups || options.groups.includes(group.name),
  )

  for (const group of selected) {
    const transformer = await loadGroupTransformer(group)
    const report: TransformReport = { group: group.name, entities: [], status: 'passed' }

    const [run] = await db
      .insert(migrationRuns)
      .values({
        dumpId: options.dumpId,
        module: group.name,
        phase: options.phase ?? 'transform',
        status: 'running',
        manifestVersion: MANIFEST_VERSION,
        gitSha: options.gitSha ?? 'unknown',
        details: { tables: group.tables.map((entry) => entry.table) },
      })
      .returning({ runId: migrationRuns.runId })
    const runId = run!.runId

    if (!transformer) {
      await db
        .update(migrationRuns)
        .set({ status: 'blocked', finishedAt: new Date(), details: { reason: 'transformer_not_written' } })
        .where(eq(migrationRuns.runId, runId))
      report.status = 'blocked'
      await markModule(db, group.name, 'blocked', runId)
      reports.push(report)
      continue
    }

    try {
      for (const table of group.tables) {
        const entityReport = await transformEntity(db, {
          runId,
          dumpId: options.dumpId,
          group,
          table,
          transformer,
          force: options.force ?? false,
        })
        report.entities.push(entityReport)
        if (entityReport.status !== 'passed') report.status = 'needs_review'
      }
    } catch (error) {
      await db
        .update(migrationRuns)
        .set({
          status: 'failed',
          finishedAt: new Date(),
          errorCount: 1,
          details: { error: error instanceof Error ? error.message : String(error) },
        })
        .where(eq(migrationRuns.runId, runId))
      report.status = 'needs_review'
      await markModule(db, group.name, 'needs_review', runId)
      reports.push(report)
      continue
    }

    await db
      .update(migrationRuns)
      .set({
        status: report.status,
        finishedAt: new Date(),
        sourceRows: report.entities.reduce((sum, entity) => sum + entity.sourceRows, 0),
        transformedRows: report.entities.reduce((sum, entity) => sum + entity.transformed, 0),
        errorCount: report.entities.reduce((sum, entity) => sum + entity.errors, 0),
      })
      .where(eq(migrationRuns.runId, runId))
    // The promotion flag is physical: a module that did not pass cannot be
    // enabled by the cutover controller.
    await markModule(db, group.name, report.status, runId)
    reports.push(report)
  }

  return reports
}

async function transformEntity(
  db: Db,
  input: {
    runId: string
    dumpId: string
    group: ManifestGroup
    table: ManifestTable
    transformer: GroupTransformer
    force: boolean
  },
): Promise<{ entity: string; sourceRows: number; transformed: number; errors: number; status: string }> {
  const staging = stagingTable(input.table.table)
  const columnNames = legacyTables[input.table.table]?.columns.map((column) => column.name) ?? []

  const [checkpoint] = await db
    .select()
    .from(migrationCheckpoints)
    .where(and(eq(migrationCheckpoints.runId, input.runId), eq(migrationCheckpoints.entity, input.table.entity)))
    .limit(1)

  // Resume: find the row number of the checkpointed source key, then continue
  // after it. A rerun with no checkpoint starts at the beginning, which is a
  // no-op by natural key.
  let startRow = 0
  if (!input.force && checkpoint?.lastSourceKey) {
    const [found] = (await db.execute(
      sql`select "_row_no" from ${sql.raw(`migration."${staging}"`)} where "_dump_id" = ${input.dumpId} and "_source_pk" = ${checkpoint.lastSourceKey} limit 1`,
    )) as unknown as Array<{ _row_no: number }>
    startRow = found?._row_no ?? 0
  }

  let sourceRows = 0
  let transformed = 0
  let errors = 0
  let status = 'passed'
  let batchNo = checkpoint?.batchNo ?? 0

  for (;;) {
    const rows = (await db.execute(
      sql`select * from ${sql.raw(`migration."${staging}"`)} where "_dump_id" = ${input.dumpId} and "_row_no" > ${startRow} order by "_row_no" asc limit ${BATCH_SIZE}`,
    )) as unknown as Array<Record<string, unknown>>
    if (rows.length === 0) break

    const batch = rows.map((raw) => {
      const row: Record<string, string | null> = {}
      for (const column of columnNames) {
        const value = raw[column]
        row[column] = value === null || value === undefined ? null : String(value)
      }
      return {
        rowNo: Number(raw._row_no),
        key: String(raw._source_pk ?? raw._row_no),
        values: Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, value === null ? null : String(value)]),
        ) as Record<string, string | null>,
        raw,
      }
    })

    // One transaction per batch: the advisory lock is taken once, and a commit
    // records the checkpoint. A savepoint per row keeps one bad row from
    // discarding its 999 neighbours.
    let batchTransformed = 0
    let batchErrors = 0
    let batchFailed = false
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`migration:${input.table.entity}`}))`)
        for (const entry of batch) {
          const outcome = await transformOneRow(tx, {
            runId: input.runId,
            dumpId: input.dumpId,
            group: input.group.name,
            table: input.table.table,
            entity: input.table.entity,
            transformer: input.transformer,
            entry,
          })
          if (outcome === 'transformed') batchTransformed += 1
          else batchErrors += 1
        }
        const last = batch[batch.length - 1]
        if (last) {
          await tx
            .insert(migrationCheckpoints)
            .values({
              runId: input.runId,
              entity: input.table.entity,
              lastSourceKey: last.key,
              batchNo,
            })
            .onConflictDoUpdate({
              target: [migrationCheckpoints.runId, migrationCheckpoints.entity],
              set: { lastSourceKey: last.key, batchNo, updatedAt: new Date() },
            })
        }
      })
    } catch (error) {
      batchFailed = true
      await db.insert(migrationErrors).values({
        runId: input.runId,
        entity: input.table.entity,
        sourceKey: batch[0]?.key ?? null,
        errorCode: 'batch_failed',
        message: error instanceof Error ? error.message : String(error),
        payloadHash: batch[0] ? rowHash(batch[0].values) : null,
      })
    }

    if (batchFailed) {
      // The batch could not commit as a unit. Retry each row alone so the error
      // is narrowed to the row that caused it and the checkpoint still advances.
      for (const entry of batch) {
        sourceRows += 1
        let outcome: 'transformed' | 'failed' = 'failed'
        try {
          await db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`migration:${input.table.entity}`}))`)
            outcome = await transformOneRow(tx, {
              runId: input.runId,
              dumpId: input.dumpId,
              group: input.group.name,
              table: input.table.table,
              entity: input.table.entity,
              transformer: input.transformer,
              entry,
            })
            await tx
              .insert(migrationCheckpoints)
              .values({
                runId: input.runId,
                entity: input.table.entity,
                lastSourceKey: entry.key,
                batchNo,
              })
              .onConflictDoUpdate({
                target: [migrationCheckpoints.runId, migrationCheckpoints.entity],
                set: { lastSourceKey: entry.key, batchNo, updatedAt: new Date() },
              })
          })
        } catch (error) {
          outcome = 'failed'
          await db.insert(migrationErrors).values({
            runId: input.runId,
            entity: input.table.entity,
            sourceKey: entry.key,
            errorCode: 'batch_failed',
            message: error instanceof Error ? error.message : String(error),
            payloadHash: rowHash(entry.values),
          })
        }
        if ((outcome as string) === 'transformed') transformed += 1
        else errors += 1
      }
    } else {
      sourceRows += batch.length
      transformed += batchTransformed
      errors += batchErrors
    }

    if (errors > 0) status = 'needs_review'
    const last = batch[batch.length - 1]
    startRow = last ? last.rowNo : startRow
    batchNo += 1
  }

  // A row that could not be transformed is never reported as passed.
  if (errors > 0 || transformed < sourceRows) status = 'needs_review'

  return { entity: input.table.entity, sourceRows, transformed, errors, status }
}

interface StagedEntry {
  rowNo: number
  key: string
  values: Record<string, string | null>
  raw: Record<string, unknown>
}

/** One row, one savepoint. Returns whether the row is now part of the transaction. */
async function transformOneRow(
  tx: Tx,
  input: {
    runId: string
    dumpId: string
    group: string
    table: string
    entity: string
    transformer: GroupTransformer
    entry: StagedEntry
  },
): Promise<'transformed' | 'failed'> {
  const { entry } = input
  const pendingDecisions: Array<Parameters<typeof writeDecision>[1]> = []
  await tx.execute(sql.raw('savepoint migration_row'))
  try {
    const context = {
      tx,
      dumpId: input.dumpId,
      group: input.group,
      table: input.table,
      sourceKey: entry.key,
      row: entry.values,
    }
    const helpers = createHelpers(context, {
      onUnparseableMoney: (column, value) =>
        pendingDecisions.push({
          exceptionClass: 'unparseable_money',
          entity: input.entity,
          sourceKey: entry.key,
          action: 'stored NULL',
          notes: `${column} = ${JSON.stringify(value)}`,
        }),
      onZeroDate: (column) =>
        pendingDecisions.push({
          exceptionClass: 'zero_date',
          entity: input.entity,
          sourceKey: entry.key,
          action: 'stored NULL',
          notes: `${column} is a zero date`,
        }),
      onUnknownEnum: (column, value) =>
        pendingDecisions.push({
          exceptionClass: 'unknown_enum',
          entity: input.entity,
          sourceKey: entry.key,
          action: 'stored NULL, not the nearest label',
          notes: `${column} = ${JSON.stringify(value)}`,
        }),
    })
    await input.transformer.transform({ ...context, helpers })
    for (const pending of pendingDecisions) await writeDecision(tx, pending)
    await tx.execute(sql.raw('release savepoint migration_row'))
    return 'transformed'
  } catch (error) {
    await tx.execute(sql.raw('rollback to savepoint migration_row'))
    await tx.insert(migrationErrors).values({
      runId: input.runId,
      entity: input.entity,
      sourceKey: entry.key,
      errorCode: 'transform_failed',
      message: error instanceof Error ? error.message : String(error),
      payloadHash: rowHash(entry.values),
    })
    return 'failed'
  }
}

/**
 * A data-quality exception is a decision, not an error: it lands in
 * `migration.exceptions` with an owner to be named, and never blocks the batch.
 */
async function writeDecision(
  tx: Tx,
  values: {
    exceptionClass: string
    entity: string
    sourceKey: string
    action: string
    notes: string
  },
): Promise<void> {
  await tx
    .insert(migrationExceptions)
    .values({
      exceptionClass: values.exceptionClass,
      entity: values.entity,
      sourceKey: values.sourceKey,
      migrationAction: values.action,
      notes: values.notes,
    })
    .onConflictDoUpdate({
      target: [
        migrationExceptions.exceptionClass,
        migrationExceptions.entity,
        migrationExceptions.sourceKey,
      ],
      set: { migrationAction: values.action, notes: values.notes },
    })
}

export async function markModule(
  db: Db,
  module: string,
  status: 'passed' | 'failed' | 'needs_review' | 'blocked',
  runId?: string,
): Promise<void> {
  await db
    .insert(migrationModules)
    .values({ module, status, runId: runId ?? null })
    .onConflictDoUpdate({
      target: migrationModules.module,
      set: { status, runId: runId ?? null, updatedAt: new Date() },
    })
}

/** Rows staged for a table, for tests and the rehearsal. */
export async function stagedRows(
  db: Db,
  table: string,
  dumpId: string,
): Promise<Array<Record<string, unknown>>> {
  const staging = stagingTable(table)
  return (await db.execute(
    sql`select * from ${sql.raw(`migration."${staging}"`)} where "_dump_id" = ${dumpId} order by "_row_no" asc`,
  )) as unknown as Array<Record<string, unknown>>
}

export { BATCH_SIZE, stagingTable, ALL_TABLES, GROUPS }
export type { ManifestGroup, ManifestTable }
