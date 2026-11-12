/**
 * Guards the synthetic dump: shape, counts, skip list, determinism.
 *
 * The tokenizer has its own tests; this one parses the file only far enough to
 * prove the generator did what it promised, so a broken fixture fails here and
 * not three groups into a rehearsal.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ALL_TABLES, SKIPPED_DATED_DUPLICATES } from '../manifest'
import { buildFixture, DUMP_PATH, FIXTURE_FILE, GENERATED_AT, MANIFEST_PATH } from './generate'

interface FixtureManifest {
  generatedAt: string
  source: string
  file: string
  sha256: string
  sizeBytes: number
  tables: { table: string; rows: number }[]
  nastyCases: { case: string; where: string }[]
}

const committedBytes = readFileSync(DUMP_PATH)
const committedSql = committedBytes.toString('latin1')
const committedManifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FixtureManifest
const legacy = JSON.parse(
  readFileSync(new URL('../legacy-schema.json', import.meta.url), 'utf8'),
) as { tables: Record<string, { columns: { name: string }[] }> }

/** Column values of one table's INSERT, in dump order. */
type ParsedRow = (string | null | { hex: string })[]

function createTableCounts(sql: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const match of sql.matchAll(/^CREATE TABLE `([^`]+)` \(/gm)) {
    const name = match[1] ?? ''
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return counts
}

/** One INSERT per table, so the body is everything up to the closing `;\n`. */
function insertBody(sql: string, table: string): string | undefined {
  const marker = `INSERT INTO \`${table}\` VALUES `
  const start = sql.indexOf(marker)
  if (start === -1) return undefined
  const bodyStart = start + marker.length
  const bodyEnd = sql.indexOf(';\n', bodyStart)
  return sql.slice(bodyStart, bodyEnd)
}

/**
 * Minimal tuple reader: quoted strings with backslash escapes, bare numbers,
 * NULL and 0x literals. The tokenizer under test is a separate, fuller parser;
 * this one only has to agree with what this generator writes.
 */
function parseRows(body: string): ParsedRow[] {
  const rows: ParsedRow[] = []
  let index = 0
  let row: ParsedRow | null = null
  let expectValue = false
  const escapes: Record<string, string> = {
    '0': '\0',
    n: '\n',
    r: '\r',
    Z: '\u001a',
    "'": "'",
    '"': '"',
    '\\': '\\',
  }

  while (index < body.length) {
    const character = body[index]
    if (character === '(') {
      row = []
      rows.push(row)
      expectValue = true
      index += 1
      continue
    }
    if (character === ')') {
      expectValue = false
      index += 1
      continue
    }
    if (character === ',') {
      expectValue = row !== null
      index += 1
      continue
    }
    if (character === ' ') {
      index += 1
      continue
    }
    if (!expectValue || row === null) throw new Error(`unexpected ${character} at ${index}`)

    if (character === "'") {
      let value = ''
      index += 1
      for (;;) {
        const current = body[index]
        if (current === undefined) throw new Error(`unterminated string at ${index}`)
        if (current === '\\') {
          const next = body[index + 1] ?? ''
          value += escapes[next] ?? next
          index += 2
          continue
        }
        if (current === "'") {
          index += 1
          break
        }
        value += current
        index += 1
      }
      row.push(value)
      expectValue = false
      continue
    }
    if (body.startsWith('NULL', index)) {
      row.push(null)
      index += 4
      expectValue = false
      continue
    }
    if (body.startsWith('0x', index)) {
      const start = index
      while (index < body.length && /[0-9a-fA-Fx]/.test(body[index] ?? '')) index += 1
      row.push({ hex: body.slice(start, index) })
      expectValue = false
      continue
    }
    const start = index
    while (index < body.length && /[-0-9.a-zA-Z+]/.test(body[index] ?? '')) index += 1
    if (start === index) throw new Error(`unreadable value at ${index}`)
    const token = body.slice(start, index)
    // mysqldump only ever writes numbers bare; anything else must be quoted, or
    // the reader sees an identifier (and the column count silently changes).
    if (!/^[-+]?\d*\.?\d+$/.test(token)) {
      throw new Error(`unquoted non-numeric literal ${JSON.stringify(token)}`)
    }
    row.push(token)
    expectValue = false
  }
  return rows
}

function rowsOf(table: string): ParsedRow[] {
  const body = insertBody(committedSql, table)
  return body === undefined ? [] : parseRows(body)
}

function columnOf(table: string, column: string): number {
  const definition = (legacy.tables as Record<string, { columns: { name: string }[] }>)[table]
  if (!definition) throw new Error(`${table} is not in legacy-schema.json`)
  const index = definition.columns.findIndex((entry) => entry.name === column)
  if (index === -1) throw new Error(`${table} has no column ${column}`)
  return index
}

function valuesOf(table: string, column: string): (string | null | { hex: string })[] {
  const index = columnOf(table, column)
  return rowsOf(table).map((row) => row[index] ?? null)
}

