/**
 * Field rules from `plan/CUTOVER-AND-MIGRATION.md` §2.6, in one place.
 *
 * These helpers are deliberately dull: they never guess. A malformed money value
 * becomes null and a recorded exception, not zero; an unknown enum is an error,
 * not the nearest label; a zero date is null, not 1970.
 */
import { eq, and, sql } from 'drizzle-orm'
import type { Tx } from '@cls/db'
import { migrationExceptions, migrationRowMap } from '@cls/db/schema'
import type { ExceptionClass, TransformContext, TransformHelpers } from './types'

const MONEY = /^-?[$€£]?\s*\d[\d,]*\.?\d*$/

export function moneyToNumeric(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (!MONEY.test(trimmed)) return null
  const cleaned = trimmed.replace(/[$€£,\s]/g, '')
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return value.toFixed(2)
}

export function moneyToCents(raw: string | null | undefined): number | null {
  const numeric = moneyToNumeric(raw)
  return numeric === null ? null : Math.round(Number(numeric) * 100)
}

/**
 * A date MySQL stored but no calendar has: `0000-00-00`, and the partial zeros
 * legacy forms wrote (`2020-03-00`), plus impossible days such as `2021-02-31`.
 * Postgres rejects every one of them, and inventing the nearest real date would
 * be a guess, so they become NULL and a recorded exception.
 */
function isZeroDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year === 0 || month === 0 || day === 0) return true
  const probe = new Date(Date.UTC(year, month - 1, day))
  return (
    probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day
  )
}

/**
 * The crosswalk (`migration.row_map`) as the transformers see it, kept in memory.
 *
 * A transformer asks the crosswalk three or four questions per row (has this row
 * mapped, where is its parent) and writes one answer back. Each is a network round
 * trip, and over the wire to Neon that cost, not the SQL, is what limits a real
 * migration to a few rows a second. The cache loads one entity's crosswalk in a
 * single query on first use, answers every later lookup locally, and the writes
 * are buffered and flushed as one multi-row statement per slice.
 *
 * Reads see the slice's own pending writes (read-your-writes), and a rolled-back
 * row's writes are withdrawn so the cache never claims a mapping that is not in
 * the database. One cache is shared by the slices of a batch; each slice has its
 * own `RowMapPending`.
 */
export class RowMapCache {
  private readonly rows = new Map<string, string>()
  private readonly loaded = new Set<string>()
  private readonly loading = new Map<string, Promise<void>>()

  static key(entity: string, sourceTable: string, sourceKey: string): string {
    return `${entity}\u0000${sourceTable}\u0000${sourceKey}`
  }

  async get(tx: Tx, entity: string, sourceTable: string, sourceKey: string): Promise<string | null> {
    const key = RowMapCache.key(entity, sourceTable, sourceKey)
    const hit = this.rows.get(key)
    if (hit !== undefined) return hit
    if (!this.loaded.has(entity)) await this.load(tx, entity)
    return this.rows.get(key) ?? null
  }

  set(entity: string, sourceTable: string, sourceKey: string, targetKey: string): string | undefined {
    const key = RowMapCache.key(entity, sourceTable, sourceKey)
    const previous = this.rows.get(key)
    this.rows.set(key, targetKey)
    return previous
  }

  restore(entity: string, sourceTable: string, sourceKey: string, previous: string | undefined): void {
    const key = RowMapCache.key(entity, sourceTable, sourceKey)
    if (previous === undefined) this.rows.delete(key)
    else this.rows.set(key, previous)
  }

  /** One query per entity, shared by every slice that asks while it is running. */
  private load(tx: Tx, entity: string): Promise<void> {
    const running = this.loading.get(entity)
    if (running) return running
    const work = (async () => {
      const found = await tx
        .select({
          sourceTable: migrationRowMap.sourceTable,
          sourceKey: migrationRowMap.sourceKey,
          targetKey: migrationRowMap.targetKey,
        })
        .from(migrationRowMap)
        .where(eq(migrationRowMap.entity, entity))
      for (const row of found) {
        const key = RowMapCache.key(entity, row.sourceTable, row.sourceKey)
        // A write made while the query ran is newer than the snapshot.
        if (!this.rows.has(key)) this.rows.set(key, row.targetKey)
      }
      this.loaded.add(entity)
    })().finally(() => this.loading.delete(entity))
    this.loading.set(entity, work)
    return work
  }
}

