/**
 * The single price-write path and the global price-editor lock (E5/E6).
 *
 * SERVER ONLY. Every price change runs while the caller holds the one global
 * lock and writes `part_price_history` in the same transaction. An expired lock
 * is surfaced with its holder and expiry; takeover is explicit and audited.
 * There is no timer that silently clears the lock.
 */
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { writeAudit } from '@cls/auth'
import { ForbiddenError, ValidationError } from '@cls/core'
import type { Executor, Tx } from '@cls/db'
import {
  partPriceHistory,
  partPriceLocks,
  partSellingRates,
  partSupplierRates,
  parts,
} from '@cls/db/schema'
import { format, parseDecimal, round } from '@cls/pricing'
import type { AuthSessionView } from '../../../server/auth.types'
import { assertPermission } from '../../../server/middleware'
import { decideLockAction } from '../lib/price-lock'

export const PRICE_LOCK_TTL_MINUTES = 15

export interface PriceLockState {
  isLocked: boolean
  heldByMe: boolean
  lockedBy: string | null
  lockedByName: string | null
  expiresAt: string | null
  remainingSeconds: number
  expired: boolean
  version: number
}

function remaining(row: typeof partPriceLocks.$inferSelect, now: Date): number {
  if (!row.expiresAt) return 0
  return Math.max(0, Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000))
}

function stateOf(
  row: typeof partPriceLocks.$inferSelect,
  session: AuthSessionView,
): PriceLockState {
  const now = new Date()
  const expired = Boolean(row.expiresAt && row.expiresAt.getTime() <= now.getTime())
  return {
    isLocked: row.isLocked,
    heldByMe: row.isLocked && row.lockedBy === session.user.id && !expired,
    lockedBy: row.lockedBy,
    lockedByName: row.lockedByName,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    remainingSeconds: remaining(row, now),
    expired: row.isLocked && expired,
    version: row.version,
  }
}

async function lockRow(tx: Tx): Promise<typeof partPriceLocks.$inferSelect> {
  const [row] = await tx.select().from(partPriceLocks).where(eq(partPriceLocks.id, 1)).for('update')
  if (!row) throw new ValidationError('The price lock is not initialised. Run the migration.')
  return row
}

export async function getPriceLockState(
  session: AuthSessionView,
  executor: Pick<Tx, 'select'>,
): Promise<PriceLockState> {
  assertPermission(session, 'inventory:read')
  const [row] = await executor
    .select()
    .from(partPriceLocks)
    .where(eq(partPriceLocks.id, 1))
    .limit(1)
  if (!row) throw new ValidationError('The price lock is not initialised. Run the migration.')
  return stateOf(row, session)
}

export async function acquirePriceLockCore(
  tx: Tx,
  session: AuthSessionView,
  options: { takeOver?: boolean; reason?: string | null } = {},
): Promise<PriceLockState> {
  assertPermission(session, 'inventory:edit_price')
  const row = await lockRow(tx)
  const now = new Date()
  const decision = decideLockAction({
    isLocked: row.isLocked,
    holderId: row.lockedBy,
    holderName: row.lockedByName,
    expiresAt: row.expiresAt,
    userId: session.user.id,
    takeOver: options.takeOver ?? false,
    reason: options.reason ?? null,
    now,
  })
  if (decision.action === 'blocked' || decision.action === 'takeover_needs_reason') {
    throw new ValidationError(decision.message ?? 'The price lock is held by someone else.')
  }
  const takeover = decision.action === 'takeover'
  const expiresAt = new Date(now.getTime() + PRICE_LOCK_TTL_MINUTES * 60_000)
  const [updated] = await tx
    .update(partPriceLocks)
    .set({
      isLocked: true,
      lockedBy: session.user.id,
      lockedByName: session.user.displayName || session.user.username,
      lockTime: now,
      heartbeatAt: now,
      expiresAt,
      version: row.version + 1,
      updatedAt: now,
    })
    .where(eq(partPriceLocks.id, 1))
    .returning()
  if (!updated) throw new ValidationError('The price lock could not be acquired.')

  await writeAudit(tx, {
    action: takeover ? 'inventory.price_lock_takeover' : 'inventory.price_lock_acquire',
    actorUserId: session.user.id,
    actorLabel: session.user.displayName,
    actorRole: session.user.role,
    entityType: 'part_price_lock',
    entityId: '1',
    summary: takeover
      ? `Took over the expired price lock from ${row.lockedByName ?? row.lockedBy}.`
      : 'Acquired the global price-editor lock.',
    permission: 'inventory:edit_price',
    before: stateOf(row, session) as unknown as Record<string, unknown>,
    after: {
      ...(stateOf(updated, session) as unknown as Record<string, unknown>),
      takeoverReason: options.reason ?? null,
    },
  })
  return stateOf(updated, session)
}

