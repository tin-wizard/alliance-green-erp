/**
 * `LegacySource` over a restored scratch MySQL.
 *
 * This is the reference reading of the dump: MySQL itself parses the file, so
 * these values are what the legacy server believed. The tokenizer is judged
 * against this source, never the other way round.
 *
 * Four connection options are load-bearing:
 * - `charset: 'latin1'` — the server sends latin1 bytes and mysql2 converts to
 *   UTF-8 exactly once, the same single conversion the dump reader performs.
 * - `dateStrings: true` — `0000-00-00` stays the text MySQL stores instead of
 *   becoming a Date, which would throw or invent a date.
 * - `supportBigNumbers`/`bigNumberStrings` — a `bigint` column keeps full
 *   precision as text instead of degrading through a JS number.
 */
import { createConnection } from 'mysql2/promise'
import type { Connection, ConnectionOptions, FieldPacket, RowDataPacket } from 'mysql2/promise'
import type { LegacySource, SourceRow, SourceTable } from '../types'

export type MysqlConnectionConfig = ConnectionOptions & { database: string }

export interface MysqlTableSpec {
  table: string
  /** Read order. Without it a row order is not reproducible between runs. */
  primaryKey: string[]
}

/** A bare name (no ordering) is accepted so a caller can pass `ALL_TABLES.map(t => t.table)`. */
export type MysqlTableInput = string | MysqlTableSpec

function quoteIdentifier(name: string): string {
  return `\`${name.replaceAll('`', '``')}\``
}

/** Every cell leaves this source as text, exactly as MySQL renders it. */
function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'boolean') return value ? '1' : '0'
  // BINARY/VARBINARY/BLOB arrive as bytes; latin1 is the charset they were
  // written in, and the encoding conversion already happened at the wire.
  if (Buffer.isBuffer(value)) return value.toString('latin1')
  if (value instanceof Date) {
    // Only reachable when a caller overrides `dateStrings`; keep the wall clock.
    const pad = (part: number): string => String(part).padStart(2, '0')
    const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
    const time = `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
    return `${date} ${time}`
  }
  return String(value)
}

function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null | undefined)?.code
  return code === 'ER_NO_SUCH_TABLE' || code === 'ER_BAD_TABLE_ERROR'
}

export class MysqlSource implements LegacySource {
  private connection: Connection | null = null
  private readonly spec: Map<string, MysqlTableSpec>
  private readonly order: string[]

  constructor(
    private readonly config: MysqlConnectionConfig,
    tables: readonly MysqlTableInput[],
  ) {
    this.spec = new Map()
    this.order = []
    for (const entry of tables) {
      const spec: MysqlTableSpec =
        typeof entry === 'string' ? { table: entry, primaryKey: [] } : entry
      if (this.spec.has(spec.table)) continue
      this.spec.set(spec.table, spec)
      this.order.push(spec.table)
    }
  }

  async listTables(): Promise<string[]> {
    const connection = await this.connect()
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
      [this.config.database],
    )
    const present = new Set(rows.map((row) => String(row.name)))
    // The caller's order is the loader's dependency order; the server's is
    // alphabetical. Keep the caller's.
    return this.order.filter((table) => present.has(table))
  }

  async readTable(table: string): Promise<SourceTable> {
    const connection = await this.connect()
    const primaryKey = this.spec.get(table)?.primaryKey ?? []
    const orderBy =
      primaryKey.length > 0 ? ` ORDER BY ${primaryKey.map(quoteIdentifier).join(', ')}` : ''

    // One query per table: mysql2's promise API materialises a result set, and a
    // table is the smallest unit the loader can retire, so this is the memory
    // ceiling by design rather than an accident.
    let queried: [RowDataPacket[], FieldPacket[]]
    try {
      queried = await connection.query<RowDataPacket[]>({
        sql: `SELECT * FROM ${quoteIdentifier(table)}${orderBy}`,
        rowsAsArray: true,
      })
    } catch (error) {
      // A table the restored dump lacks is "no rows here", not a run failure.
      if (isMissingTable(error)) return { table, columns: [], rows: [] }
      throw error
    }

    // rowsAsArray gives tuples, but the typing says objects; the cast is the
    // price of keeping column order without a name lookup per cell.
    const [rows, fields] = queried
    const matrix = rows as unknown as unknown[][]
    const columns = fields.map((field) => field.name)

    const result: SourceRow[] = []
    for (let index = 0; index < matrix.length; index += 1) {
      const tuple = matrix[index] ?? []
      const values: Record<string, string | null> = {}
      for (let column = 0; column < columns.length; column += 1) {
        values[columns[column]!] = toText(tuple[column])
      }
      result.push({ rowNo: index + 1, values })
    }

    return { table, columns, rows: result }
  }

  async close(): Promise<void> {
    const connection = this.connection
    this.connection = null
    if (connection) await connection.end()
  }

  private async connect(): Promise<Connection> {
    if (this.connection) return this.connection
    const connection = await createConnection({
      ...this.config,
      charset: 'latin1',
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
    })
    // The scratch restore exists to be read. If a transform ever gets hold of
    // this connection, a write fails here instead of corrupting the reference.
    await connection.query('SET SESSION TRANSACTION READ ONLY')
    this.connection = connection
    return connection
  }
}
