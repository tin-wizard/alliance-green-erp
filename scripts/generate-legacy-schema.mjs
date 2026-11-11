#!/usr/bin/env node
/**
 * Generates the legacy Drizzle schema from the cartographer's contract.
 *
 *   packages/db/contract/schema.json  (vendored from green-system/schema.json)
 *   packages/db/src/schema/legacy/*.ts
 *
 * Rules:
 *  - table and column names are the legacy MySQL names, unchanged;
 *  - MySQL types map to the closest Postgres type, preserving nullability;
 *  - PRIMARY / UNIQUE / INDEX keys become Postgres constraints, no FKs
 *    (the legacy tables have none, and migration data may violate them);
 *  - enum columns become named Postgres enums;
 *  - auto_increment becomes serial;
 *  - four do-not-carry tables are excluded (see EXCLUDED).
 *
 * Run: pnpm db:generate:schema
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const contractPath = join(root, 'packages/db/contract/schema.json')
const outDir = join(root, 'packages/db/src/schema/legacy')

/** Tables the rebuild refuses to carry. Each replacement is documented in DATA-LAYER.md. */
const EXCLUDED = new Map([
  ['user_permissions', 'app.user_permissions (single RBAC grant store)'],
  ['user_permissions_price_management', 'inventory:edit_price grant in app.user_permissions'],
  ['settings', 'typed configuration (env + app.settings when needed)'],
  ['wo_next_pid', 'identity column on workorder.id'],
])

/**
 * Business domain for each generated file. The cartographer's `domain` is the
 * starting point; master tables are split because they belong to different
 * module slices.
 */
const MASTER_DOMAIN = {
  users: 'identity',
  customer: 'customer',
  sites: 'customer',
  subcontractor: 'customer',
  subcontractor_contact_info: 'customer',
  suppliers: 'customer',
  parts: 'inventory',
  shared_parts_list: 'inventory',
  tjx_fixture: 'tjx',
  tjx_room: 'tjx',
}

function domainFor(table) {
  if (table.domain === 'master') return MASTER_DOMAIN[table.name] ?? 'lookup'
  if (table.domain === 'parts') return 'inventory'
  if (table.domain === 'quoting') return 'quote'
  if (table.domain === 'technical') {
    if (/^(sc_inv_|rejected_invoices$)/.test(table.name)) return 'invoice'
  }
  if (table.domain === 'workorder' && table.name.startsWith('inv_')) return 'invoice'
  return table.domain
}

const RESERVED = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'let',
  'static',
  'enum',
  'await',
  'implements',
  'package',
  'protected',
  'interface',
  'private',
  'public',
  'null',
  'true',
  'false',
])

function camel(value) {
  const parts = value.split(/[^A-Za-z0-9]+/).filter(Boolean)
  const out = parts
    .map((part, index) =>
      index === 0
        ? part[0].toLowerCase() + part.slice(1)
        : part[0].toUpperCase() + part.slice(1),
    )
    .join('')
  return RESERVED.has(out) ? `${out}Column` : out
}

function pascal(value) {
  const c = camel(value)
  return c[0].toUpperCase() + c.slice(1)
}

function shortName(value) {
  if (value.length <= 60) return value
  const hash = createHash('sha1').update(value).digest('hex').slice(0, 6)
  return `${value.slice(0, 53)}_${hash}`
}

function parseType(type) {
  const trimmed = type.trim()
  const match = /^([a-z]+)\s*(?:\((.*)\))?(?:\s+unsigned)?$/i.exec(trimmed)
  if (!match) throw new Error(`Unsupported MySQL type: ${type}`)
  return { base: match[1].toLowerCase(), args: match[2] }
}

