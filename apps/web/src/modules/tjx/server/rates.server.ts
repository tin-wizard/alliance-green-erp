/**
 * TJX subcontractor install rates.
 *
 * A rate is per subcontractor and part. Bulk save replaces that
 * subcontractor's set, matching the legacy screen. It never writes
 * `parts.installcostperunit`: part pricing belongs to Inventory.
 */
import { and, asc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm'
import { NotFoundError, ValidationError } from '@cls/core'
import type { Executor, Tx } from '@cls/db'
import { parts, subcontractors, tjxSubcontractorRates } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type { TjxRateRow } from '../types'
import type { SaveRatesInput } from '../lib/masters.validation'
import { assertTjxWrite, auditTjx, normalizePartNo } from './access.server'

export async function listRates(
  executor: Executor,
  input: { subcontractorId: number; search?: string },
): Promise<TjxRateRow[]> {
  const where: SQL[] = [eq(tjxSubcontractorRates.subcontractorId, input.subcontractorId)]
  if (input.search) where.push(ilike(tjxSubcontractorRates.partNo, `%${input.search}%`))
  const rows = await executor
    .select()
    .from(tjxSubcontractorRates)
    .where(and(...where))
    .orderBy(asc(tjxSubcontractorRates.partNo))
  return rows.map((row) => ({
    partNo: row.partNo,
    installCostPerUnit: row.installCostPerUnit,
    updatedAt: row.updatedAt.toISOString(),
  }))
}

export async function saveRatesCore(
  tx: Tx,
  input: SaveRatesInput,
  session: AuthSessionView,
): Promise<TjxRateRow[]> {
  assertTjxWrite(session)
  const [subcontractor] = await tx
    .select({ id: subcontractors.id, name: subcontractors.name })
    .from(subcontractors)
    .where(eq(subcontractors.id, input.subcontractorId))
    .limit(1)
  if (!subcontractor) throw new NotFoundError('Subcontractor')

  const normalized = input.rates.map((rate) => ({
    partNo: normalizePartNo(rate.partNo),
    installCostPerUnit: rate.installCostPerUnit,
  }))
  const seen = new Set<string>()
  for (const rate of normalized) {
    if (seen.has(rate.partNo)) {
      throw new ValidationError(`Part ${rate.partNo} appears more than once.`)
    }
    if (!/^\d+(\.\d{1,2})?$/.test(rate.installCostPerUnit)) {
      throw new ValidationError(
        `Enter a non-negative rate with at most 2 decimals for part ${rate.partNo}.`,
      )
    }
    seen.add(rate.partNo)
  }

  if (seen.size) {
    const existing = await tx
      .select({ partNumber: parts.partNumber })
      .from(parts)
      .where(inArray(parts.partNumber, [...seen]))
    const found = new Set(existing.map((row) => row.partNumber))
    const missing = [...seen].filter((partNo) => !found.has(partNo))
    if (missing.length) throw new ValidationError(`Unknown part number: ${missing.join(', ')}.`)
  }

  const before = await tx
    .select()
    .from(tjxSubcontractorRates)
    .where(eq(tjxSubcontractorRates.subcontractorId, input.subcontractorId))
    .orderBy(asc(tjxSubcontractorRates.partNo))

  await tx
    .delete(tjxSubcontractorRates)
    .where(eq(tjxSubcontractorRates.subcontractorId, input.subcontractorId))

  if (normalized.length) {
    await tx.insert(tjxSubcontractorRates).values(
      normalized.map((rate) => ({
        subcontractorId: input.subcontractorId,
        partNo: rate.partNo,
        installCostPerUnit: rate.installCostPerUnit,
        updatedBy: session.user.id,
      })),
    )
  }

  const after = await listRates(tx, { subcontractorId: input.subcontractorId })
  await auditTjx(
    tx,
    session,
    'tjx.rates.save',
    'tjx_subcontractor_rates',
    input.subcontractorId,
    {
      summary: `Saved ${normalized.length} TJX rate${normalized.length === 1 ? '' : 's'} for ${subcontractor.name}.`,
      before: { rates: before.map((row) => ({ partNo: row.partNo, rate: row.installCostPerUnit })) },
      after: { rates: after.map((row) => ({ partNo: row.partNo, rate: row.installCostPerUnit })) },
    },
  )
  return after
}

export async function hasRate(
  executor: Executor,
  subcontractorId: number,
  partNo: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: tjxSubcontractorRates.id })
    .from(tjxSubcontractorRates)
    .where(
      and(
        eq(tjxSubcontractorRates.subcontractorId, subcontractorId),
        eq(tjxSubcontractorRates.partNo, normalizePartNo(partNo)),
      ),
    )
    .limit(1)
  return Boolean(row)
}

export async function rateCount(executor: Executor): Promise<number> {
  const [row] = await executor.select({ n: sql<number>`count(*)::int` }).from(tjxSubcontractorRates)
  return row?.n ?? 0
}
