/**
 * Contracts shared by the migration harness.
 *
 * One loader, two sources (the dump tokenizer and a restored MySQL), one
 * transform contract per group. Everything downstream of the source sees text.
 */
import type { Tx } from '@cls/db'

/** One row as the source yields it: every column text, missing values null. */
export interface SourceRow {
  /** 1-based row number within its table, stable for a given dump. */
  rowNo: number
  values: Record<string, string | null>
}

export interface SourceTable {
  table: string
  /** Column order exactly as the dump or the restored table declares it. */
  columns: string[]
  rows: SourceRow[]
}

/** A source of legacy tables: the dump file, or a restored MySQL database. */
export interface LegacySource {
  /** Tables present in the source, in dump order. */
  listTables(): Promise<string[]>
  /** Rows for one table, or an empty result when the source lacks it. */
  readTable(table: string): Promise<SourceTable>
  /**
   * The same rows as `readTable`, a slice at a time, for tables too large to
   * hold at once. Row numbers continue across slices.
   */
  readTableSlices?(table: string, sliceRows?: number): AsyncIterable<SourceTable>
  /** The identity of the underlying file, when the source has one. */
  dumpInfo?(): DumpInfo
  close?(): Promise<void>
}

export interface DumpInfo {
  /** `sha256:<hex>` — the immutable identity of the file. */
  dumpId: string
  path: string
  sizeBytes: number
  checksum: string
}

export type ExceptionClass =
  | 'placeholder_work_order'
  | 'woid_mismatch'
  | 'duplicate_username'
  | 'disabled_user'
  | 'no_email'
  | 'subcontractor_without_vendor'
  | 'supplier_without_vendor'
  | 'last_revision_recomputed'
  | 'negative_quantity'
  | 'duplicate_master_name'
  | 'orphan_workorder_site'
  | 'orphan_site_customer'
  | 'orphan_line'
  | 'unresolved_part_line'
  | 'duplicate_sage_item'
  | 'duplicate_display_number'
  | 'duplicate_invoice_number'
  | 'quote_id_collision'
  | 'legacy_deleted_line'
  | 'missing_invoice_number'
  | 'status_not_allowed_for_kind'
  | 'blank_money'
  | 'blank_tax'
  | 'unparseable_money'
  | 'money_zero_owed'
  | 'zero_amount'
  | 'unbalanced_totals'
  | 'missing_po_number'
  | 'series_seed'
  | 'zero_date'
  | 'unparseable_json'
  | 'unparseable_timestamp'
  | 'unknown_enum'
  | 'latin1_text'
  | 'mojibake_suspected'
  | 'dated_duplicate_skipped'
  | 'missing_in_dump'
  | 'not_migrated'

export interface TransformHelpers {
  /** Raw text, trimmed. Empty string stays null (legacy means "not set"). */
  text(column: string): string | null
  /** `$1,234.50` -> `1234.50`; empty or non-numeric -> null (and no zero-fill). */
  money(column: string): string | null
  /** Same parse in cents, for comparisons. */
  cents(column: string): number | null
  /** Integer; non-numeric -> null. */
  int(column: string): number | null
  /** `tinyint(1)` kept as 0/1/null, never a boolean. */
  flag(column: string): number | null
  /** ISO date (`YYYY-MM-DD`) or null; zero dates are null and recorded. */
  date(column: string): string | null
  /** ISO timestamp or null; wall-clock kept, never shifted. */
  timestamp(column: string): string | null
  /** Validated enum label; unknown becomes an exception and null. */
  enumOf<T extends string>(column: string, allowed: readonly T[]): T | null
  /** The target key recorded for a source key, if the row already mapped. */
  targetKey(entity: string, sourceTable: string, sourceKey: string): Promise<string | null>
  /** Record the crosswalk (same transaction as the app row). */
  remember(input: {
    entity: string
    sourceTable: string
    sourceKey: string
    targetTable: string
    targetKey: string
  }): Promise<void>
  /** Record a known exception class with its migration action. */
  exception(input: {
    exceptionClass: ExceptionClass
    entity: string
    sourceKey: string
    action: string
    notes?: string
    rowCount?: number
  }): Promise<void>
}

export interface TransformContext {
  tx: Tx
  dumpId: string
  group: string
  table: string
  sourceKey: string
  row: Record<string, string | null>
  helpers: TransformHelpers
}

export interface ParityAnchor {
  group: string
  label: string
  /** SQL against the staging schema, run on Postgres. */
  oldSql: string
  /** SQL against `app`. */
  newSql: string
  /** compare | oldOnly | newOnly */
  mode?: 'compare' | 'oldOnly'
}

export interface GroupTransformer {
  group: string
  /** One staged row. Throwing is a row error; known classes use helpers.exception. */
  transform(context: TransformContext): Promise<void>
  /**
   * Columns present in the dump but not mapped into the app, with the reason.
   * Printed in the run report so "we kept it in staging" is a decision, not a
   * surprise later.
   */
  unmapped?: Record<string, string>
  parity?: ParityAnchor[]
}