describe('synthetic legacy dump', () => {
  it('declares and fills every table in the load manifest', () => {
    const creates = createTableCounts(committedSql)
    for (const entry of ALL_TABLES) {
      expect(creates.get(entry.table), `CREATE TABLE ${entry.table}`).toBe(1)
      // Tables the manifest classifies with zero fixture rows are created and
      // left empty, exactly as mysqldump leaves an empty table: no INSERT line.
      if (entry.fixtureRows > 0) {
        expect(insertBody(committedSql, entry.table), `INSERT ${entry.table}`).toBeDefined()
      }
    }
  })

  it('writes exactly the row count the fixture manifest claims', () => {
    const counts = new Map(committedManifest.tables.map((entry) => [entry.table, entry.rows]))
    for (const entry of ALL_TABLES) {
      expect(rowsOf(entry.table).length, entry.table).toBe(entry.fixtureRows)
      expect(counts.get(entry.table), `${entry.table} in manifest.json`).toBe(entry.fixtureRows)
    }
    const total = committedManifest.tables.reduce((sum, entry) => sum + entry.rows, 0)
    const parsed = committedManifest.tables.reduce(
      (sum, entry) => sum + rowsOf(entry.table).length,
      0,
    )
    expect(parsed).toBe(total)
  })

  it('writes each row with exactly its table columns', () => {
    for (const entry of ALL_TABLES) {
      const definition = legacy.tables[entry.table]
      if (!definition) throw new Error(`${entry.table} is not in legacy-schema.json`)
      for (const row of rowsOf(entry.table)) {
        expect(row.length, `${entry.table} row width`).toBe(definition.columns.length)
      }
    }
  })

  it('keeps dated duplicate copies in the file and out of the load manifest', () => {
    const creates = createTableCounts(committedSql)
    const dumped = new Set(committedManifest.tables.map((entry) => entry.table))
    for (const table of SKIPPED_DATED_DUPLICATES) {
      expect(
        ALL_TABLES.some((entry) => entry.table === table),
        `${table} loadable`,
      ).toBe(false)
    }
    // The four copies the generator writes are present so the loader can prove
    // it skips them; the other two are classification-only and not in the file.
    for (const table of [
      'inv_parts_july_20_2025',
      'parts_backup_17dec25',
      'po_status_v2',
      'workorder_backup_2025',
    ]) {
      expect(creates.get(table), `CREATE TABLE ${table}`).toBe(1)
      expect(dumped.has(table), `${table} in manifest.json`).toBe(true)
      expect(rowsOf(table).length, `${table} rows`).toBe(1)
    }
  })

  it('regenerates byte-identically', () => {
    const first = buildFixture()
    const second = buildFixture()
    expect(first.manifest.sha256).toBe(second.manifest.sha256)
    expect(first.bytes.equals(second.bytes)).toBe(true)

    const committedSha = createHash('sha256').update(committedBytes).digest('hex')
    expect(committedManifest.sha256).toBe(committedSha)
    expect(first.manifest.sha256).toBe(committedSha)
    expect(committedManifest.sizeBytes).toBe(committedBytes.length)
    expect(committedManifest.file).toBe(FIXTURE_FILE)
    expect(committedManifest.generatedAt).toBe(GENERATED_AT)
  })

  it('carries the documented nasty cases', () => {
    const usernames = valuesOf('users', 'username')
    expect(usernames.length).toBe(12)
    expect(usernames.filter((value) => value === 'jsmith').length).toBe(2)
    const enabled = valuesOf('users', 'is_enabled')
    expect(enabled.filter((value) => value === '0').length).toBe(3)
    expect(valuesOf('users', 'email')).toContain('')
    expect(valuesOf('users', 'subid')).toContain('99')

    const workOrderIds = valuesOf('workorder', 'id')
    for (const id of ['0', '9999998', '9999999', '44444444', '99999999']) {
      expect(workOrderIds, `workorder ${id}`).toContain(id)
    }

    // 4 orphan wo_parts, partno '---' and '--', and latin1 text with a newline.
    const woPartWoids = valuesOf('wo_parts', 'woid')
    expect(woPartWoids.filter((value) => String(value).startsWith('88888')).length).toBe(4)
    expect(valuesOf('wo_parts', 'partno')).toEqual(expect.arrayContaining(['---', '--']))
    expect(committedSql).toContain("L\\'Alliance")
    expect(committedSql).toContain('C:\\\\alliance')
    expect(committedSql).toContain('\\n')

    // Money stored as text: blank, formatted and non-numeric all present.
    const taxAmounts = valuesOf('inv_tax', 'tax_amount')
    expect(taxAmounts).toContain('')
    expect(taxAmounts).toContain('$13.00')
    expect(taxAmounts).toContain('n/a')
    expect(taxAmounts).toContain('0.00')
    expect(valuesOf('po_parts', 'price')).toEqual(expect.arrayContaining(['', '$1,234.50', 'n/a']))

    // Over-received PO line needs a synthetic receipt larger than the order.
    const ordered = valuesOf('po_parts', 'qty').map(Number)
    const received = valuesOf('po_parts', 'qty_received').map(Number)
    expect(received.some((value, index) => value > (ordered[index] ?? 0))).toBe(true)

    // Zero dates and empty-string versus NULL in more than one table.
    expect(committedSql).toContain("'0000-00-00'")
    expect(valuesOf('inv_hours', 'date')).toContain('0000-00-00')
    expect(valuesOf('inv_project', 'sage_project_workorder')).toContain('')
    expect(valuesOf('inv_project', 'sage_project_workorder')).toContain(null)

    // Hex literal for the tokenizer; no legacy table declares a BLOB.
    expect(committedSql).toContain('0xDEADBEEF')
    expect(committedManifest.nastyCases.length).toBeGreaterThan(20)
  })
})
