/**
 * The run report: what was loaded, what was transformed, what differs and why.
 *
 * The expected-versus-actual table is the point of the rehearsal. Each group
 * prints its manifest count beside its staged count and its mapped count, and any
 * gap is classified as one of three things:
 *
 * - `dated-duplicate-skip`: the rows are a frozen copy we deliberately never load
 * - `fixture-correct`: the fixture is a case matrix, so its count is the truth
 * - `genuine-exception`: rows were loaded and did not land, and someone must look
 */
import { sql } from 'drizzle-orm'
import type { Db } from '@cls/db'
import { GROUPS, stagingTable } from './manifest'
import { EXCEPTION_CLASSES, exceptionClassMeta } from './exception-classes'
import type { ParityReport } from './parity'

export type MismatchClass = 'none' | 'dated-duplicate-skip' | 'fixture-correct' | 'genuine-exception'

export interface GroupCounts {
  group: string
  order: number
  tables: number
  expected: number
  staged: number
  mapped: number
  /**
   * Rows the group can point at: mapped rows plus rows with a recorded exception.
   * A staged row that is neither is the only genuine gap there is.
   */
  accounted: number
  policySkipped: number
  openExceptions: number
  mismatch: MismatchClass
  note: string
}

export interface ExceptionGroup {
  exceptionClass: string
  title: string
  owner: string
  description: string
  policySkip: boolean
  count: number
  rows: Array<{
    entity: string
    sourceKey: string
    rowCount: number
    migrationAction: string
    decision: string
    owner: string | null
    notes: string | null
  }>
}

export interface IdempotencySummary {
  errorsPass1: number
  errorsPass2: number
  drift: string[]
  parityPass1Differed: number
  parityPass2Differed: number
  userCohorts: Record<string, number>
}

export interface RunReportData {
  generatedAt: string
  dumpId: string
  manifestVersion: string
  gitSha: string
  mode: 'rehearsal' | 'apply'
  groups: GroupCounts[]
  exceptions: ExceptionGroup[]
  errors: Array<{ entity: string; sourceKey: string | null; errorCode: string; message: string }>
  parity: ParityReport
  runs: Array<{
    module: string
    phase: string
    status: string
    sourceRows: number
    transformedRows: number
    errorCount: number
  }>
  dumpObjects: {
    loaded: number
    skipped: number
    missing: number
    rows: number
  }
  idempotency: IdempotencySummary | null
  totals: {
    expected: number
    staged: number
    mapped: number
    exceptions: number
    errors: number
    parityDiffered: number
  }
}

export interface ReportOptions {
  dumpId: string
  gitSha: string
  manifestVersion: string
  parity: ParityReport
  /** Per-group source counts the fixture generator declared, when a fixture ran. */
  expectedByGroup?: Record<string, number>
  mode?: 'rehearsal' | 'apply'
  idempotency?: IdempotencySummary
  /** Shorter dump id for the report directory, e.g. the first 12 hex characters. */
  reportId?: string
}

export function shortDumpId(dumpId: string): string {
  return dumpId.replace(/^sha256:/, '').slice(0, 12)
}

async function scalar(db: Db, query: string): Promise<number> {
  const rows = (await db.execute(sql.raw(query))) as unknown as Array<{ value: number | string }>
  return Number(rows[0]?.value ?? 0)
}

async function stagedCount(db: Db, table: string, dumpId: string): Promise<number> {
  return scalar(
    db,
    `select count(*)::int as value from migration."${stagingTable(table)}" where "_dump_id" = '${dumpId.replace(/'/g, "''")}'`,
  )
}

/** Mapped rows and distinct exceptioned rows per entity, for the accounting column. */
async function accountedCount(
  db: Db,
  tables: string[],
  entities: string[],
): Promise<{ accounted: number; mapped: number }> {
  const tableList = tables.map((table) => `'${table.replace(/'/g, "''")}'`).join(', ')
  const entityList = entities.map((entity) => `'${entity.replace(/'/g, "''")}'`).join(', ')
  const rows = (await db.execute(
    sql.raw(`select entity, count(*)::int as value from migration.row_map where source_table in (${tableList}) group by entity`),
  )) as unknown as Array<{ entity: string; value: number }>
  const exceptionRows = (await db.execute(
    // A table-level decision carries its row count, so the accounting counts
    // rows, not decision rows.
    sql.raw(`select entity, coalesce(sum(row_count), 0)::int as value from migration.exceptions where entity in (${entityList}) group by entity`),
  )) as unknown as Array<{ entity: string; value: number }>
  const mappedByEntity = new Map(rows.map((row) => [row.entity, Number(row.value)]))
  const exceptionByEntity = new Map(exceptionRows.map((row) => [row.entity, Number(row.value)]))
  let mapped = 0
  let accounted = 0
  for (const entity of entities) {
    mapped += mappedByEntity.get(entity) ?? 0
    accounted += (mappedByEntity.get(entity) ?? 0) + (exceptionByEntity.get(entity) ?? 0)
  }
  return { accounted, mapped }
}