export async function refreshPriceLockCore(
  tx: Tx,
  session: AuthSessionView,
): Promise<PriceLockState> {
  assertPermission(session, 'inventory:edit_price')
  const row = await lockRow(tx)
  const now = new Date()
  if (!row.isLocked || row.lockedBy !== session.user.id) {
    throw new ForbiddenError('You do not hold the price-editor lock.')
  }
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    throw new ValidationError(
      `Your price lock expired at ${row.expiresAt.toISOString()}. Acquire it again before editing.`,
    )
  }
  const [updated] = await tx
    .update(partPriceLocks)
    .set({
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + PRICE_LOCK_TTL_MINUTES * 60_000),
      version: row.version + 1,
      updatedAt: now,
    })
    .where(eq(partPriceLocks.id, 1))
    .returning()
  if (!updated) throw new ValidationError('The price lock could not be refreshed.')
  return stateOf(updated, session)
}

export async function releasePriceLockCore(
  tx: Tx,
  session: AuthSessionView,
): Promise<PriceLockState> {
  assertPermission(session, 'inventory:edit_price')
  const row = await lockRow(tx)
  if (row.isLocked && row.lockedBy !== session.user.id && session.user.role !== 'admin') {
    throw new ForbiddenError('Only the holder or an admin can release the price lock.')
  }
  const now = new Date()
  const [updated] = await tx
    .update(partPriceLocks)
    .set({
      isLocked: false,
      lockedBy: null,
      lockedByName: null,
      lockTime: null,
      heartbeatAt: null,
      expiresAt: null,
      version: row.version + 1,
      updatedAt: now,
    })
    .where(eq(partPriceLocks.id, 1))
    .returning()
  if (!updated) throw new ValidationError('The price lock could not be released.')
  await writeAudit(tx, {
    action: 'inventory.price_lock_release',
    actorUserId: session.user.id,
    actorLabel: session.user.displayName,
    actorRole: session.user.role,
    entityType: 'part_price_lock',
    entityId: '1',
    summary: 'Released the global price-editor lock.',
    permission: 'inventory:edit_price',
  })
  return stateOf(updated, session)
}

async function requireHeldLock(tx: Tx, session: AuthSessionView) {
  const row = await lockRow(tx)
  const now = new Date()
  if (!row.isLocked || row.lockedBy !== session.user.id) {
    throw new ForbiddenError('Acquire the price-editor lock before changing prices.')
  }
  if (!row.expiresAt || row.expiresAt.getTime() <= now.getTime()) {
    throw new ValidationError('The price lock expired. Acquire it again before changing prices.')
  }
  return row
}

function money(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === '') return null
  const parsed = parseDecimal(value)
  if (!parsed) throw new ValidationError(`Invalid price: ${value}`)
  return format(round(parsed, 2), 2)
}

export interface PriceFields {
  cost?: string | null
  sellPrice?: string | null
  installPrice?: string | null
  recyclePrice?: string | null
}

