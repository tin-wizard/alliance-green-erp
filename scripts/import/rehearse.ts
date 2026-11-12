/**
 * Two-pass rehearsal against the synthetic dump.
 *
 * Pass one proves the pipeline can carry the case matrix. Pass two proves the
 * pipeline is idempotent: same dump, same result, no new rows, no new errors,
 * same parity. The report is written from pass two, so it describes the state a
 * rerun produces.
 */
/* eslint-disable no-console */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sql } from 'drizzle-orm'
import { getDb } from '@cls/db'
import { GROUPS, MANIFEST_VERSION, SKIPPED_DATED_DUPLICATES, groupForTable } from './manifest'
import { loadSource, transformGroups } from './runner'
import { captureBaseline, collectAnchors, runParity } from './parity'
import {
  buildRunReport,
  exceptionsJson,
  exceptionsMarkdown,
  runJson,
  runMarkdown,
  shortDumpId,
} from './reports'
import { parityMarkdown } from './parity'
import { planUserInvites } from './users'
import type { LegacySource } from './types'

const FIXTURE_PATH = 'fixtures/legacy/alliance_db_synthetic.sql'
const FIXTURE_MANIFEST_PATH = 'fixtures/legacy/manifest.json'

interface FixtureManifest {
  dumpId?: string
  groups?: Record<string, number> | Array<{ name: string; rows: number }>
  tables?: Array<{ table: string; rows: number }>
  rowCount?: number
}

export function dumpIdFor(path: string): string {
  const output = execFileSync('shasum', ['-a', '256', path], { encoding: 'utf8' })
  return `sha256:${output.trim().split(/\s+/)[0]}`
}

async function loadSyntheticSource(path: string): Promise<LegacySource> {
  const module = (await import('./source/dump')) as {
    DumpSource?: new (path: string) => LegacySource
  }
  if (!module.DumpSource) throw new Error('scripts/import/source/dump.ts does not export DumpSource')
  return new module.DumpSource(path)
}

function expectedByGroup(manifest: FixtureManifest): Record<string, number> {
  if (Array.isArray(manifest.groups)) {
    return Object.fromEntries(manifest.groups.map((group) => [group.name, group.rows]))
  }
  if (manifest.groups && typeof manifest.groups === 'object') return manifest.groups
  if (manifest.tables) {
    const counts: Record<string, number> = {}
    for (const entry of manifest.tables) {
      // Dated duplicates are in the fixture and in the dump, but never staged:
      // counting them as expected would make every rehearsal look short.
      if ((SKIPPED_DATED_DUPLICATES as readonly string[]).includes(entry.table)) continue
      const group = groupForTable(entry.table)
      if (!group) continue
      counts[group.name] = (counts[group.name] ?? 0) + entry.rows
    }
    return counts
  }
  return {}
}

/**
 * A rehearsal must start from the state a real cutover starts from: an app
 * schema that does not already contain the previous run's rows. Only rows the
 * harness mapped are deleted (row_map is the list), newest first so children go
 * before parents. Anything the harness did not create is left alone.
 */
/**
 * Counters and configuration seeded by migrations, not imported rows. Deleting
 * them breaks the application (work-order numbering) and they are not the
 * rehearsal's to remove.
 */
const PRESERVED_TARGET_TABLES = new Set(['work_order_number_series'])

export async function resetRehearsalTargets(db: ReturnType<typeof getDb>): Promise<{ deleted: number; failed: string[] }> {
  const targets = (await db.execute(sql`
    select target_table, array_agg(target_key order by id) as keys, max(id) as last_id
    from migration.row_map
    group by target_table
    order by max(id) desc
  `)) as unknown as Array<{ target_table: string; keys: string[]; last_id: number }>

  const failed: string[] = []
  let deleted = 0
  // Deletion can only follow the FK graph, and the row map does not record every
  // child. Three passes with the newest target table first settles the graph;
  // whatever is still blocked is reported rather than forced.
  for (let round = 0; round < 3; round += 1) {
    let progress = 0
    for (const target of targets) {
      if (!/^[a-z_]+$/.test(target.target_table)) continue
      const keys = target.keys.map((key) => `'${String(key).replace(/'/g, "''")}'`).join(', ')
      try {
        const rows = (await db.execute(
          sql.raw(
            `delete from app."${target.target_table}" where id::text in (${keys}) returning id`,
          ),
        )) as unknown as Array<{ id: unknown }>
        progress += rows.length
        deleted += rows.length
      } catch (error) {
        if (round === 2) {
          const cause = (error as { cause?: unknown }).cause
          failed.push(
            `${target.target_table}: ${cause instanceof Error ? cause.message : String(cause ?? error)}`,
          )
        }
      }
    }
    if (progress === 0) break
  }

  // Clear the harness's own bookkeeping so the rehearsal proves a first run,
  // not a replay of the last one.
  for (const statement of [
    'delete from migration.checkpoints',
    'delete from migration.errors',
    'delete from migration.exceptions',
    'delete from migration.row_map',
    'delete from migration.user_invites',
    'delete from migration.runs',
    'delete from migration.dump_objects',
    'delete from migration.dump_manifests',
  ]) {
    await db.execute(sql.raw(statement))
  }
  return { deleted, failed }
}

