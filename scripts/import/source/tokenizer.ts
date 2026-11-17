/**
 * The lexer behind `DumpSource`: `mysqldump` output in, tables and rows out.
 *
 * A dump cannot be cut up with a regex: a value may contain `;`, `--`, `#`,
 * `/*`, newlines and latin1 bytes, and mysqldump wraps half the file in
 * `/*!40101 ... *\/` conditional comments. So the file is scanned one character
 * at a time with explicit states — code, single-quoted, double-quoted,
 * backtick-quoted, line comment, block comment — and only then are statements
 * cut at the delimiter and handed to a parser that understands two shapes:
 * CREATE TABLE (for column order) and INSERT (for values). Every other
 * statement is recognised and dropped, because the loader never needs more.
 *
 * Encoding is latin1 and is decoded exactly once, by `decodeDumpText`. Decoding
 * twice turns `é` into `Ã©`; not decoding leaves UTF-8 bytes that Postgres
 * stores as mojibake. There is no second chance further down the pipeline.
 */
import { createHash } from 'node:crypto'
import type { SourceRow, SourceTable } from '../types'

/** Only the shapes the two supported statements need. */
type TokenType = 'string' | 'identifier' | 'number' | 'hex' | 'word' | 'punct'

interface Token {
  type: TokenType
  /**
   * Unescaped payload: the contents of a string, an identifier without its
   * backticks, the literal text of a number, or a hex literal's digits.
   */
  value: string
}

export class DumpSyntaxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DumpSyntaxError'
  }
}

/** A table entry of a CREATE TABLE is a constraint, not a column, if it starts so. */
const CONSTRAINT_KEYWORDS = new Set([
  'KEY',
  'PRIMARY',
  'UNIQUE',
  'INDEX',
  'FULLTEXT',
  'SPATIAL',
  'FOREIGN',
  'CHECK',
  'CONSTRAINT',
])

/** Words that may sit between INSERT and INTO. */
const INSERT_MODIFIERS = new Set(['LOW_PRIORITY', 'DELAYED', 'HIGH_PRIORITY', 'IGNORE'])

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v'
}

function isDigit(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return code >= 48 && code <= 57
}

function isHexDigit(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102)
}

function isWordStart(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    code === 36 ||
    code >= 0x80
  )
}

function isWordPart(ch: string): boolean {
  return isWordStart(ch) || isDigit(ch)
}

/**
 * The value of a backslash escape inside a string literal.
 *
 * `\%` and `\_` keep their backslash: MySQL only strips it in pattern-matching
 * contexts, and a dump's value is not a pattern. Unknown escapes lose the
 * backslash, which is what the server does when it re-reads the dump.
 */
function unescapeChar(ch: string): string {
  switch (ch) {
    case '0':
      return '\0'
    case 'b':
      return '\b'
    case 'n':
      return '\n'
    case 'r':
      return '\r'
    case 't':
      return '\t'
    case 'Z':
      return '\u001a'
    case '%':
    case '_':
      return `\\${ch}`
    case '\\':
    case "'":
    case '"':
      return ch
    default:
      return ch
  }
}

interface MutableTable {
  table: string
  columns: string[]
  rows: SourceRow[]
  /** Rows already handed to a consumer by `parseDumpSlices`; keeps row numbers global. */
  flushed: number
}

/**
 * Cuts the text into statements of tokens.
 *
 * The delimiter is tracked because mysqldump wraps routines in `DELIMITER ;;`;
 * without that, a `;` inside a routine body would split a statement in half and
 * the second half would be parsed as garbage.
 */
class StatementScanner {
  private index = 0
  private delimiter = ';'

  constructor(private readonly text: string) {}

