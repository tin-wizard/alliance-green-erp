import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import type { Db } from '@cls/db'
import { purchaseOrders, suppliers } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type { PurchaseOrderListResult, PurchaseOrderStatus } from '../types'
import { assertPermission } from '../../../server/middleware'
import { supplierIdForSession } from './access.server'
import { displayNumberFor } from './numbering.server'

export interface PurchaseOrderListFilters {
  status?: number | null
  search?: string
  cursor?: string | null
  size?: number
}

interface Cursor {
  createdAt: string
  id: number
}

export function encodeCursor(row: { createdAt: Date; id: number }): string {
  return Buffer.from(JSON.stringify({ c: row.createdAt.toISOString(), i: row.id })).toString('base64url')
}

export function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<{ c: unknown; i: unknown }>
    if (typeof parsed.c !== 'string' || typeof parsed.i !== 'number') return null
    return { createdAt: parsed.c, id: parsed.i }
  } catch {
    return null
  }
}

export async function listPurchaseOrders(
  session: AuthSessionView,
  filters: PurchaseOrderListFilters,
  executor: Db,
): Promise<PurchaseOrderListResult> {
  assertPermission(session, 'purchasing:read')
  const size = filters.size ?? 25
  const term = (filters.search ?? '').trim()
  const cursor = decodeCursor(filters.cursor)

  const conditions = []
  // A supplier account sees only purchase orders addressed to its supplier
  // record, never the rest of the book.
  if (session.user.role === 'supplier') {
    conditions.push(eq(purchaseOrders.supplierId, await supplierIdForSession(session, executor)))
  }
  if (filters.status) conditions.push(eq(purchaseOrders.status, filters.status))
  if (term) {
    conditions.push(
      or(
        ilike(suppliers.name, `%${term}%`),
        sql`cast(${purchaseOrders.id} as text) ilike ${`%${term}%`}`,
        ilike(purchaseOrders.displayNumber, `%${term}%`),
        ilike(purchaseOrders.notes, `%${term}%`),
      ),
    )
  }
  if (cursor) {
    conditions.push(
      sql`(${purchaseOrders.createdAt}, ${purchaseOrders.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id})`,
    )
  }

  const where = conditions.length ? and(...conditions) : undefined
  const rows = await executor
    .select({
      id: purchaseOrders.id,
      displayNumber: purchaseOrders.displayNumber,
      status: purchaseOrders.status,
      supplierName: suppliers.name,
      expectedDelivery: purchaseOrders.expectedDelivery,
      total: purchaseOrders.total,
      createdAt: purchaseOrders.createdAt,
      isTransfer: purchaseOrders.isTransfer,
      approvalRequestBy: purchaseOrders.approvalRequestBy,
    })
    .from(purchaseOrders)
    .leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(where)
    .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.id))
    .limit(size + 1)

  const page = rows.slice(0, size)
  const countRows = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(purchaseOrders)
    .leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(where)

  return {
    rows: page.map((row) => ({
      id: row.id,
      displayNumber: displayNumberFor(row.id, row.displayNumber),
      status: row.status as PurchaseOrderStatus,
      supplierName: row.supplierName ?? `Supplier`,
      expectedDelivery: row.expectedDelivery,
      total: row.total,
      createdAt: row.createdAt.toISOString(),
      isTransfer: row.isTransfer,
      approvalRequestBy: row.approvalRequestBy,
    })),
    total: countRows[0]?.count ?? page.length,
    nextCursor: rows.length > size ? encodeCursor(page[page.length - 1]!) : null,
  }
}
