/**
 * Stock reporting: parts stock, purchased detail, sold detail and complete
 * detail. The counter is shown beside the ledger total; a difference is
 * reported, never repaired (E4).
 */
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import type { Executor } from '@cls/db'
import { inventoryMovements, parts } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import { assertPermission } from '../../../server/middleware'
import { counterLedgerDifference } from '../lib/stock'

export interface StockPartRow {
  id: number
  partNumber: string
  name: string | null
  currentQuantity: string
  purchasedQuantity: string
  soldQuantity: string
  ledgerQuantity: string
  difference: string
  subignore: boolean
}

async function ledgerTotals(
  executor: Executor,
  partNumbers: string[],
): Promise<Map<string, string>> {
  if (partNumbers.length === 0) return new Map()
  const rows = await executor
    .select({
      partNo: inventoryMovements.partNo,
      total: sql<string>`coalesce(sum(${inventoryMovements.qty}), 0)::text`,
    })
    .from(inventoryMovements)
    .where(
      and(
        inArray(inventoryMovements.partNo, partNumbers),
        eq(inventoryMovements.isLogDeleted, false),
        eq(inventoryMovements.isIncludedInStockManagement, true),
      ),
    )
    .groupBy(inventoryMovements.partNo)
  return new Map(rows.map((row) => [row.partNo, row.total]))
}

export async function listStockParts(
  session: AuthSessionView,
  input: { search?: string; page?: number; pageSize?: number },
  executor: Executor,
): Promise<{ rows: StockPartRow[]; total: number }> {
  assertPermission(session, 'inventory:read')
  const term = input.search?.trim()
  const pageSize = Math.min(input.pageSize ?? 50, 100)
  const page = Math.max(input.page ?? 1, 1)
  const where = term
    ? or(ilike(parts.partNumber, `%${term}%`), ilike(parts.name, `%${term}%`))
    : undefined

  const rows = await executor
    .select()
    .from(parts)
    .where(where)
    .orderBy(asc(parts.partNumber))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
  const [count] = await executor
    .select({ total: sql<number>`count(*)::int` })
    .from(parts)
    .where(where)
  const ledger = await ledgerTotals(
    executor,
    rows.map((row) => row.partNumber),
  )
  return {
    rows: rows.map((row) => {
      const ledgerQuantity = ledger.get(row.partNumber) ?? '0'
      return {
        id: row.id,
        partNumber: row.partNumber,
        name: row.name,
        currentQuantity: row.currentQuantity,
        purchasedQuantity: row.purchasedQuantity,
        soldQuantity: row.soldQuantity,
        ledgerQuantity,
        difference: counterLedgerDifference(row.currentQuantity, ledgerQuantity),
        subignore: row.subignore,
      }
    }),
    total: count?.total ?? rows.length,
  }
}

export interface MovementReportRow {
  id: number
  partNo: string
  qty: string
  price: string | null
  transactionType: string
  movementType: string
  referenceType: string
  referenceId: string
  documentType: string | null
  documentId: string | null
  woidPoid: number | null
  invoiceNumber: string | null
  invoiceId: number | null
  adjustmentType: string | null
  adjSubcontractor: number | null
  adjSite: number | null
  isIncludedInStockManagement: boolean
  isLogDeleted: boolean
  note: string | null
  createdAt: string
}

export async function movementReport(
  session: AuthSessionView,
  input: { kind: 'purchased' | 'sold' | 'complete'; search?: string; limit?: number },
  executor: Executor,
): Promise<MovementReportRow[]> {
  assertPermission(session, 'inventory:read')
  const term = input.search?.trim()
  const type = input.kind === 'purchased' ? 'Purchase' : input.kind === 'sold' ? 'Sale' : null
  const rows = await executor
    .select()
    .from(inventoryMovements)
    .where(
      term || type
        ? sql`${term ? sql`${inventoryMovements.partNo} ilike ${`%${term}%`}` : sql`true`} and ${
            type ? sql`${inventoryMovements.transactionType} = ${type}` : sql`true`
          }`
        : undefined,
    )
    .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
    .limit(Math.min(input.limit ?? 200, 500))
  return rows.map((row) => ({
    id: row.id,
    partNo: row.partNo,
    qty: row.qty,
    price: row.price,
    transactionType: row.transactionType,
    movementType: row.movementType,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    documentType: row.documentType,
    documentId: row.documentId,
    woidPoid: row.woidPoid,
    invoiceNumber: row.invoiceNumber,
    invoiceId: row.invoiceId,
    adjustmentType: row.adjustmentType,
    adjSubcontractor: row.adjSubcontractor,
    adjSite: row.adjSite,
    isIncludedInStockManagement: row.isIncludedInStockManagement,
    isLogDeleted: row.isLogDeleted,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  }))
}

export async function stockCounterDisagreements(
  session: AuthSessionView,
  executor: Executor,
): Promise<StockPartRow[]> {
  assertPermission(session, 'inventory:read')
  const ledgerQuantity = sql<string>`coalesce(sum(case when ${inventoryMovements.isLogDeleted} = false and ${inventoryMovements.isIncludedInStockManagement} = true then ${inventoryMovements.qty} else 0 end), 0)`
  const rows = await executor
    .select({
      id: parts.id,
      partNumber: parts.partNumber,
      name: parts.name,
      currentQuantity: parts.currentQuantity,
      purchasedQuantity: parts.purchasedQuantity,
      soldQuantity: parts.soldQuantity,
      subignore: parts.subignore,
      ledgerQuantity,
    })
    .from(parts)
    .leftJoin(inventoryMovements, eq(inventoryMovements.partNo, parts.partNumber))
    .groupBy(
      parts.id,
      parts.partNumber,
      parts.name,
      parts.currentQuantity,
      parts.purchasedQuantity,
      parts.soldQuantity,
      parts.subignore,
    )
    .having(sql`${parts.currentQuantity} <> ${ledgerQuantity}`)
    .orderBy(asc(parts.partNumber))
  return rows.map((row) => ({
    ...row,
    difference: counterLedgerDifference(row.currentQuantity, row.ledgerQuantity),
  }))
}

export async function partPriceHistory(
  session: AuthSessionView,
  partId: number,
  executor: Executor,
) {
  assertPermission(session, 'inventory:read')
  const { partPriceHistory: history } = await import('@cls/db/schema')
  return executor
    .select()
    .from(history)
    .where(eq(history.partId, partId))
    .orderBy(desc(history.changedAt), desc(history.id))
    .limit(100)
}
