/**
 * `LegacySource` over a mysqldump that has been split into one file per table.
 *
 * `DumpSource` decodes the whole file into one JavaScript string, and V8 caps a
 * string at 536,870,888 characters. A real dump is larger than that (the
 * November 2026 dump is 1.6 GB), but every single table is smaller, so each
 * table file is read and tokenized on its own and never kept.
 *
 * Each file starts with the dump header (charset, SQL mode) so the tokenizer
 * sees the same preamble it would in the whole file. The identity of the dump
 * is the hash of the original, unsplit file, passed in by the caller.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { DumpInfo, LegacySource, SourceTable } from '../types'
import { decodeDumpText, parseDump, parseDumpSlices } from './tokenizer'

export class SplitDumpSource implements LegacySource {
  readonly dir: string
  private readonly info: DumpInfo
  private readonly files: Map<string, string>

  constructor(dir: string, original: { sha256: string; sizeBytes: number; path: string }) {
    this.dir = resolve(dir)
    this.info = {
      dumpId: `sha256:${original.sha256}`,
      path: original.path,
      sizeBytes: original.sizeBytes,
      checksum: original.sha256,
    }
    this.files = new Map(
      readdirSync(this.dir)
        .filter((name) => name.endsWith('.sql'))
        .sort()
        .map((name) => [name.slice(0, -4), join(this.dir, name)]),
    )
  }

  dumpInfo(): DumpInfo {
    return this.info
  }

  async listTables(): Promise<string[]> {
    return [...this.files.keys()]
  }

  async readTable(table: string): Promise<SourceTable> {
    const file = this.files.get(table)
    if (!file) return { table, columns: [], rows: [] }
    if (statSync(file).size > 500_000_000) {
      // Still readable, but close to V8's string cap; say so rather than fail late.
      console.warn(`split-dump: ${table} is ${(statSync(file).size / 1e6).toFixed(0)} MB`)
    }
    const parsed = parseDump(decodeDumpText(readFileSync(file)))
    return parsed.tables.find((entry) => entry.table === table) ?? { table, columns: [], rows: [] }
  }

  async *readTableSlices(table: string, sliceRows = 5000): AsyncIterable<SourceTable> {
    const file = this.files.get(table)
    if (!file) {
      yield { table, columns: [], rows: [] }
      return
    }
    for (const slice of parseDumpSlices(decodeDumpText(readFileSync(file)), sliceRows)) {
      if (slice.table === table) yield slice
    }
  }

  async close(): Promise<void> {
    this.files.clear()
  }
}
