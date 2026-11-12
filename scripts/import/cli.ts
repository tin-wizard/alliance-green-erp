/**
 * Operator entry point: `pnpm migration:…`.
 *
 *   migration:load <dump.sql>     stage the dump, record checksums
 *   migration:run <dump.sql>      load, transform, parity, report
 *   migration:ddl [--write]       print or regenerate the staging DDL
 *   migration:rehearse [fixture]  two-pass rehearsal and report
 */
/* eslint-disable no-console */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from '@cls/db'
import { MANIFEST_VERSION, GROUPS } from './manifest'
import { loadSource, transformGroups } from './runner'
import { runParity, parityMarkdown } from './parity'
import {
  buildRunReport,
  exceptionsJson,
  exceptionsMarkdown,
  runJson,
  runMarkdown,
  shortDumpId,
} from './reports'
import type { LegacySource } from './types'

function dumpIdFor(path: string): string {
  const output = execFileSync('shasum', ['-a', '256', path], { encoding: 'utf8' })
  return `sha256:${output.trim().split(/\s+/)[0]}`
}

async function openSource(path: string): Promise<LegacySource> {
  const module = (await import('./source/dump')) as {
    DumpSource?: new (path: string) => LegacySource
  }
  if (!module.DumpSource) throw new Error('scripts/import/source/dump.ts does not export DumpSource')
  return new module.DumpSource(path)
}

async function load(path: string): Promise<{ dumpId: string; source: LegacySource }> {
  const db = getDb()
  const source = await openSource(path)
  // The file's identity is the uncompressed bytes, so a .sql.gz and its .sql are
  // the same dump and a rerun compares like with like.
  const dumpId = source.dumpInfo?.().dumpId ?? dumpIdFor(path)
  const report = await loadSource(db, source, dumpId)
  console.log(
    `loaded ${report.totalRows} rows in ${report.tables.length} tables (${report.skipped.length} dated duplicates skipped, ${report.missing.length} missing)`,
  )
  for (const missing of report.missing) console.log(`  missing: ${missing}`)
  return { dumpId, source }
}

async function main(): Promise<void> {
  const [command = 'help', ...rest] = process.argv.slice(2)
  const db = getDb()

  switch (command) {
    case 'load': {
      const path = rest[0]
      if (!path) throw new Error('usage: migration:load <dump.sql>')
      const { source } = await load(path)
      await source.close?.()
      return
    }
    case 'run': {
      const path = rest[0]
      if (!path) throw new Error('usage: migration:run <dump.sql> [--groups a,b]')
      const groupsFlag = rest.indexOf('--groups')
      const groups = groupsFlag >= 0 ? rest[groupsFlag + 1]?.split(',') : undefined
      const { dumpId, source } = await load(path)
      const reports = await transformGroups(db, {
        dumpId,
        groups,
        gitSha: process.env.GIT_SHA ?? 'unknown',
      })
      for (const report of reports) {
        console.log(`${report.group}: ${report.status}`)
        for (const entity of report.entities) {
          console.log(
            `  ${entity.entity}: ${entity.transformed}/${entity.sourceRows} mapped, ${entity.errors} errors`,
          )
        }
      }
      const parity = await runParity(db, { dumpId, groups })
      const data = await buildRunReport(db, {
        dumpId,
        gitSha: process.env.GIT_SHA ?? 'unknown',
        manifestVersion: MANIFEST_VERSION,
        parity,
        mode: 'apply',
      })
      const directory = join('reports', `migration-${shortDumpId(dumpId)}`)
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'run.json'), runJson(data))
      writeFileSync(join(directory, 'run.md'), runMarkdown(data))
      writeFileSync(join(directory, 'exceptions.json'), exceptionsJson(data))
      writeFileSync(join(directory, 'exceptions.md'), exceptionsMarkdown(data))
      writeFileSync(join(directory, 'parity.json'), `${JSON.stringify(parity, null, 2)}\n`)
      writeFileSync(join(directory, 'parity.md'), parityMarkdown(parity))
      console.log(`report written to ${directory}`)
      await source.close?.()
      if (data.totals.errors > 0) process.exitCode = 1
      return
    }
    case 'ddl': {
      const module = await import('./ddl')
      if (rest.includes('--write')) {
        module.writeStagingDdl()
        console.log('wrote packages/db/drizzle/0016_migration_staging.sql')
      } else {
        console.log(module.stagingDdl())
      }
      return
    }
    case 'groups': {
      for (const group of GROUPS) {
        console.log(`${group.order}. ${group.name} (${group.tables.length} tables) — transformer ${group.transformer ?? 'none'}`)
      }
      return
    }
    default:
      console.log('commands: load <dump.sql> | run <dump.sql> [--groups a,b] | ddl [--write] | groups')
  }
}

await main()
