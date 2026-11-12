/**
 * The tokenizer, judged against a real MySQL 5.7.
 *
 * A unit test can only prove the lexer agrees with itself. This test loads a
 * fixture into an actual MySQL, reads it back twice — once through `MysqlSource`
 * (the server's own answer) and once through `DumpSource` (our reading of
 * `mysqldump`'s text) — and requires the two to be identical, down to column
 * order and `null` versus `''`.
 *
 * Three dumps are compared because they take different paths through the lexer:
 * the default extended INSERT, `--complete-insert` (with a column list) and
 * `--hex-blob` (binary values become `0x...` literals instead of escaped text).
 *
 * The container is named and removed explicitly: a leaked 700 MB MySQL would
 * outlive the run and confuse the next one.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection } from 'mysql2/promise'
import type { RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SourceRow, SourceTable } from '../types'
import { DumpSource } from './dump'
import { MysqlSource } from './mysql'
import { parseDump } from './tokenizer'

const IMAGE = 'mysql:5.7'
const PASSWORD = 'legacy-root-pw'
const DATABASE = 'alliance_db'

/** Docker's CLI is the only contract here; no shell, no interpolation. */
function docker(args: string[], input?: Buffer): Buffer {
  return execFileSync('docker', args, {
    input,
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
      stdio: 'ignore',
      timeout: 15_000,
    })
    return true
  } catch {
    return false
  }
}

const hasDocker = dockerAvailable()

if (!hasDocker) {
  console.warn(
    'differential test skipped: docker is not available. Start Docker and rerun to compare the tokenizer against a real MySQL.',
  )
}

/**
 * `String.raw` keeps these bytes exactly as written, which is the point: they
 * are the escape sequences a dump contains, so doubling them would test nothing.
 * Table and column names are unquoted so no backtick needs escaping here.
 */
const NASTY_FIXTURE = String.raw`
SET NAMES latin1;
SET SESSION sql_mode = '';

DROP TABLE IF EXISTS nasty;
CREATE TABLE nasty (
  id int(11) NOT NULL,
  single_quote varchar(100) DEFAULT NULL,
  double_quote varchar(100) DEFAULT NULL,
  backslash varchar(100) DEFAULT NULL,
  newline_text varchar(100) DEFAULT NULL,
  tab_text varchar(100) DEFAULT NULL,
  cr_text varchar(100) DEFAULT NULL,
  nul_text varchar(100) DEFAULT NULL,
  ctrl_z varchar(100) DEFAULT NULL,
  percent_text varchar(100) DEFAULT NULL,
  accent varchar(100) DEFAULT NULL,
  empty_string varchar(100) DEFAULT NULL,
  null_text varchar(100) DEFAULT NULL,
  quoted_sql varchar(200) DEFAULT NULL,
  hex_bytes varbinary(50) DEFAULT NULL,
  amount decimal(10,2) DEFAULT NULL,
  whole_number int(11) DEFAULT NULL,
  is_flag tinyint(1) DEFAULT NULL,
  kind enum('alpha','beta') DEFAULT NULL,
  zero_date date DEFAULT NULL,
  zero_stamp datetime DEFAULT NULL,
  real_stamp datetime DEFAULT NULL,
  long_text text,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

INSERT INTO nasty (id, single_quote, double_quote, backslash, newline_text, tab_text, cr_text,
  nul_text, ctrl_z, percent_text, accent, empty_string, null_text, quoted_sql, hex_bytes,
  amount, whole_number, is_flag, kind, zero_date, zero_stamp, real_stamp, long_text)
VALUES (1,'it\'s','say \"hi\"','C:\\temp\\new','line one\nline two','a\tb','a\rb','a\0b',
  'a\Zb','100\% off','café üñ','',NULL,'it''s a \"quote\"; -- not a comment /* nor this */ # nor this',
  0x27415C4E,-1234.50,42,1,'beta','0000-00-00','0000-00-00 00:00:00','2024-02-29 23:59:58','short');

-- Only the key: every other column must come back as NULL, not as ''.
INSERT INTO nasty (id) VALUES (2);
-- Empty strings, a zero decimal and a single NUL byte, all distinct from NULL.
INSERT INTO nasty (id, single_quote, empty_string, quoted_sql, hex_bytes, amount, whole_number,
  is_flag, kind, zero_date)
VALUES (3,'','','',0x00,0.00,0,0,'alpha','0000-00-00');
-- Pushes the text well past any single-packet assumption.
INSERT INTO nasty (id, long_text) VALUES (4, REPEAT('aé', 2000));
`