async function appRowCounts(db: ReturnType<typeof getDb>): Promise<Map<string, number>> {
  const targets = (await db.execute(sql`
    select distinct target_table from migration.row_map order by target_table
  `)) as unknown as Array<{ target_table: string }>
  const counts = new Map<string, number>()
  for (const target of targets) {
    if (!/^[a-z_]+$/.test(target.target_table)) continue
    if (PRESERVED_TARGET_TABLES.has(target.target_table)) continue
    const rows = (await db.execute(
      sql.raw(`select count(*)::int as value from app."${target.target_table}"`),
    )) as unknown as Array<{ value: number }>
    counts.set(target.target_table, Number(rows[0]?.value ?? 0))
  }
  return counts
}

function compareCounts(before: Map<string, number>, after: Map<string, number>): string[] {
  const differences: string[] = []
  for (const [table, count] of after) {
    const previous = before.get(table) ?? 0
    if (previous !== count) differences.push(`${table}: ${previous} -> ${count}`)
  }
  return differences
}

/** Errors belonging to this dump's runs, not every error the database ever saw. */
async function errorCount(db: ReturnType<typeof getDb>, dumpId: string): Promise<number> {
  const rows = (await db.execute(sql`
    select count(*)::int as value
    from migration.errors e
    join migration.runs r on r.run_id = e.run_id
    where r.dump_id = ${dumpId}
  `)) as unknown as Array<{ value: number }>
  return Number(rows[0]?.value ?? 0)
}