function enumValues(args) {
  const values = []
  const re = /'((?:[^'\\]|\\.|'')*)'/g
  let match
  while ((match = re.exec(args)) !== null) {
    values.push(match[1].replace(/''/g, "'").replace(/\\'/g, "'").replace(/\\\\/g, '\\'))
  }
  return [...new Set(values)]
}

function columnBuilder(column, tableName, enumTypeName) {
  const { base, args } = parseType(column.type)
  const name = column.name
  const isAuto = column.extra === 'auto_increment'

  if (base === 'enum') {
    return `${enumTypeName}('${name}')`
  }
  if (base === 'int' || base === 'mediumint') {
    return isAuto ? `serial('${name}')` : `integer('${name}')`
  }
  if (base === 'tinyint' || base === 'smallint') {
    return isAuto ? `smallserial('${name}')` : `smallint('${name}')`
  }
  if (base === 'bigint') {
    return isAuto ? `bigserial('${name}', { mode: 'number' })` : `bigint('${name}', { mode: 'number' })`
  }
  if (base === 'decimal' || base === 'numeric') {
    const [precision, scale] = (args ?? '10,0').split(',').map((value) => Number(value.trim()))
    return `numeric('${name}', { precision: ${precision}, scale: ${scale ?? 0} })`
  }
  if (base === 'float' || base === 'double') return `doublePrecision('${name}')`
  if (base === 'varchar') {
    return args ? `varchar('${name}', { length: ${Number(args)} })` : `text('${name}')`
  }
  if (base === 'char') return `char('${name}', { length: ${Number(args)} })`
  if (base === 'text' || base === 'tinytext' || base === 'mediumtext' || base === 'longtext') {
    return `text('${name}')`
  }
  if (base === 'date') return `date('${name}', { mode: 'string' })`
  if (base === 'datetime' || base === 'timestamp') {
    return `timestamp('${name}', { mode: 'string', withTimezone: false })`
  }
  if (base === 'time') return `time('${name}')`
  if (base === 'year') return `smallint('${name}')`
  if (base === 'json') return `jsonb('${name}')`
  throw new Error(`Unsupported MySQL type for ${tableName}.${name}: ${column.type}`)
}

function generateTable(table) {
  const tableName = table.name
  const primary = table.keys.find((key) => key.type === 'PRIMARY')
  const primaryCols = primary?.columns ?? []
  const lines = []
  lines.push('/**')
  lines.push(` * ${table.name} — ${table.purpose ?? 'Legacy table.'}`)
  if (table.row_count_observed !== undefined) {
    lines.push(` * Rows observed: ${table.row_count_observed}. Engine: ${table.engine}.`)
  }
  lines.push(' *')
  lines.push(' * Legacy MySQL table. Names and nullability are preserved for migration parity.')
  if (table.name === 'workorder') {
    lines.push(' * `id` is app-assigned in the legacy system (`wo_next_pid`); it is NOT an identity here.')
  }
  if (table.name === 'inv_tax') {
    lines.push(' * Money columns are varchar in the legacy schema. Do not do arithmetic on them here.')
  }
  if (table.name === 'parts_salepurchase_log') {
    lines.push(' * `woid_poid`, `invoice_number` and `invoice_id` duplicate one identifier.')
  }
  lines.push(' */')
  lines.push(`export const legacy${pascal(tableName)} = pgTable(`)
  lines.push(`  '${tableName}',`)
  lines.push('  {')

  const enums = []
  for (const column of table.columns) {
    const { base, args } = parseType(column.type)
    let enumName
    if (base === 'enum') {
      enumName = `legacyEnum${pascal(tableName)}${pascal(column.name)}`
      enums.push({ constName: enumName, sqlName: shortName(`legacy_${tableName}_${column.name}`), values: enumValues(args ?? '') })
    }
    const builder = columnBuilder(column, tableName, enumName ?? 'text')
    const isSinglePrimary = primaryCols.length === 1 && primaryCols[0] === column.name
    const mods = []
    if (isSinglePrimary && column.extra !== 'auto_increment') mods.push('.primaryKey()')
    if (isSinglePrimary && column.extra === 'auto_increment') mods.push('.primaryKey()')
    if (!column.nullable && !(isSinglePrimary && column.extra === 'auto_increment')) mods.push('.notNull()')
    lines.push(`    ${camel(column.name)}: ${builder}${mods.join('')},`)
    if (column.notes) {
      lines.push(`    // ${String(column.notes).replaceAll('*/', '* /')}`)
    }
  }

  lines.push('  },')
  const extras = []
  if (primary && primary.columns.length > 1) {
    extras.push(`primaryKey({ columns: [${primary.columns.map((name) => `table.${camel(name)}`).join(', ')}] })`)
  }
  for (const key of table.keys) {
    if (key.type === 'PRIMARY') continue
    const name = shortName(`legacy_${tableName}_${key.name}`)
    const cols = key.columns.map((columnName) => `table.${camel(columnName)}`).join(', ')
    if (key.unique) extras.push(`uniqueIndex('${name}').on(${cols})`)
    else extras.push(`index('${name}').on(${cols})`)
  }
  if (extras.length > 0) {
    lines.push('  (table) => [')
    for (const extra of extras) lines.push(`    ${extra},`)
    lines.push('  ],')
  }
  lines.push(')')
  lines.push('')
  return { code: lines.join('\n'), enums }
}

function fileFor(domain, tables, generatedAt) {
  const enumBlocks = []
  const tableBlocks = []
  for (const table of tables) {
    const { code, enums } = generateTable(table)
    for (const e of enums) {
      enumBlocks.push(
        `export const ${e.constName} = pgEnum('${e.sqlName}', [${e.values.map((v) => JSON.stringify(v)).join(', ')}])`,
      )
    }
    tableBlocks.push(code)
  }
  const allCode = [...enumBlocks, ...tableBlocks].join('\n')
  const imports = new Set(['pgTable'])
  for (const builder of [
    'bigint',
    'bigserial',
    'boolean',
    'char',
    'date',
    'doublePrecision',
    'index',
    'integer',
    'jsonb',
    'numeric',
    'pgEnum',
    'primaryKey',
    'serial',
    'smallint',
    'smallserial',
    'text',
    'time',
    'timestamp',
    'uniqueIndex',
    'varchar',
  ]) {
    if (new RegExp(`\\b${builder}\\(`).test(allCode)) imports.add(builder)
  }
  // `primaryKey(` also appears in prose; only import it when an extras entry uses it.
  if (!/^\s{4}primaryKey\(/m.test(allCode)) imports.delete('primaryKey')
  const header = [
    '// @generated',
    `// Source: packages/db/contract/schema.json (${generatedAt}).`,
    '// Do not edit by hand. Run `pnpm db:generate:schema` after updating the contract.',
    `// Domain: ${domain}`,
    '',
    `import { ${[...imports].sort().join(', ')} } from 'drizzle-orm/pg-core'`,
    '',
  ].join('\n')
  return `${header}${enumBlocks.join('\n')}\n\n${tableBlocks.join('\n')}`
}

async function main() {
  const contract = JSON.parse(await readFile(contractPath, 'utf8'))
  const excluded = []
  const byDomain = new Map()

  for (const table of contract.tables) {
    if (EXCLUDED.has(table.name)) {
      excluded.push({ name: table.name, replacement: EXCLUDED.get(table.name) })
      continue
    }
    const domain = domainFor(table)
    if (!byDomain.has(domain)) byDomain.set(domain, [])
    byDomain.get(domain).push(table)
  }

  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const indexLines = [
    '// @generated',
    '// Generated legacy schema registry. Do not edit by hand.',
    '',
  ]
  for (const domain of [...byDomain.keys()].sort()) {
    const tables = byDomain.get(domain)
    const filename = `${domain}.ts`
    await writeFile(join(outDir, filename), fileFor(domain, tables, contract.generated))
    indexLines.push(`export * from './${domain}'`)
  }
  await writeFile(join(outDir, 'index.ts'), `${indexLines.join('\n')}\n`)

  const totalTables = [...byDomain.values()].reduce((sum, list) => sum + list.length, 0)
  const totalColumns = [...byDomain.values()]
    .flat()
    .reduce((sum, table) => sum + table.columns.length, 0)
  console.log(`Generated ${totalTables} legacy tables, ${totalColumns} columns, ${byDomain.size} files.`)
  console.log('Excluded:', excluded.map((e) => `${e.name} -> ${e.replacement}`).join('; '))
  for (const [domain, tables] of [...byDomain.entries()].sort()) {
    console.log(`  ${domain}: ${tables.length} tables`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