/**
 * Reserved words as column names: mysqldump backticks them, and the tokenizer
 * must read backticked identifiers rather than falling over on `select`.
 */
const RESERVED_FIXTURE = `
SET NAMES latin1;
SET SESSION sql_mode = '';

DROP TABLE IF EXISTS \`reserved_words\`;
CREATE TABLE \`reserved_words\` (
  \`id\` int(11) NOT NULL,
  \`select\` varchar(20) DEFAULT NULL,
  \`from\` varchar(20) DEFAULT NULL,
  \`key\` varchar(20) DEFAULT NULL,
  \`order\` varchar(20) DEFAULT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
INSERT INTO \`reserved_words\` VALUES (1,'s','f','k','o'),(2,NULL,'f','','o');

DROP TABLE IF EXISTS \`empty_table\`;
CREATE TABLE \`empty_table\` (
  \`id\` int(11) NOT NULL,
  \`note\` text,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
`

const FIXTURE_TABLES = [
  { table: 'nasty', primaryKey: ['id'] },
  { table: 'empty_table', primaryKey: ['id'] },
  { table: 'reserved_words', primaryKey: ['id'] },
]

const DUMP_TABLE_ORDER = ['empty_table', 'nasty', 'reserved_words']

/** Key-sorted JSON, so object key order can never mask a difference. */
function sortedJson(row: SourceRow): string {
  const keys = Object.keys(row.values).sort()
  return JSON.stringify(keys.map((key) => [key, row.values[key]]))
}

function rowHash(row: SourceRow): string {
  return createHash('sha256').update(sortedJson(row)).digest('hex')
}