  nextStatement(): Token[] | null {
    const text = this.text
    const tokens: Token[] = []

    while (this.index < text.length) {
      const ch = text.charAt(this.index)

      if (isSpace(ch)) {
        this.index += 1
        continue
      }

      if (ch === '#') {
        this.skipLine()
        continue
      }

      // `--` is only a comment when followed by whitespace or end of file.
      if (ch === '-' && text.charAt(this.index + 1) === '-') {
        const after = text.charAt(this.index + 2)
        if (after === '' || isSpace(after)) {
          this.skipLine()
          continue
        }
      }

      // Covers both `/* ... *\/` and `/*!40101 ... *\/` conditional comments.
      // The conditional body is executable SQL, but in a dump it is always SET
      // or ALTER TABLE, so dropping it is the same decision as dropping the
      // plain comment.
      if (ch === '/' && text.charAt(this.index + 1) === '*') {
        this.skipBlockComment()
        continue
      }

      if (tokens.length === 0 && (ch === 'D' || ch === 'd') && this.atWord('DELIMITER')) {
        this.readDelimiter()
        continue
      }

      if (text.startsWith(this.delimiter, this.index)) {
        this.index += this.delimiter.length
        if (tokens.length > 0) return tokens
        continue
      }

      tokens.push(this.readToken())
    }

    return tokens.length > 0 ? tokens : null
  }

  private atWord(word: string): boolean {
    const end = this.index + word.length
    if (this.text.slice(this.index, end).toUpperCase() !== word) return false
    return !isWordPart(this.text.charAt(end))
  }

  private skipLine(): void {
    const end = this.text.indexOf('\n', this.index)
    this.index = end === -1 ? this.text.length : end + 1
  }

  private skipBlockComment(): void {
    const end = this.text.indexOf('*/', this.index + 2)
    this.index = end === -1 ? this.text.length : end + 2
  }

  private readDelimiter(): void {
    const end = this.text.indexOf('\n', this.index)
    const line = end === -1 ? this.text.slice(this.index) : this.text.slice(this.index, end)
    const value = line.slice('DELIMITER'.length).trim()
    if (value !== '') this.delimiter = value
    this.index = end === -1 ? this.text.length : end + 1
  }

  private readToken(): Token {
    const text = this.text
    const ch = text.charAt(this.index)

    if (ch === "'") return { type: 'string', value: this.readQuoted("'", true) }
    if (ch === '"') return { type: 'string', value: this.readQuoted('"', true) }
    // Identifiers escape their quote by doubling it, never with a backslash.
    if (ch === '`') return { type: 'identifier', value: this.readQuoted('`', false) }

    if (isDigit(ch) || (ch === '-' && isDigit(text.charAt(this.index + 1)))) {
      return this.readNumber()
    }

    if (isWordStart(ch)) {
      const start = this.index
      while (isWordPart(text.charAt(this.index))) this.index += 1
      return { type: 'word', value: text.slice(start, this.index) }
    }

    this.index += 1
    return { type: 'punct', value: ch }
  }

  private readQuoted(quote: string, escapes: boolean): string {
    const text = this.text
    let out = ''
    this.index += 1

    while (this.index < text.length) {
      const ch = text.charAt(this.index)

      if (escapes && ch === '\\') {
        const next = text.charAt(this.index + 1)
        if (next === '') break
        out += unescapeChar(next)
        this.index += 2
        continue
      }

      if (ch === quote) {
        if (text.charAt(this.index + 1) === quote) {
          out += quote
          this.index += 2
          continue
        }
        this.index += 1
        return out
      }

      out += ch
      this.index += 1
    }

    throw new DumpSyntaxError(`unterminated ${quote} literal at offset ${this.index}`)
  }

  private readNumber(): Token {
    const text = this.text
    const start = this.index

    if (text.charAt(this.index) === '0') {
      const marker = text.charAt(this.index + 1)
      if ((marker === 'x' || marker === 'X') && isHexDigit(text.charAt(this.index + 2))) {
        this.index += 2
        const digits = this.index
        while (isHexDigit(text.charAt(this.index))) this.index += 1
        return { type: 'hex', value: text.slice(digits, this.index) }
      }
    }

    if (text.charAt(this.index) === '-') this.index += 1
    while (isDigit(text.charAt(this.index))) this.index += 1
    if (text.charAt(this.index) === '.') {
      this.index += 1
      while (isDigit(text.charAt(this.index))) this.index += 1
    }
    const exponent = text.charAt(this.index)
    if (exponent === 'e' || exponent === 'E') {
      this.index += 1
      const sign = text.charAt(this.index)
      if (sign === '+' || sign === '-') this.index += 1
      while (isDigit(text.charAt(this.index))) this.index += 1
    }

    return { type: 'number', value: text.slice(start, this.index) }
  }
}