export interface RateFields {
  id: string
  costPrice?: string | null
  sellPrice?: string | null
  installPrice?: string | null
  recyclePrice?: string | null
  markup?: string | null
}

export interface SavePricesInput {
  partId: number
  sectionName?: string | null
  fields?: PriceFields
  supplierRates?: RateFields[]
  sellingRates?: RateFields[]
}

const PART_PRICE_FIELDS = [
  ['cost', 'cost'],
  ['sellPrice', 'sellPrice'],
  ['installPrice', 'installPrice'],
  ['recyclePrice', 'recyclePrice'],
] as const

const RATE_PRICE_FIELDS = [
  ['costPrice', 'costPrice'],
  ['sellPrice', 'sellPrice'],
  ['installPrice', 'installPrice'],
  ['recyclePrice', 'recyclePrice'],
  ['markup', 'markup'],
] as const

function sameMoney(left: string | null, right: string | null): boolean {
  if (left === null && right === null) return true
  if (left === null || right === null) return false
  return money(left) === money(right)
}

export async function savePartPricesCore(
  tx: Tx,
  input: SavePricesInput,
  session: AuthSessionView,
): Promise<{ changed: number; partId: number }> {
  assertPermission(session, 'inventory:edit_price')
  await requireHeldLock(tx, session)

  const [part] = await tx.select().from(parts).where(eq(parts.id, input.partId)).for('update')
  if (!part) throw new ValidationError('That part does not exist.')

  let changed = 0
  const history: Array<typeof partPriceHistory.$inferInsert> = []
  const partUpdate: Record<string, string | null | Date> = {}

  for (const [key, column] of PART_PRICE_FIELDS) {
    const next = input.fields?.[key]
    if (next === undefined) continue
    const value = money(next)
    const previous = part[column] ?? null
    if (sameMoney(previous, value)) continue
    partUpdate[column] = value
    history.push({
      partId: part.id,
      fieldName: key,
      lastValue: previous,
      newValue: value,
      changedBy: session.user.id,
      sectionName: input.sectionName ?? 'parts',
    })
    changed += 1
  }

  if (Object.keys(partUpdate).length > 0) {
    await tx
      .update(parts)
      .set({ ...partUpdate, updatedAt: new Date() })
      .where(eq(parts.id, part.id))
  }

  for (const [index, rate] of (input.supplierRates ?? []).entries()) {
    const [row] = await tx
      .select()
      .from(partSupplierRates)
      .where(and(eq(partSupplierRates.id, rate.id), eq(partSupplierRates.partId, part.id)))
      .for('update')
    if (!row) throw new ValidationError('A supplier rate does not belong to that part.')
    const update: Record<string, string | null> = {}
    for (const [key, column] of RATE_PRICE_FIELDS) {
      const next = rate[key as keyof RateFields]
      if (next === undefined) continue
      const value = money(next)
      const previous = row[column] ?? null
      if (sameMoney(previous, value)) continue
      update[column] = value
      history.push({
        partId: part.id,
        fieldName: `supplierRates[${index}].${key}`,
        lastValue: previous,
        newValue: value,
        changedBy: session.user.id,
        sectionName: input.sectionName ?? `supplier-rate:${rate.id}`,
      })
      changed += 1
    }
    if (Object.keys(update).length > 0) {
      await tx.update(partSupplierRates).set(update).where(eq(partSupplierRates.id, rate.id))
    }
  }

  for (const [index, rate] of (input.sellingRates ?? []).entries()) {
    const [row] = await tx
      .select()
      .from(partSellingRates)
      .where(and(eq(partSellingRates.id, rate.id), eq(partSellingRates.partId, part.id)))
      .for('update')
    if (!row) throw new ValidationError('A selling rate does not belong to that part.')
    const update: Record<string, string | null> = {}
    for (const [key, column] of RATE_PRICE_FIELDS) {
      if (key === 'costPrice' || key === 'markup') continue
      const next = rate[key as keyof RateFields]
      if (next === undefined) continue
      const value = money(next)
      const previous = row[column] ?? null
      if (sameMoney(previous, value)) continue
      update[column] = value
      history.push({
        partId: part.id,
        fieldName: `sellingRates[${index}].${key}`,
        lastValue: previous,
        newValue: value,
        changedBy: session.user.id,
        sectionName: input.sectionName ?? `selling-rate:${rate.id}`,
      })
      changed += 1
    }
    if (Object.keys(update).length > 0) {
      await tx.update(partSellingRates).set(update).where(eq(partSellingRates.id, rate.id))
    }
  }

  if (history.length > 0) await tx.insert(partPriceHistory).values(history)
  if (changed > 0) {
    await writeAudit(tx, {
      action: 'inventory.prices_update',
      actorUserId: session.user.id,
      actorLabel: session.user.displayName,
      actorRole: session.user.role,
      entityType: 'part',
      entityId: String(part.id),
      summary: `Changed ${changed} price field(s) for ${part.partNumber}.`,
      permission: 'inventory:edit_price',
      after: {
        changes: history.map((row) => ({
          field: row.fieldName,
          old: row.lastValue,
          new: row.newValue,
        })),
      },
    })
  }
  return { changed, partId: part.id }
}

