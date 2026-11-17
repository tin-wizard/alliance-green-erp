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
import { ALL_TABLES, GROUPS, MANIFEST_VERSION, NEVER_STAGED_COLUMNS, SERIAL_TABLES, SKIPPED_DATED_DUPLICATES, stagingTable, type ManifestGroup, type ManifestTable } from './manifest'
import { createHelpers, RowMapCache, RowMapPending } from './helpers'
import { clearExistsMemo } from './exists-memo'
import type { GroupTransformer, LegacySource, SourceTable } from './types'
import legacy from './legacy-schema.json' with { type: 'json' }

const BATCH_SIZE = 1_000

/** Slices of one batch that run at once, for groups whose rows do not depend on each other. */
function concurrencyFor(group: ManifestGroup, table: ManifestTable): number {
  if (SERIAL_TABLES.has(table.table)) return 1
  const fromEnv = Number(process.env.MIGRATION_CONCURRENCY)
  const configured = group.concurrency ?? (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 1)
  return Math.max(1, Math.floor(configured))
}

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
    const { checksum, rows } = await stageTable(db, dumpId, table.table, sliceSource(source, table.table))
    report.tables.push({ table: table.table, rows, checksum, status: 'loaded' })
    report.totalRows += rows
    objects.push({
      dumpId,
      tableName: table.table,
      engine,
      sourceRows: rows,
      stagedRows: rows,
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

/** Rows per slice for sources that can hand a table over in pieces. */
const STAGE_SLICE_ROWS = 5000

/**
 * A table as a sequence of slices. A source that can slice a table does, so a
 * 500 MB table never sits in memory whole; any other source hands over the
 * table as one slice.
 */
async function* sliceSource(source: LegacySource, name: string): AsyncIterable<SourceTable> {
  if (source.readTableSlices) {
    yield* source.readTableSlices(name, STAGE_SLICE_ROWS)
    return
  }
  yield await source.readTable(name)
}

async function stageTable(
  db: Db,
  dumpId: string,
  name: string,
  slices: AsyncIterable<SourceTable>,
): Promise<{ checksum: string; rows: number }> {
  const staging = stagingTable(name)
  const hashes: string[] = []
  let rows = 0

  await db.execute(
    sql`delete from ${sql.raw(`migration."${staging}"`)} where "_dump_id" = ${dumpId}`,
  )

  const manifestTable = ALL_TABLES.find((entry) => entry.table === name)

  for await (const table of slices) {
    const columns = table.columns
    const names = ['_row_no', '_source_pk', '_row_hash', '_dump_id', ...columns]
    const header = sql`insert into ${sql.raw(`migration."${staging}"`)} (${sql.raw(
      names.map((column) => `"${column}"`).join(', '),
    )}) values `
    // One round trip per batch, not per row: a real dump is millions of rows and
    // the loader's speed must not scale with the network's latency. The batch
    // stays well under Postgres's 65,535-parameter limit and caps row count so a
    // table of large text columns does not build an enormous statement.
    const batchSize = Math.max(1, Math.min(500, Math.floor(30_000 / names.length)))

    for (let offset = 0; offset < table.rows.length; offset += batchSize) {
      const tuples = table.rows.slice(offset, offset + batchSize).map((row) => {
        const values: Record<string, string | null> = {}
        for (const column of columns) values[column] = row.values[column] ?? null
        const hash = rowHash(values)
        hashes.push(hash)

        const key = manifestTable
          ? sourceKey(manifestTable, { ...values, _row_no: String(row.rowNo) })
          : String(row.rowNo)
        // Postgres text cannot hold a NUL byte, and legacy free-text columns do
        // (14 values in the 2026-11 dump). The hash above is of the original, so
        // parity stays honest; the staged copy loses only the NUL.
        const params: Array<string | number | null> = [
          row.rowNo,
          key,
          hash,
          dumpId,
          ...columns.map((column) => {
            if (NEVER_STAGED_COLUMNS[name]?.has(column)) return null
            const value = values[column] ?? null
            if (value !== null && value.includes('\u0000')) {
              console.warn(`[stage] ${name}.${column} row ${row.rowNo}: stripped NUL byte(s)`)
              return value.replaceAll('\u0000', '')
            }
            return value
          }),
        ]
        return sql`(${sql.join(
          params.map((param) => sql`${param}`),
          sql`, `,
        )})`
      })
      await db.execute(sql`${header}${sql.join(tuples, sql`, `)}`)
    }
    rows += table.rows.length
  }

  return { checksum: sha256(hashes.join('\n')), rows }
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
  const concurrency = concurrencyFor(input.group, input.table)
  clearExistsMemo()
  const cache = new RowMapCache()

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

    // The batch is cut into slices. Each slice is one transaction, so the whole
    // batch costs a handful of round trips per row instead of a dozen. The first
    // pass runs a slice with no savepoints; if any row throws, that slice rolls
    // back and replays row by row with a savepoint each, so one bad row never
    // discards its neighbours and the result matches the one-row-at-a-time path.
    // An advisory lock held for the whole batch keeps two runners off one entity.
    let batchTransformed = 0
    let batchErrors = 0
    let batchFailed = false
    try {
      await db.transaction(async (lockTx) => {
        await lockTx.execute(sql`select pg_advisory_xact_lock(hashtext(${`migration:${input.table.entity}`}))`)
        const slices = sliceBatch(batch, concurrency)
        const results = await Promise.all(
          slices.map((slice) =>
            runSlice(db, {
              runId: input.runId,
              dumpId: input.dumpId,
              group: input.group.name,
              table: input.table.table,
              entity: input.table.entity,
              transformer: input.transformer,
              cache,
              slice,
            }),
          ),
        )
        for (const result of results) {
          batchTransformed += result.transformed
          batchErrors += result.errors
        }
        const last = batch[batch.length - 1]
        if (last) {
          await lockTx
            .insert(migrationCheckpoints)
            .values({ runId: input.runId, entity: input.table.entity, lastSourceKey: last.key, batchNo })
            .onConflictDoUpdate({
              target: [migrationCheckpoints.runId, migrationCheckpoints.entity],
              set: { lastSourceKey: last.key, batchNo, updatedAt: new Date() },
            })
        }
      })
    } catch (error) {
      batchFailed = true
      batchTransformed = 0
      batchErrors = 0
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

function sliceBatch<T>(batch: T[], parts: number): T[][] {
  if (parts <= 1 || batch.length <= 1) return [batch]
  const size = Math.ceil(batch.length / parts)
  const slices: T[][] = []
  for (let offset = 0; offset < batch.length; offset += size) slices.push(batch.slice(offset, offset + size))
  return slices
}

interface SliceInput {
  runId: string
  dumpId: string
  group: string
  table: string
  entity: string
  transformer: GroupTransformer
  cache: RowMapCache
  slice: StagedEntry[]
}

/**
 * One slice, one transaction. Optimistic first (no savepoints, one flush of the
 * buffered crosswalk); on any throw the transaction rolls back and the slice is
 * replayed with a savepoint per row, which is the original per-row behaviour.
 */
async function runSlice(db: Db, input: SliceInput): Promise<{ transformed: number; errors: number }> {
  for (const savepoint of [false, true]) {
    const pending = new RowMapPending(input.cache)
    try {
      return await db.transaction(async (tx) => {
        let transformed = 0
        let errors = 0
        for (const entry of input.slice) {
          const outcome = await transformOneRow(tx, { ...input, entry, savepoint, pending })
          if (outcome === 'transformed') transformed += 1
          else errors += 1
        }
        await pending.flush(tx, input.dumpId)
        return { transformed, errors }
      })
    } catch (error) {
      // The slice's transaction rolled back, so its buffered mappings are void.
      pending.discard()
      if (savepoint) throw error
    }
  }
  throw new Error('unreachable')
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
    /** Savepoint per row (replay mode); off for the optimistic pass. */
    savepoint?: boolean
    cache?: RowMapCache
    pending?: RowMapPending
  },
): Promise<'transformed' | 'failed'> {
  const { entry } = input
  const useSavepoint = input.savepoint ?? true
  const rowMap = input.cache && input.pending ? { cache: input.cache, pending: input.pending } : undefined
  const mark = rowMap?.pending.size ?? 0
  const pendingDecisions: Array<Parameters<typeof writeDecision>[1]> = []
  if (useSavepoint) await tx.execute(sql.raw('savepoint migration_row'))
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
      rowMap,
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
    for (const decision of pendingDecisions) {
      if (rowMap) {
        rowMap.pending.addException({
          exceptionClass: decision.exceptionClass,
          entity: decision.entity,
          sourceKey: decision.sourceKey,
          rowCount: 1,
          migrationAction: decision.action,
          notes: decision.notes,
        })
      } else {
        await writeDecision(tx, decision)
      }
    }
    if (useSavepoint) await tx.execute(sql.raw('release savepoint migration_row'))
    return 'transformed'
  } catch (error) {
    // Without a savepoint the whole slice rolls back and is replayed; let it.
    if (!useSavepoint) throw error
    rowMap?.pending.rollbackTo(mark)
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