interface NameSegment {
  value: string
  next: number
}

/** Reads a (possibly schema-qualified) table name, returning its last segment. */
function readName(tokens: Token[], start: number): NameSegment | null {
  const first = tokens[start]
  if (!first) return null
  if (first.type !== 'identifier' && first.type !== 'word' && first.type !== 'string') return null

  let index = start + 1
  let value = first.value
  while (tokens[index]?.type === 'punct' && tokens[index]?.value === '.') {
    const segment = tokens[index + 1]
    if (!segment) break
    if (segment.type !== 'identifier' && segment.type !== 'word' && segment.type !== 'string') break
    value = segment.value
    index += 2
  }

  return { value, next: index }
}

function pushColumn(entry: Token[], columns: string[]): void {
  const first = entry[0]
  if (!first) return
  // A bare word first token is a column only if it is not a constraint opener.
  if (first.type === 'word' && CONSTRAINT_KEYWORDS.has(first.value.toUpperCase())) return
  if (first.type !== 'identifier' && first.type !== 'word') return
  if (entry.length < 2) return
  if (columns.includes(first.value)) return
  columns.push(first.value)
}

function parseCreateTable(
  tokens: Token[],
  start: number,
  tables: Map<string, MutableTable>,
  observed: Set<string>,
): void {
  let index = start

  // CREATE [TEMPORARY] TABLE [IF NOT EXISTS] name (...)
  while (tokens[index]?.type === 'word') {
    const keyword = tokens[index]!.value.toUpperCase()
    if (keyword !== 'IF' && keyword !== 'NOT' && keyword !== 'EXISTS') break
    index += 1
  }

  const name = readName(tokens, index)
  if (!name) throw new DumpSyntaxError('CREATE TABLE without a table name')
  index = name.next
  observed.add(name.value)

  const columns: string[] = []
  let depth = 0
  let entry: Token[] = []

  for (; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (token.type === 'punct') {
      if (token.value === '(') {
        depth += 1
        if (depth === 1) {
          entry = []
          continue
        }
      } else if (token.value === ')') {
        depth -= 1
        if (depth === 0) {
          pushColumn(entry, columns)
          break
        }
      } else if (token.value === ',' && depth === 1) {
        pushColumn(entry, columns)
        entry = []
        continue
      }
    }
    if (depth >= 1) entry.push(token)
  }

  if (columns.length === 0) {
    throw new DumpSyntaxError(`CREATE TABLE ${name.value} declared no columns`)
  }

  // One declaration per table in a dump. Keeping the first means a stray second
  // one cannot silently reorder columns under rows already collected.
  if (!tables.has(name.value)) {
    tables.set(name.value, { table: name.value, columns, rows: [], flushed: 0 })
  }
}

interface ParsedValue {
  value: string | null
  next: number
}

function readValue(tokens: Token[], start: number): ParsedValue {
  const token = tokens[start]
  if (!token) throw new DumpSyntaxError('INSERT row ended before a value')

  switch (token.type) {
    case 'string':
      return { value: token.value, next: start + 1 }

    case 'hex': {
      // A 0x literal is bytes, not characters: decode them the same way the
      // server's latin1 column would have handed them to us.
      const bytes = Buffer.from(token.value, 'hex')
      return { value: bytes.toString('latin1'), next: start + 1 }
    }

    case 'number':
      return { value: token.value, next: start + 1 }

    case 'word': {
      // `_binary '...'` and `_latin1 '...'` name the charset of the literal
      // that follows; after a single latin1 decode they add nothing.
      if (token.value.startsWith('_') && tokens[start + 1]?.type === 'string') {
        return { value: tokens[start + 1]!.value, next: start + 2 }
      }
      const keyword = token.value.toUpperCase()
      if (keyword === 'NULL') return { value: null, next: start + 1 }
      if (keyword === 'TRUE') return { value: '1', next: start + 1 }
      if (keyword === 'FALSE') return { value: '0', next: start + 1 }
      return { value: token.value, next: start + 1 }
    }

    default:
      throw new DumpSyntaxError(`unexpected ${token.type} "${token.value}" in a VALUES row`)
  }
}