export async function searchPriceParts(
  session: AuthSessionView,
  input: { search?: string },
  executor: Executor,
) {
  assertPermission(session, 'inventory:read')
  const term = input.search?.trim()
  const where = term
    ? or(ilike(parts.partNumber, `%${term}%`), ilike(parts.name, `%${term}%`))
    : undefined
  return executor
    .select({
      id: parts.id,
      partNumber: parts.partNumber,
      name: parts.name,
      cost: parts.cost,
      sellPrice: parts.sellPrice,
      installPrice: parts.installPrice,
      recyclePrice: parts.recyclePrice,
    })
    .from(parts)
    .where(where)
    .orderBy(asc(parts.partNumber))
    .limit(50)
}

export async function getPartPriceEditor(
  session: AuthSessionView,
  partId: number,
  executor: Executor,
) {
  assertPermission(session, 'inventory:read')
  const [part] = await executor.select().from(parts).where(eq(parts.id, partId)).limit(1)
  if (!part) throw new ValidationError('That part does not exist.')
  const [supplierRates, sellingRates, history] = await Promise.all([
    executor
      .select()
      .from(partSupplierRates)
      .where(eq(partSupplierRates.partId, partId))
      .orderBy(desc(partSupplierRates.defaultRate), asc(partSupplierRates.dateInserted)),
    executor
      .select()
      .from(partSellingRates)
      .where(eq(partSellingRates.partId, partId))
      .orderBy(asc(partSellingRates.dateInserted)),
    executor
      .select()
      .from(partPriceHistory)
      .where(eq(partPriceHistory.partId, partId))
      .orderBy(desc(partPriceHistory.changedAt), desc(partPriceHistory.id))
      .limit(100),
  ])
  return {
    part: {
      id: part.id,
      partNumber: part.partNumber,
      name: part.name,
      cost: part.cost,
      sellPrice: part.sellPrice,
      installPrice: part.installPrice,
      recyclePrice: part.recyclePrice,
      updatedAt: part.updatedAt.toISOString(),
    },
    supplierRates: supplierRates.map((row) => ({
      ...row,
      dateInserted: row.dateInserted.toISOString(),
    })),
    sellingRates: sellingRates.map((row) => ({
      ...row,
      dateInserted: row.dateInserted.toISOString(),
    })),
    history: history.map((row) => ({
      ...row,
      changedAt: row.changedAt.toISOString(),
    })),
  }
}

/** The ledger/price mismatch query used by reports; it never repairs stock. */
export async function priceLockSummary(executor: Pick<Tx, 'execute'>) {
  return executor.execute(
    sql`select id, is_locked, locked_by, expires_at from app.part_price_locks where id = 1`,
  )
}