export interface RowMapEntry {
  entity: string
  sourceTable: string
  sourceKey: string
  targetTable: string
  targetKey: string
}

export interface ExceptionEntry {
  exceptionClass: string
  entity: string
  sourceKey: string
  rowCount: number
  migrationAction: string
  notes: string | null
}

type PendingEntry =
  | ({ kind: 'map'; previous: string | undefined } & RowMapEntry)
  | ({ kind: 'exception' } & ExceptionEntry)

/**
 * One slice's buffered writes: crosswalk rows and data-quality exceptions. Both
 * are tiny inserts that would each cost a round trip, so they wait here and go
 * out as two multi-row statements when the slice commits. A row that rolls back
 * withdraws everything it added.
 */
export class RowMapPending {
  private entries: PendingEntry[] = []

  constructor(private readonly cache: RowMapCache) {}

  get size(): number {
    return this.entries.length
  }

  add(entry: RowMapEntry): void {
    const previous = this.cache.set(entry.entity, entry.sourceTable, entry.sourceKey, entry.targetKey)
    this.entries.push({ kind: 'map', previous, ...entry })
  }

  addException(entry: ExceptionEntry): void {
    this.entries.push({ kind: 'exception', ...entry })
  }

  /** Withdraw everything added after `mark`: its app rows were rolled back. */
  rollbackTo(mark: number): void {
    while (this.entries.length > mark) {
      const entry = this.entries.pop()!
      if (entry.kind === 'map') {
        this.cache.restore(entry.entity, entry.sourceTable, entry.sourceKey, entry.previous)
      }
    }
  }

  /** Last write wins per key, in chunks a single statement can carry. */
  async flush(tx: Tx, dumpId: string): Promise<void> {
    const maps = new Map<string, RowMapEntry>()
    const exceptions = new Map<string, ExceptionEntry>()
    for (const entry of this.entries) {
      if (entry.kind === 'map') {
        maps.set(RowMapCache.key(entry.entity, entry.sourceTable, entry.sourceKey), entry)
      } else {
        exceptions.set(`${entry.exceptionClass}\u0000${entry.entity}\u0000${entry.sourceKey}`, entry)
      }
    }
    const mapRows = [...maps.values()]
    for (let offset = 0; offset < mapRows.length; offset += 500) {
      await tx
        .insert(migrationRowMap)
        .values(
          mapRows.slice(offset, offset + 500).map((entry) => ({
            entity: entry.entity,
            sourceTable: entry.sourceTable,
            sourceKey: entry.sourceKey,
            targetTable: entry.targetTable,
            targetKey: entry.targetKey,
            dumpId,
          })),
        )
        .onConflictDoUpdate({
          target: [migrationRowMap.entity, migrationRowMap.sourceTable, migrationRowMap.sourceKey],
          set: {
            targetTable: sql`excluded.target_table`,
            targetKey: sql`excluded.target_key`,
            dumpId,
            updatedAt: new Date(),
          },
        })
    }
    const exceptionRows = [...exceptions.values()]
    for (let offset = 0; offset < exceptionRows.length; offset += 500) {
      await tx
        .insert(migrationExceptions)
        .values(
          exceptionRows.slice(offset, offset + 500).map((entry) => ({
            exceptionClass: entry.exceptionClass as ExceptionClass,
            entity: entry.entity,
            sourceKey: entry.sourceKey,
            rowCount: entry.rowCount,
            migrationAction: entry.migrationAction,
            notes: entry.notes,
          })),
        )
        .onConflictDoUpdate({
          target: [
            migrationExceptions.exceptionClass,
            migrationExceptions.entity,
            migrationExceptions.sourceKey,
          ],
          set: {
            rowCount: sql`excluded.row_count`,
            migrationAction: sql`excluded.migration_action`,
            notes: sql`excluded.notes`,
          },
        })
    }
    this.entries = []
  }

  /** Throw the slice's buffer away after its transaction rolled back. */
  discard(): void {
    this.rollbackTo(0)
  }
}

export interface HelperOptions {
  /** Cached crosswalk reads and buffered writes; absent means a query per call. */
  rowMap?: { cache: RowMapCache; pending: RowMapPending }
  /** Called when a value cannot be interpreted, so the caller records it once. */
  onUnparseableMoney?: (column: string, raw: string) => void
  onZeroDate?: (column: string) => void
  onUnknownEnum?: (column: string, raw: string) => void
}