function parseInsert(
  tokens: Token[],
  start: number,
  tables: Map<string, MutableTable>,
  observed: Set<string>,
): void {
  let index = start

  while (tokens[index]?.type === 'word') {
    const keyword = tokens[index]!.value.toUpperCase()
    if (keyword === 'INTO') {
      index += 1
      break
    }
    if (!INSERT_MODIFIERS.has(keyword)) break
    index += 1
  }

  const name = readName(tokens, index)
  if (!name) throw new DumpSyntaxError('INSERT without a table name')
  index = name.next
  observed.add(name.value)

  let columnList: string[] | null = null
  const open = tokens[index]
  if (open?.type === 'punct' && open.value === '(') {
    columnList = []
    index += 1
    while (index < tokens.length) {
      const token = tokens[index]!
      if (token.type === 'punct' && token.value === ')') {
        index += 1
        break
      }
      if (token.type === 'punct' && token.value === ',') {
        index += 1
        continue
      }
      if (token.type === 'identifier' || token.type === 'word') columnList.push(token.value)
      index += 1
    }
  }

  const valuesWord = tokens[index]
  const valuesKeyword = valuesWord?.type === 'word' ? valuesWord.value.toUpperCase() : ''
  if (valuesKeyword !== 'VALUES' && valuesKeyword !== 'VALUE') {
    throw new DumpSyntaxError(`INSERT INTO ${name.value} has no VALUES clause`)
  }
  index += 1

  let table = tables.get(name.value)
  if (!table) {
    // Without a CREATE TABLE the column list is the only source of names; with
    // neither, the rows cannot be named and the table is reported as skipped
    // rather than guessed at.
    if (!columnList) return
    table = { table: name.value, columns: [...columnList], rows: [], flushed: 0 }
    tables.set(name.value, table)
  } else if (table.columns.length === 0 && columnList) {
    table.columns = [...columnList]
  }

  const declared = table.columns
  const target = table
  // Values follow the INSERT's own column list when it has one, and the declared
  // order when it does not. mysqldump writes both shapes; mapping by name keeps
  // `--complete-insert` honest even if the list is not in declared order.
  const order = columnList && columnList.length > 0 ? columnList : declared

  for (;;) {
    while (tokens[index]?.type === 'punct' && tokens[index]!.value === ',') index += 1

    const groupOpen = tokens[index]
    if (!groupOpen || groupOpen.type !== 'punct' || groupOpen.value !== '(') break
    index += 1

    const values: (string | null)[] = []
    for (;;) {
      const token = tokens[index]
      if (!token) throw new DumpSyntaxError(`INSERT INTO ${target.table} ended inside a row`)
      if (token.type === 'punct' && token.value === ')') {
        index += 1
        break
      }
      if (token.type === 'punct' && token.value === ',') {
        index += 1
        continue
      }
      const parsed = readValue(tokens, index)
      values.push(parsed.value)
      index = parsed.next
    }

    const rowNo = target.flushed + target.rows.length + 1
    if (values.length !== order.length) {
      throw new DumpSyntaxError(
        `INSERT INTO ${target.table} row ${rowNo} has ${values.length} values for ${order.length} columns`,
      )
    }

    const row: Record<string, string | null> = {}
    for (const column of declared) row[column] = null
    for (let slot = 0; slot < order.length; slot += 1) {
      const column = order[slot]!
      if (!(column in row)) {
        throw new DumpSyntaxError(
          `INSERT INTO ${target.table} names column ${column}, which its CREATE TABLE lacks`,
        )
      }
      row[column] = values[slot] ?? null
    }
    target.rows.push({ rowNo, values: row })
  }
}