describe.skipIf(!hasDocker)('dump tokenizer vs a live MySQL 5.7', () => {
  let container = ''
  let port = 0
  let workDirectory = ''

  beforeAll(async () => {
    workDirectory = mkdtempSync(join(tmpdir(), 'dump-diff-'))
    const suffix = Math.random().toString(36).slice(2, 8)

    // A random port keeps concurrent runs apart; three attempts covers the odd
    // collision without ever reusing a container that half-started.
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3 && !container; attempt += 1) {
      const candidate = 33000 + Math.floor(Math.random() * 2000)
      const name = `cls-green-dump-diff-${suffix}-${attempt}`
      try {
        docker([
          'run',
          '-d',
          '--name',
          name,
          '-e',
          `MYSQL_ROOT_PASSWORD=${PASSWORD}`,
          '-e',
          'MYSQL_ROOT_HOST=%',
          '-e',
          `MYSQL_DATABASE=${DATABASE}`,
          '-p',
          `127.0.0.1:${candidate}:3306`,
          IMAGE,
          '--character-set-server=latin1',
          '--collation-server=latin1_swedish_ci',
          '--sql-mode=',
        ])
        container = name
        port = candidate
      } catch (error) {
        lastError = error
      }
    }
    if (!container) throw lastError ?? new Error('could not start a MySQL container')

    // The image runs a socket-only temporary server while it initialises, so a
    // successful query there proves nothing. A TCP connection that still works
    // one second later is the real server.
    try {
      const deadline = Date.now() + 90_000
      for (;;) {
        if (Date.now() > deadline)
          throw new Error(`MySQL container ${container} never became ready`)
        try {
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const probe = await createConnection({
              host: '127.0.0.1',
              port,
              user: 'root',
              password: PASSWORD,
              database: DATABASE,
            })
            await probe.query('SELECT 1')
            await probe.end()
            await new Promise((resolve) => setTimeout(resolve, 1000))
          }
          break
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }

      docker(
        [
          'exec',
          '-i',
          container,
          'mysql',
          '-uroot',
          `-p${PASSWORD}`,
          '--default-character-set=latin1',
          DATABASE,
        ],
        Buffer.from(NASTY_FIXTURE + RESERVED_FIXTURE, 'latin1'),
      )
    } catch (error) {
      // A container that half-started must not outlive a failed setup, whatever
      // the runner decides to do with afterAll afterwards.
      try {
        docker(['rm', '-f', container])
      } catch {
        // Nothing left to remove.
      }
      throw error
    }
  }, 180_000)

  afterAll(async () => {
    if (container) {
      try {
        docker(['rm', '-f', container])
      } catch {
        // Already removed by the setup failure path.
      }
    }
    if (workDirectory) rmSync(workDirectory, { recursive: true, force: true })
  }, 60_000)

  function dumpPath(variant: string, extra: string[]): string {
    const path = join(workDirectory, `dump-${variant}.sql`)
    const dump = docker([
      'exec',
      container,
      'mysqldump',
      '-uroot',
      `-p${PASSWORD}`,
      '--default-character-set=latin1',
      '--skip-dump-date',
      '--no-tablespaces',
      ...extra,
      DATABASE,
    ])
    writeFileSync(path, dump)
    return path
  }

  it('agrees with MySQL on every table, column and row', async () => {
    const live = new MysqlSource(
      { host: '127.0.0.1', port, user: 'root', password: PASSWORD, database: DATABASE },
      FIXTURE_TABLES,
    )

    const dumps = [
      dumpPath('plain', []),
      dumpPath('complete', ['--complete-insert']),
      dumpPath('hex', ['--complete-insert', '--hex-blob']),
    ]

    const liveTables = await live.listTables()
    // The live source keeps the caller's dependency order; the dump lists its
    // tables alphabetically. Both sets must be the same.
    expect(liveTables).toEqual(FIXTURE_TABLES.map((entry) => entry.table))

    let comparisons = 0
    try {
      for (const path of dumps) {
        const dumped = new DumpSource(path)
        // Same tables; the dump lists them alphabetically, the source keeps the
        // caller's dependency order.
        expect(await dumped.listTables(), `${path} table order`).toEqual(DUMP_TABLE_ORDER)

        for (const table of liveTables) {
          const liveTable = await live.readTable(table)
          const dumpTable = await dumped.readTable(table)

          expect(dumpTable.columns, `${path} ${table} column order`).toEqual(liveTable.columns)
          expect(dumpTable.rows.length, `${path} ${table} row count`).toBe(liveTable.rows.length)
          expect(
            dumpTable.rows.map((row) => row.rowNo),
            `${path} ${table} row numbers`,
          ).toEqual(liveTable.rows.map((row) => row.rowNo))
          expect(dumpTable.rows.map(sortedJson), `${path} ${table} values`).toEqual(
            liveTable.rows.map(sortedJson),
          )
          expect(dumpTable.rows.map(rowHash), `${path} ${table} row hashes`).toEqual(
            liveTable.rows.map(rowHash),
          )
          comparisons += liveTable.rows.length
        }

        await dumped.close()
      }
    } finally {
      await live.close()
    }

    // 4 nasty rows + 0 empty_table + 2 reserved_words, through three dumps.
    expect(comparisons).toBe(18)
  }, 60_000)

  it('keeps NULL and the empty string apart on both sides', async () => {
    const live = new MysqlSource(
      { host: '127.0.0.1', port, user: 'root', password: PASSWORD, database: DATABASE },
      FIXTURE_TABLES,
    )
    const dumped = new DumpSource(dumpPath('plain', []))

    try {
      const liveTable = await live.readTable('nasty')
      const dumpTable = await dumped.readTable('nasty')
      const byId = (table: SourceTable, id: string): Record<string, string | null> => {
        const row = table.rows.find((entry) => entry.values.id === id)
        if (!row) throw new Error(`row ${id} missing from ${table.table}`)
        return row.values
      }

      const liveEmpty = byId(liveTable, '3')
      const dumpEmpty = byId(dumpTable, '3')
      expect(dumpEmpty.single_quote).toBe('')
      expect(dumpEmpty.null_text).toBeNull()
      expect(dumpEmpty.hex_bytes).toBe('\0')
      expect(dumpEmpty).toEqual(liveEmpty)

      // Row 2 has only a key: everything else must be NULL, never ''.
      const dumpNulls = byId(dumpTable, '2')
      const liveNulls = byId(liveTable, '2')
      expect(dumpNulls).toEqual(liveNulls)
      for (const [column, value] of Object.entries(dumpNulls)) {
        if (column === 'id') continue
        expect(value, `${column} should be NULL`).toBeNull()
      }

      // The noisy row, spelled out: escapes must survive both readings.
      expect(byId(dumpTable, '1')).toEqual(byId(liveTable, '1'))
      expect(byId(dumpTable, '1').nul_text).toBe('a\0b')
      expect(byId(dumpTable, '1').accent).toBe('café üñ')
      expect(byId(dumpTable, '1').zero_date).toBe('0000-00-00')
      expect(byId(dumpTable, '1').zero_stamp).toBe('0000-00-00 00:00:00')
    } finally {
      await live.close()
    }
  }, 60_000)

  it('parses the LIKE wildcard escapes exactly as the server does', async () => {
    // mysqldump re-escapes a stored backslash, so a round trip through a dump
    // cannot show what `\%` means. Comparing the same bytes through both parsers
    // can.
    const statement = String.raw`INSERT INTO t VALUES ('a\%b'),('a\_b'),('a\\%b')`
    const parsed = parseDump(String.raw`CREATE TABLE t (v text);` + statement).tables[0]!.rows.map(
      (row) => row.values.v,
    )

    const connection = await createConnection({
      host: '127.0.0.1',
      port,
      user: 'root',
      password: PASSWORD,
      database: DATABASE,
      charset: 'latin1',
    })
    try {
      const [rows] = await connection.query<RowDataPacket[]>({
        sql: String.raw`SELECT 'a\%b' AS first, 'a\_b' AS second, 'a\\%b' AS third`,
      })
      const live = rows[0] as { first: string; second: string; third: string }
      expect(parsed).toEqual([live.first, live.second, live.third])
    } finally {
      await connection.end()
    }
  }, 60_000)

  it('reads a dump that is really latin1 and really escaped', () => {
    // Without this, a dump that happened to be pure ASCII would let every value
    // comparison above pass while proving nothing about encoding or escapes.
    const raw = readFileSync(dumpPath('bytes', ['--complete-insert']))
    expect(raw.includes(0xe9), 'latin1 byte for é').toBe(true)
    expect(raw.includes(Buffer.from('c3a9', 'hex')), 'no UTF-8 é').toBe(false)
    expect(raw.includes(Buffer.from(String.raw`\0`, 'latin1')), 'NUL escape').toBe(true)
    expect(raw.includes(Buffer.from(String.raw`\\`, 'latin1')), 'backslash escape').toBe(true)
    expect(raw.includes(Buffer.from(String.raw`\'`, 'latin1')), 'quote escape').toBe(true)
    expect(raw.toString('latin1')).toContain("'0000-00-00 00:00:00'")
  }, 60_000)

  it('hashes the bytes it read, not the text it decoded', () => {
    const path = dumpPath('hash', ['--complete-insert'])
    const raw = readFileSync(path)
    const info = new DumpSource(path).dumpInfo()

    expect(info.checksum).toBe(createHash('sha256').update(raw).digest('hex'))
    expect(info.dumpId).toBe(`sha256:${info.checksum}`)
    expect(info.sizeBytes).toBe(raw.length)
    expect(info.path).toBe(path)
  }, 60_000)
})
