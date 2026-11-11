/**
 * Audit, line loading and revision-chain helpers.
 *
 * SERVER ONLY. Each write runs in the caller's transaction with its audit row,
 * so a quote change and its trail commit or roll back together.
 */
import { and, asc, desc, eq, ne } from 'drizzle-orm'
import { writeAudit } from '@cls/auth'
import type { Executor, Tx } from '@cls/db'
import {
  quoteHours,
  quoteParts,
  quoteRejections,
  quoteSpecialParts,
  quotes,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type { QuoteHourLine, QuotePartLine, QuoteSpecialLine } from '../types'

export async function auditQuote(
  executor: Executor,
  session: AuthSessionView,
  action: string,
  quoteId: number,
  options: {
    summary?: string
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
  } = {},
): Promise<void> {
  await writeAudit(executor, {
    action,
    actorUserId: session.user.id,
    actorLabel: session.user.displayName,
    actorRole: session.user.role,
    entityType: 'quote',
    entityId: String(quoteId),
    summary: options.summary ?? null,
    before: options.before ?? null,
    after: options.after ?? null,
  })
}

export async function loadLines(
  executor: Executor,
  quoteId: number,
): Promise<{
  hours: QuoteHourLine[]
  parts: QuotePartLine[]
  specialParts: QuoteSpecialLine[]
}> {
  const [hourRows, partRows, specialRows] = await Promise.all([
    executor
      .select()
      .from(quoteHours)
      .where(eq(quoteHours.quoteId, quoteId))
      .orderBy(asc(quoteHours.sortOrder), asc(quoteHours.id)),
    executor
      .select()
      .from(quoteParts)
      .where(eq(quoteParts.quoteId, quoteId))
      .orderBy(asc(quoteParts.sortOrder), asc(quoteParts.id)),
    executor
      .select()
      .from(quoteSpecialParts)
      .where(eq(quoteSpecialParts.quoteId, quoteId))
      .orderBy(asc(quoteSpecialParts.sortOrder), asc(quoteSpecialParts.id)),
  ])
  return {
    hours: hourRows.map((line) => ({
      id: line.id,
      lineDate: line.lineDate,
      hours: line.hours,
      numTechs: line.numTechs,
      rateCode: line.rateCode,
      rate: line.rate,
      incurredHours: line.incurredHours,
      incurredRate: line.incurredRate,
      note: line.note,
      sortOrder: line.sortOrder,
    })),
    parts: partRows.map((line) => ({
      id: line.id,
      partNo: line.partNo,
      description: line.description,
      qty: line.qty,
      price: line.price,
      costPrice: line.costPrice,
      isUnderWarranty: line.isUnderWarranty,
      sortOrder: line.sortOrder,
    })),
    specialParts: specialRows.map((line) => ({
      id: line.id,
      name: line.name,
      qty: line.qty,
      price: line.price,
      costPrice: line.costPrice,
      isEmergencyLighting: line.isEmergencyLighting,
      sortOrder: line.sortOrder,
    })),
  }
}

export async function replaceLines(
  tx: Tx,
  quoteId: number,
  lines: {
    hours: Array<{
      hours?: string
      numTechs?: number
      rate?: string
      rateCode?: string | null
      lineDate?: string | null
      incurredHours?: string | null
      incurredRate?: string | null
      note?: string | null
    }>
    parts: Array<{
      partNo: string
      description?: string | null
      qty: number
      price: string
      costPrice?: string | null
      isUnderWarranty?: boolean
    }>
    specialParts: Array<{
      name: string
      qty: number
      price: string
      costPrice?: string | null
      isEmergencyLighting?: boolean
    }>
  },
): Promise<void> {
  await tx.delete(quoteHours).where(eq(quoteHours.quoteId, quoteId))
  await tx.delete(quoteParts).where(eq(quoteParts.quoteId, quoteId))
  await tx.delete(quoteSpecialParts).where(eq(quoteSpecialParts.quoteId, quoteId))

  if (lines.hours.length) {
    await tx.insert(quoteHours).values(
      lines.hours.map((line, index) => ({
        quoteId,
        lineDate: line.lineDate ?? null,
        hours: line.hours ?? '0',
        numTechs: line.numTechs ?? 1,
        rateCode: line.rateCode ?? null,
        rate: line.rate ?? '0',
        incurredHours: line.incurredHours ?? null,
        incurredRate: line.incurredRate ?? null,
        note: line.note ?? null,
        sortOrder: index,
      })),
    )
  }
  if (lines.parts.length) {
    await tx.insert(quoteParts).values(
      lines.parts.map((line, index) => ({
        quoteId,
        partNo: line.partNo,
        description: line.description ?? null,
        qty: line.qty,
        price: line.price,
        costPrice: line.costPrice ?? null,
        isUnderWarranty: line.isUnderWarranty ?? false,
        sortOrder: index,
      })),
    )
  }
  if (lines.specialParts.length) {
    await tx.insert(quoteSpecialParts).values(
      lines.specialParts.map((line, index) => ({
        quoteId,
        name: line.name,
        qty: line.qty,
        price: line.price,
        costPrice: line.costPrice ?? null,
        isEmergencyLighting: line.isEmergencyLighting ?? false,
        sortOrder: index,
      })),
    )
  }
}

export async function loadRejections(executor: Executor, quoteId: number) {
  return executor
    .select()
    .from(quoteRejections)
    .where(eq(quoteRejections.quoteId, quoteId))
    .orderBy(desc(quoteRejections.rejectedAt))
}

/** Mark every other row in the chain as not the end, keeping one end. */
export async function clearChainEnd(
  tx: Tx,
  rootId: number,
  currentId: number,
): Promise<void> {
  await tx
    .update(quotes)
    .set({ isLastRevision: false })
    .where(and(eq(quotes.rootQuoteId, rootId), ne(quotes.id, currentId)))
}