export interface ParseDumpOptions {
  /**
   * Tables to materialise. Anything else in the file is named in
   * `skippedTables`, so "we did not load it" is a decision the report can show.
   */
  include?: readonly string[]
}

export interface ParsedDump {
  tables: SourceTable[]
  skippedTables: string[]
}

function applyStatement(
  tokens: Token[],
  tables: Map<string, MutableTable>,
  observed: Set<string>,
): void {
  const first = tokens[0]
  if (first?.type !== 'word') return

  const keyword = first.value.toUpperCase()
  if (keyword === 'CREATE') {
    let index = 1
    if (tokens[index]?.type === 'word' && tokens[index]!.value.toUpperCase() === 'TEMPORARY') {
      index += 1
    }
    const target = tokens[index]
    if (target?.type === 'word' && target.value.toUpperCase() === 'TABLE') {
      parseCreateTable(tokens, index + 1, tables, observed)
    }
    return
  }

  if (keyword === 'INSERT' || keyword === 'REPLACE') {
    parseInsert(tokens, 1, tables, observed)
  }
}

/**
 * The same parse as `parseDump`, handed back a slice at a time.
 *
 * `parseDump` keeps every row of a table at once, which for a 500 MB table
 * costs many times its size in objects. Here a table's rows are yielded once
 * `sliceRows` have accumulated and then dropped, so memory follows the slice
 * and not the table. Row numbers continue across slices, so the concatenation
 * of the slices is exactly what `parseDump` returns. A table is always
 * yielded at least once, even with no rows, so its columns are known.
 */
export function* parseDumpSlices(text: string, sliceRows: number): Generator<SourceTable> {
  const limit = Math.max(1, sliceRows)
  const tables = new Map<string, MutableTable>()
  const observed = new Set<string>()
  const yielded = new Set<string>()
  const scanner = new StatementScanner(text)

  for (;;) {
    const tokens = scanner.nextStatement()
    if (!tokens) break
    applyStatement(tokens, tables, observed)

    for (const entry of tables.values()) {
      if (entry.rows.length < limit) continue
      const rows = entry.rows
      entry.flushed += rows.length
      entry.rows = []
      yielded.add(entry.table)
      yield { table: entry.table, columns: entry.columns, rows }
    }
  }

  for (const entry of tables.values()) {
    if (entry.rows.length > 0 || !yielded.has(entry.table)) {
      yield { table: entry.table, columns: entry.columns, rows: entry.rows }
    }
  }
}

/** Decodes dump bytes as latin1 — the one and only decode in the pipeline. */
export function decodeDumpText(bytes: Uint8Array): string {
  // Buffer.from(bytes) would copy a multi-gigabyte dump; reuse the buffer we
  // were handed when it already is one.
  return Buffer.isBuffer(bytes) ? bytes.toString('latin1') : Buffer.from(bytes).toString('latin1')
}

export function parseDump(text: string, options: ParseDumpOptions = {}): ParsedDump {
  const include = options.include ? new Set(options.include) : null
  const tables = new Map<string, MutableTable>()
  const observed = new Set<string>()
  const scanner = new StatementScanner(text)

  for (;;) {
    const tokens = scanner.nextStatement()
    if (!tokens) break
    applyStatement(tokens, tables, observed)
  }

  const result: SourceTable[] = []
  for (const entry of tables.values()) {
    if (include && !include.has(entry.table)) continue
    result.push({ table: entry.table, columns: entry.columns, rows: entry.rows })
  }

  const materialised = new Set(result.map((entry) => entry.table))
  const skippedTables = [...observed]
    .filter((name) => !materialised.has(name))
    .sort((left, right) => left.localeCompare(right))

  return { tables: result, skippedTables }
}

/**
 * `sha256` hex of a dump, for `migration.dump_objects`.
 *
 * The caller passes file bytes for a real dump: the hash must describe the file
 * on disk, not the utf8 encoding of its decoded text.
 */
export function computeDumpId(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex')
}