export function createHelpers(
  context: Omit<TransformContext, 'helpers'>,
  options: HelperOptions = {},
): TransformHelpers {
  const { tx, dumpId, group, table, row } = context

  const raw = (column: string): string | null => {
    const value = row[column]
    if (value === undefined || value === null) return null
    return value
  }

  const text = (column: string): string | null => {
    const value = raw(column)
    if (value === null) return null
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }

  const money = (column: string): string | null => {
    const value = raw(column)
    const numeric = moneyToNumeric(value)
    if (value !== null && value.trim() !== '' && numeric === null) {
      options.onUnparseableMoney?.(column, value)
    }
    return numeric
  }

  const cents = (column: string): number | null => {
    const numeric = money(column)
    return numeric === null ? null : Math.round(Number(numeric) * 100)
  }

  const int = (column: string): number | null => {
    const value = text(column)
    if (value === null) return null
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  }

  const flag = (column: string): number | null => {
    const parsed = int(column)
    if (parsed === null) return null
    return parsed === 0 ? 0 : 1
  }

  const date = (column: string): string | null => {
    const value = text(column)
    if (value === null) return null
    if (isZeroDate(value)) {
      options.onZeroDate?.(column)
      return null
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
    return match ? `${match[1]}-${match[2]}-${match[3]}` : null
  }

  const timestamp = (column: string): string | null => {
    const value = text(column)
    if (value === null) return null
    if (isZeroDate(value)) {
      options.onZeroDate?.(column)
      return null
    }
    // Wall-clock stays wall-clock: the value is passed through as MySQL wrote it.
    return value
  }

  const enumOf = <T extends string>(column: string, allowed: readonly T[]): T | null => {
    const value = text(column)
    if (value === null) return null
    const found = allowed.find((entry) => entry.toLowerCase() === value.toLowerCase())
    if (!found) options.onUnknownEnum?.(column, value)
    return found ?? null
  }

  const targetKey = async (
    entity: string,
    sourceTable: string,
    key: string,
  ): Promise<string | null> => {
    if (options.rowMap) return options.rowMap.cache.get(tx, entity, sourceTable, key)
    const [mapped] = await tx
      .select({ targetKey: migrationRowMap.targetKey })
      .from(migrationRowMap)
      .where(
        and(
          eq(migrationRowMap.entity, entity),
          eq(migrationRowMap.sourceTable, sourceTable),
          eq(migrationRowMap.sourceKey, key),
        ),
      )
      .limit(1)
    return mapped?.targetKey ?? null
  }

  const remember: TransformHelpers['remember'] = async (input) => {
    if (options.rowMap) {
      options.rowMap.pending.add(input)
      return
    }
    await tx
      .insert(migrationRowMap)
      .values({ ...input, dumpId })
      .onConflictDoUpdate({
        target: [migrationRowMap.entity, migrationRowMap.sourceTable, migrationRowMap.sourceKey],
        set: {
          targetTable: input.targetTable,
          targetKey: input.targetKey,
          dumpId,
          updatedAt: new Date(),
        },
      })
  }

  const exception: TransformHelpers['exception'] = async (input) => {
    if (options.rowMap) {
      options.rowMap.pending.addException({
        exceptionClass: input.exceptionClass,
        entity: input.entity,
        sourceKey: input.sourceKey,
        rowCount: input.rowCount ?? 1,
        migrationAction: input.action,
        notes: input.notes ?? null,
      })
      return
    }
    await tx
      .insert(migrationExceptions)
      .values({
        exceptionClass: input.exceptionClass as ExceptionClass,
        entity: input.entity,
        sourceKey: input.sourceKey,
        rowCount: input.rowCount ?? 1,
        migrationAction: input.action,
        notes: input.notes ?? null,
      })
      .onConflictDoUpdate({
        target: [
          migrationExceptions.exceptionClass,
          migrationExceptions.entity,
          migrationExceptions.sourceKey,
        ],
        set: {
          rowCount: input.rowCount ?? 1,
          migrationAction: input.action,
          notes: input.notes ?? null,
        },
      })
  }

  void group
  void table

  return {
    text,
    money,
    cents,
    int,
    flag,
    date,
    timestamp,
    enumOf,
    targetKey,
    remember,
    exception,
  }
}