async function main(): Promise<void> {
  const fixturePath = process.argv[2] ?? FIXTURE_PATH
  const db = getDb()
  const manifest = JSON.parse(readFileSync(FIXTURE_MANIFEST_PATH, 'utf8')) as FixtureManifest
  const expected = expectedByGroup(manifest)
  const source = await loadSyntheticSource(fixturePath)
  const dumpId = source.dumpInfo?.().dumpId ?? dumpIdFor(fixturePath)

  console.log(`dump ${dumpId} from ${fixturePath}`)

  // Pass one.
  let report = await loadSource(db, source, dumpId)
  console.log(`pass 1 load: ${report.totalRows} rows in ${report.tables.length} tables, ${report.missing.length} missing`)
  const reset = await resetRehearsalTargets(db)
  console.log(`reset: deleted ${reset.deleted} app rows mapped by earlier runs`)
  for (const failure of reset.failed) console.log(`  reset failed: ${failure}`)

  // Parity measures what this dump adds. The dev database already holds rows, so
  // the new side is a delta from before the import; on a fresh target the
  // baseline is zero and the delta is the absolute count.
  const anchors = await collectAnchors()
  const baseline = await captureBaseline(db, { dumpId, anchors })
  const first = await transformGroups(db, { dumpId, gitSha: process.env.GIT_SHA ?? 'rehearsal' })
  // Some children reference parents that a later group creates (an invoice number
  // points at an invoice that group 10 builds). One settle pass reaches the
  // fixpoint a cutover reaches; pass two then has nothing left to add.
  const settle = await transformGroups(db, {
    dumpId,
    gitSha: process.env.GIT_SHA ?? 'rehearsal',
    phase: 'settle',
  })
  const firstParity = await runParity(db, { dumpId, anchors, baseline })
  const countsAfterFirst = await appRowCounts(db)
  const errorsAfterFirst = await errorCount(db, dumpId)
  console.log(
    `pass 1 transform: ${first.filter((group) => group.status === 'passed').length}/${first.length} groups passed, settle ${settle.filter((group) => group.status === 'passed').length}/${settle.length}, parity ${firstParity.matched}/${firstParity.total}`,
  )

  // Pass two: same dump, same code, nothing may change.
  report = await loadSource(db, source, dumpId)
  const second = await transformGroups(db, {
    dumpId,
    gitSha: process.env.GIT_SHA ?? 'rehearsal',
    phase: 'verify',
  })
  const secondParity = await runParity(db, { dumpId, anchors, baseline })
  const countsAfterSecond = await appRowCounts(db)
  const errorsAfterSecond = await errorCount(db, dumpId)

  const drift = compareCounts(countsAfterFirst, countsAfterSecond)
  if (drift.length > 0) {
    console.error(`pass 2 changed app row counts: ${drift.join(', ')}`)
  }
  if (errorsAfterSecond !== errorsAfterFirst) {
    console.error(`pass 2 changed error count: ${errorsAfterFirst} -> ${errorsAfterSecond}`)
  }
  if (secondParity.differed !== firstParity.differed) {
    console.error(`pass 2 changed parity differences: ${firstParity.differed} -> ${secondParity.differed}`)
  }

  const plans = await planUserInvites(db, dumpId)
  const cohortCounts = plans.reduce<Record<string, number>>((counts, plan) => {
    counts[plan.cohort] = (counts[plan.cohort] ?? 0) + 1
    return counts
  }, {})
  console.log(`user cohorts: ${JSON.stringify(cohortCounts)}`)

  const data = await buildRunReport(db, {
    dumpId,
    gitSha: process.env.GIT_SHA ?? 'rehearsal',
    manifestVersion: MANIFEST_VERSION,
    parity: secondParity,
    expectedByGroup: expected,
    idempotency: {
      errorsPass1: errorsAfterFirst,
      errorsPass2: errorsAfterSecond,
      drift,
      parityPass1Differed: firstParity.differed,
      parityPass2Differed: secondParity.differed,
      userCohorts: cohortCounts,
    },
  })

  const directory = join('reports', `migration-${shortDumpId(dumpId)}`)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'run.json'), runJson(data))
  writeFileSync(join(directory, 'run.md'), runMarkdown(data))
  writeFileSync(join(directory, 'exceptions.json'), exceptionsJson(data))
  writeFileSync(join(directory, 'exceptions.md'), exceptionsMarkdown(data))
  writeFileSync(join(directory, 'parity.json'), `${JSON.stringify(secondParity, null, 2)}\n`)
  writeFileSync(join(directory, 'parity.md'), parityMarkdown(secondParity))
  // Cohorts only: the queue holds email hashes, never an address or a token.
  writeFileSync(
    join(directory, 'users.json'),
    `${JSON.stringify({ dumpId, cohorts: cohortCounts, plans }, null, 2)}\n`,
  )
  writeFileSync(
    join(directory, 'idempotency.json'),
    `${JSON.stringify(
      {
        dumpId,
        pass1: { errors: errorsAfterFirst, parityDiffered: firstParity.differed },
        pass2: { errors: errorsAfterSecond, parityDiffered: secondParity.differed, drift },
        groups: second.map((group) => ({ group: group.group, status: group.status })),
        userCohorts: cohortCounts,
      },
      null,
      2,
    )}\n`,
  )

  console.log(`report written to ${directory}`)
  console.log(
    `expected ${data.totals.expected} / staged ${data.totals.staged} / mapped ${data.totals.mapped}; exceptions ${data.totals.exceptions}; parity differed ${data.totals.parityDiffered}; errors ${data.totals.errors}`,
  )
  for (const group of data.groups) {
    if (group.mismatch !== 'none') {
      console.log(`  ${group.group}: expected ${group.expected}, staged ${group.staged}, mapped ${group.mapped} (${group.mismatch})`)
    }
  }
  console.log(`groups: ${GROUPS.length}`)

  // The rehearsal leaves the database as it found it unless asked otherwise: the
  // app test suites assume the rows they create are the only ones in their
  // range, and an audit must be reproducible against a clean tree.
  if (!process.argv.includes('--keep')) {
    const cleanup = await resetRehearsalTargets(db)
    console.log(`cleanup: removed ${cleanup.deleted} mapped app rows`)
    for (const failure of cleanup.failed) console.log(`  cleanup failed: ${failure}`)
  }

  const blocked = second.filter((group) => group.status === 'blocked').map((group) => group.group)
  if (blocked.length > 0) {
    console.error(`blocked groups (no transformer yet): ${blocked.join(', ')}`)
    process.exitCode = 1
  }
  if (drift.length > 0 || errorsAfterSecond !== errorsAfterFirst) {
    process.exitCode = 1
  }
  await source.close?.()
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) await main()
