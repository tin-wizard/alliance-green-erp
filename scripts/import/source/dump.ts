/**
 * `LegacySource` over a `mysqldump` file.
 *
 * The file is read once, decoded once, tokenized once, and kept: the loader
 * asks for tables in dependency order and re-parsing a multi-gigabyte dump per
 * group would dominate the whole run.
 *
 * `dumpInfo` hashes the *uncompressed* bytes. A `.sql.gz` and its `.sql` are
 * then the same dump with the same `dump_id`, which is what "the identity of
 * the file" has to mean for a re-run to be comparable.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { DumpInfo, LegacySource, SourceTable } from '../types'
import { computeDumpId, decodeDumpText, parseDump } from './tokenizer'

function isGzip(bytes: Buffer): boolean {
  // The magic number, not the file name: a `.sql` that is really gzipped must
  // still load, and a truncated download must fail loudly here rather than
  // parse as garbage.
  return bytes.length > 1 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

export class DumpSource implements LegacySource {
  readonly path: string
  /** Uncompressed dump bytes; the hash and size are computed from these. */
  readonly bytes: Buffer
  private parsed: { tables: SourceTable[]; skippedTables: string[] } | null = null

  constructor(path: string) {
    this.path = resolve(path)
    const raw = readFileSync(this.path)
    this.bytes = isGzip(raw) ? gunzipSync(raw) : raw
  }

  dumpInfo(): DumpInfo {
    const checksum = computeDumpId(this.bytes)
    return {
      dumpId: `sha256:${checksum}`,
      path: this.path,
      sizeBytes: this.bytes.length,
      checksum,
    }
  }

  async listTables(): Promise<string[]> {
    return this.tables().map((entry) => entry.table)
  }

  async readTable(table: string): Promise<SourceTable> {
    // The loader treats a table the dump lacks as "no rows here", not an error:
    // a fresh dump may legitimately drop a legacy table.
    const found = this.tables().find((entry) => entry.table === table)
    return found ?? { table, columns: [], rows: [] }
  }

  async close(): Promise<void> {
    this.parsed = null
  }

  private tables(): SourceTable[] {
    if (!this.parsed) {
      this.parsed = parseDump(decodeDumpText(this.bytes))
    }
    return this.parsed.tables
  }
}
