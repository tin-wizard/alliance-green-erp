#!/usr/bin/env node
/**
 * Parses the legacy schema contract into `scripts/import/legacy-schema.json`.
 *
 * The contract file is `green-system/schema.sql` in the workstream's shared
 * documents (generated from information_schema on the recovered snapshot). The
 * parsed JSON is committed so the harness never depends on the shared folder at
 * build time.
 *
 * Usage:
 *   LEGACY_SCHEMA=/path/to/schema.sql node scripts/import/parse-legacy-schema.mjs
 *
 * To add tables the contract did not cover (the Bell tables came in the 2026-11
 * dump), pass a file holding only their CREATE TABLE statements and merge it in,
 * leaving every existing table exactly as it was:
 *   LEGACY_SCHEMA_MERGE=1 LEGACY_SCHEMA=/path/to/extra.sql node scripts/import/parse-legacy-schema.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source =
  process.env.LEGACY_SCHEMA ??
  '/Users/gene/.factory/spaces/4cfd5612-f10a-4d9f-af47-060fed6bc3c8/docs/green-system/schema.sql'

const sql = readFileSync(source, 'utf8')
const tables = {}

const tablePattern = /CREATE TABLE `([a-z0-9_]+)` \(([\s\S]*?)\n\) ENGINE=(\w+)[^;]*;/g
for (const match of sql.matchAll(tablePattern)) {
  const [, name, body, engine] = match
  const columns = []
  const primaryKey = []
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim().replace(/,$/, '')
    if (line.startsWith('PRIMARY KEY')) {
      const cols = [...line.matchAll(/`([a-z0-9_]+)`/g)].map((entry) => entry[1])
      primaryKey.push(...cols)
      continue
    }
    if (line.startsWith('KEY ') || line.startsWith('UNIQUE KEY ') || line.startsWith('CONSTRAINT')) {
      continue
    }
    const column = /^`([a-z0-9_]+)`\s+([a-z0-9_]+(?:\([^)]*\))?(?:\s+unsigned)?)/i.exec(line)
    if (!column) continue
    columns.push({
      name: column[1],
      type: column[2].toLowerCase(),
      notNull: /NOT NULL/i.test(line),
    })
  }
  tables[name] = { engine, primaryKey, columns }
}

const target = join(here, 'legacy-schema.json')
if (process.env.LEGACY_SCHEMA_MERGE === '1') {
  const existing = JSON.parse(readFileSync(target, 'utf8')).tables
  const added = Object.keys(tables).filter((name) => !(name in existing))
  const merged = { ...existing, ...Object.fromEntries(added.map((name) => [name, tables[name]])) }
  writeFileSync(target, `${JSON.stringify({ tables: merged }, null, 2)}\n`)
  console.log(`merged ${added.length} new tables (${Object.keys(tables).length - added.length} already present)`)
} else {
  writeFileSync(target, `${JSON.stringify({ tables }, null, 2)}\n`)
  console.log(`parsed ${Object.keys(tables).length} tables`)
}
