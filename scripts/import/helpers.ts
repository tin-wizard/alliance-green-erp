/**
 * Field rules from `plan/CUTOVER-AND-MIGRATION.md` §2.6, in one place.
 *
 * These helpers are deliberately dull: they never guess. A malformed money value
 * becomes null and a recorded exception, not zero; an unknown enum is an error,
 * not the nearest label; a zero date is null, not 1970.
 */
import { eq, and } from 'drizzle-orm'
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

function isZeroDate(value: string): boolean {
  return /^0000-00-00/.test(value)
}

export interface HelperOptions {
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