async function policySkipCount(db: Db, entities: string[], classes: string[]): Promise<number> {
  const entityList = entities.map((entity) => `'${entity.replace(/'/g, "''")}'`).join(', ')
  const classList = classes.map((entry) => `'${entry.replace(/'/g, "''")}'`).join(', ')
  return scalar(
    db,
    `select coalesce(sum(row_count), 0)::int as value from migration.exceptions where entity in (${entityList}) and exception_class in (${classList})`,
  )
}

/**
 * Classify a group's counts. A gap is only explained when the arithmetic and the
 * recorded policy skips account for it; otherwise it is genuine.
 */
export function classifyCounts(input: {
  expected: number
  staged: number
  mapped: number
  policySkipped: number
}): MismatchClass {
  const { expected, staged, mapped, policySkipped } = input
  if (staged === expected && mapped + policySkipped >= staged) return 'none'
  if (staged < expected) return 'genuine-exception'
  if (staged > expected) return 'fixture-correct'
  if (mapped + policySkipped < staged) return 'genuine-exception'
  return 'none'
}

export async function buildRunReport(db: Db, options: ReportOptions): Promise<RunReportData> {
  const policyClasses = Object.entries(EXCEPTION_CLASSES)
    .filter(([, meta]) => meta.policySkip)
    .map(([name]) => name)

  const groups: GroupCounts[] = []
  for (const group of GROUPS) {
    const tables = group.tables.map((table) => table.table)
    const entities = [...new Set(group.tables.map((table) => table.entity))]
    const expected = options.expectedByGroup?.[group.name] ?? group.tables.reduce((sum, table) => sum + table.fixtureRows, 0)
    let staged = 0
    for (const table of tables) staged += await stagedCount(db, table, options.dumpId)
    const { accounted, mapped } = await accountedCount(db, tables, entities)
    const policySkipped = await policySkipCount(db, entities, policyClasses)
    const openExceptions = await scalar(
      db,
      `select count(*)::int as value from migration.exceptions where entity in (${entities
        .map((entity) => `'${entity.replace(/'/g, "''")}'`)
        .join(', ')}) and decision = 'pending'`,
    )
    // Accounting is capped at what was staged: an entity cannot account for more
    // rows than it read, and a row with two exceptions is still one row.
    const accountedCapped = Math.min(accounted, staged)
    const mismatch = classifyCounts({
      expected,
      staged,
      mapped: accountedCapped,
      policySkipped: 0,
    })
    groups.push({
      group: group.name,
      order: group.order,
      tables: group.tables.length,
      expected,
      staged,
      mapped,
      accounted: accountedCapped,
      policySkipped,
      openExceptions,
      mismatch,
      note:
        mismatch === 'dated-duplicate-skip'
          ? 'gap is the dated duplicate tables, deliberately not loaded'
          : mismatch === 'fixture-correct'
            ? 'fixture is a case matrix; its declared count is authoritative'
            : mismatch === 'genuine-exception'
              ? 'rows loaded but not mapped; see the exception list'
              : '',
    })
  }

  const exceptionRows = (await db.execute(sql`
    select exception_class, entity, source_key, row_count, migration_action, decision, owner, notes
    from migration.exceptions
    order by exception_class, entity, source_key
  `)) as unknown as Array<{
    exception_class: string
    entity: string
    source_key: string
    row_count: number | string
    migration_action: string
    decision: string
    owner: string | null
    notes: string | null
  }>

  const byClass = new Map<string, ExceptionGroup>()
  for (const row of exceptionRows) {
    const meta = exceptionClassMeta(row.exception_class)
    const entry = byClass.get(row.exception_class) ?? {
      exceptionClass: row.exception_class,
      title: meta.title,
      owner: meta.owner,
      description: meta.description,
      policySkip: meta.policySkip,
      count: 0,
      rows: [],
    }
    entry.count += Number(row.row_count)
    entry.rows.push({
      entity: row.entity,
      sourceKey: row.source_key,
      rowCount: Number(row.row_count),
      migrationAction: row.migration_action,
      decision: row.decision,
      owner: row.owner,
      notes: row.notes,
    })
    byClass.set(row.exception_class, entry)
  }

  const errorRows = (await db.execute(sql`
    select entity, source_key, error_code, message from migration.errors order by entity, source_key limit 500
  `)) as unknown as Array<{
    entity: string
    source_key: string | null
    error_code: string
    message: string
  }>
  const errors = errorRows.map((row) => ({
    entity: row.entity,
    sourceKey: row.source_key,
    errorCode: row.error_code,
    message: row.message,
  }))

  const runs = (await db.execute(sql`
    select module, phase, status, source_rows, transformed_rows, error_count
    from migration.runs where dump_id = ${options.dumpId} order by started_at asc
  `)) as unknown as Array<{
    module: string
    phase: string
    status: string
    source_rows: number | string
    transformed_rows: number | string
    error_count: number | string
  }>

  const dumpObjects = (await db.execute(sql`
    select
      count(*) filter (where status = 'loaded')::int as loaded,
      count(*) filter (where status = 'skipped_dated_duplicate')::int as skipped,
      count(*) filter (where status in ('missing', 'failed'))::int as missing,
      coalesce(sum(staged_rows), 0)::int as rows
    from migration.dump_objects where dump_id = ${options.dumpId}
  `)) as unknown as Array<{ loaded: number; skipped: number; missing: number; rows: number | string }>

  const exceptions = [...byClass.values()].sort((left, right) => left.exceptionClass.localeCompare(right.exceptionClass))
  const objects = dumpObjects[0] ?? { loaded: 0, skipped: 0, missing: 0, rows: 0 }

  return {
    generatedAt: new Date().toISOString(),
    dumpId: options.dumpId,
    manifestVersion: options.manifestVersion,
    gitSha: options.gitSha,
    mode: options.mode ?? 'rehearsal',
    idempotency: options.idempotency ?? null,
    groups,
    exceptions,
    errors,
    parity: options.parity,
    runs: runs.map((run) => ({
      module: run.module,
      phase: run.phase,
      status: run.status,
      sourceRows: Number(run.source_rows),
      transformedRows: Number(run.transformed_rows),
      errorCount: Number(run.error_count),
    })),
    dumpObjects: {
      loaded: objects.loaded,
      skipped: objects.skipped,
      missing: objects.missing,
      rows: Number(objects.rows),
    },
    totals: {
      expected: groups.reduce((sum, group) => sum + group.expected, 0),
      staged: groups.reduce((sum, group) => sum + group.staged, 0),
      mapped: groups.reduce((sum, group) => sum + group.mapped, 0),
      exceptions: exceptions.reduce((sum, entry) => sum + entry.count, 0),
      errors: errors.length,
      parityDiffered: options.parity.differed,
    },
  }
}

export function exceptionsJson(report: RunReportData): string {
  return `${JSON.stringify(
    {
      generatedAt: report.generatedAt,
      dumpId: report.dumpId,
      manifestVersion: report.manifestVersion,
      mode: report.mode,
      totals: report.totals,
      exceptions: Object.fromEntries(
        report.exceptions.map((entry) => [
          entry.exceptionClass,
          {
            title: entry.title,
            owner: entry.owner,
            policySkip: entry.policySkip,
            description: entry.description,
            count: entry.count,
            rows: entry.rows,
          },
        ]),
      ),
    },
    null,
    2,
  )}\n`
}

export function exceptionsMarkdown(report: RunReportData): string {
  const lines: string[] = []
  lines.push('# Legacy migration exception report')
  lines.push('')
  lines.push(`Generated ${report.generatedAt} (${report.mode}).`)
  lines.push('')
  lines.push(`Dump \`${report.dumpId}\`, manifest ${report.manifestVersion}, commit ${report.gitSha}.`)
  lines.push('')
  lines.push(
    `${report.totals.exceptions} recorded exceptions in ${report.exceptions.length} classes, ${report.totals.errors} row errors.`,
  )
  lines.push('')
  lines.push('A class marked "policy skip" is a decision the migration makes on purpose; everything else needs an owner.')
  lines.push('')
  for (const entry of report.exceptions) {
    lines.push(`## ${entry.exceptionClass}`)
    lines.push('')
    lines.push(`${entry.title}. Owner: ${entry.owner}.${entry.policySkip ? ' **Policy skip.**' : ''}`)
    lines.push('')
    lines.push(entry.description)
    lines.push('')
    lines.push(`Count: ${entry.count}`)
    lines.push('')
    if (entry.rows.length === 0) {
      lines.push('None.')
    } else {
      lines.push('| Entity | Source key | Rows | Action | Decision |')
      lines.push('|---|---|---:|---|---|')
      for (const row of entry.rows.slice(0, 200)) {
        lines.push(
          `| ${row.entity} | \`${row.sourceKey}\` | ${row.rowCount} | ${row.migrationAction} | ${row.decision}${row.notes ? ` (${row.notes})` : ''} |`,
        )
      }
      if (entry.rows.length > 200) lines.push(`| … | ${entry.rows.length - 200} more | | | |`)
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

function honest(value: number, expected: number): string {
  return value === expected ? `${value}` : `${value} (${value - expected > 0 ? '+' : ''}${value - expected})`
}

export function runMarkdown(report: RunReportData): string {
  const lines: string[] = []
  lines.push('# Migration rehearsal report')
  lines.push('')
  lines.push(`Generated ${report.generatedAt}.`)
  lines.push('')
  lines.push(`- Dump: \`${report.dumpId}\``)
  lines.push(`- Manifest: ${report.manifestVersion}`)
  lines.push(`- Commit: ${report.gitSha}`)
  lines.push(`- Mode: ${report.mode}`)
  lines.push(
    `- Tables: ${report.dumpObjects.loaded} loaded, ${report.dumpObjects.skipped} dated duplicates skipped, ${report.dumpObjects.missing} missing`,
  )
  lines.push(
    `- Rows: ${report.totals.staged} staged of ${report.totals.expected} expected; ${report.totals.mapped} mapped into the app; ${report.totals.exceptions} exceptions; ${report.totals.errors} row errors`,
  )
  lines.push(
    `- Parity: ${report.parity.matched} matched, ${report.parity.differed} differed, ${report.parity.errored} errored of ${report.parity.total}`,
  )
  lines.push('')
  lines.push('## Expected versus actual, per group')
  lines.push('')
  lines.push(
    'Expected is the fixture manifest (the case matrix). Staged is what the loader actually read. Mapped is what reached `app` with a row map entry. Accounted adds rows that carry a recorded exception, because a policy skip or a decision is still an answer for that row. A staged row that is neither mapped nor exceptioned is the only genuine gap; a short staged count is never excused by a policy.',
  )
  lines.push('')
  lines.push(
    '| # | Group | Tables | Expected | Staged | Mapped | Accounted | Policy skips | Mismatch |',
  )
  lines.push('|---:|---|---:|---:|---:|---:|---:|---:|---|')
  for (const group of report.groups) {
    lines.push(
      `| ${group.order} | ${group.group} | ${group.tables} | ${group.expected} | ${honest(group.staged, group.expected)} | ${group.mapped} | ${honest(group.accounted, group.staged)} | ${group.policySkipped} | ${group.mismatch}${group.note ? ` — ${group.note}` : ''} |`,
    )
  }
  lines.push('')
  lines.push('## Runs')
  lines.push('')
  lines.push('| Module | Phase | Status | Source rows | Transformed | Errors |')
  lines.push('|---|---|---|---:|---:|---:|')
  for (const run of report.runs) {
    lines.push(
      `| ${run.module} | ${run.phase} | ${run.status} | ${run.sourceRows} | ${run.transformedRows} | ${run.errorCount} |`,
    )
  }
  lines.push('')
  if (report.idempotency) {
    const idempotency = report.idempotency
    lines.push('## Idempotency')
    lines.push('')
    lines.push(
      `Pass 1 errors ${idempotency.errorsPass1}, pass 2 errors ${idempotency.errorsPass2}; parity differed ${idempotency.parityPass1Differed} then ${idempotency.parityPass2Differed}.`,
    )
    lines.push('')
    lines.push(
      idempotency.drift.length === 0
        ? 'The second pass changed no app row counts: the import is re-runnable.'
        : `The second pass changed row counts: ${idempotency.drift.join(', ')}.`,
    )
    lines.push('')
    lines.push(`User cohorts: ${Object.entries(idempotency.userCohorts).map(([cohort, count]) => `${cohort} ${count}`).join(', ')}.`)
    lines.push('')
  }
  if (report.errors.length > 0) {
    lines.push('## Row errors')
    lines.push('')
    lines.push('| Entity | Source key | Code | Message |')
    lines.push('|---|---|---|---|')
    for (const error of report.errors.slice(0, 100)) {
      lines.push(
        `| ${error.entity} | \`${error.sourceKey ?? '-'}\` | ${error.errorCode} | ${error.message.replace(/\|/g, '\\|')} |`,
      )
    }
    lines.push('')
  }
  if (report.parity.differed > 0 || report.parity.errored > 0) {
    lines.push('## Parity differences')
    lines.push('')
    lines.push('| Group | Anchor | Old | New |')
    lines.push('|---|---|---:|---:|')
    for (const anchor of report.parity.anchors.filter((entry) => !entry.match)) {
      lines.push(
        `| ${anchor.group} | ${anchor.label} | ${anchor.oldValue ?? 'null'} | ${anchor.newValue ?? '-'} |`,
      )
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

export function runJson(report: RunReportData): string {
  return `${JSON.stringify(report, null, 2)}\n`
}
