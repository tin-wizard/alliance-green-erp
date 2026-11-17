import { and, eq } from 'drizzle-orm'
import { ForbiddenError, NotFoundError } from '@cls/core'
import type { Executor } from '@cls/db'
import { purchaseOrders, suppliers } from '@cls/db/schema'
import { assertPermission } from '../../../server/middleware'
import type { AuthSessionView } from '../../../server/auth.types'
import type { PurchaseOrderStatus } from '../types'

export type PurchaseOrderRow = typeof purchaseOrders.$inferSelect

export function hasGrant(session: AuthSessionView, key: string): boolean {
  return session.user.grants.some((grant) => grant.key === key)
}

export function grantSet(session: AuthSessionView): Set<string> {
  return new Set(session.user.grants.map((grant) => grant.key))
}

export function assertPurchaseOrderWrite(session: AuthSessionView): void {
  assertPermission(session, 'purchasing:write')
}

export function assertPurchaseOrderRead(session: AuthSessionView): void {
  assertPermission(session, 'purchasing:read')
  if (session.user.role === 'supplier') {
    throw new ForbiddenError('The office purchasing view is not available to supplier accounts.')
  }
}

export async function loadPurchaseOrder(
  session: AuthSessionView,
  id: number,
  executor: Executor,
  forUpdate = false,
): Promise<PurchaseOrderRow> {
  const query = executor.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1)
  const [row] = forUpdate ? await query.for('update') : await query
  if (!row) throw new NotFoundError('Purchase order')

  // Supplier accounts are always scoped to their own supplier record.
  if (session.user.role === 'supplier') {
    const [supplier] = await executor
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.userId, session.user.id))
      .limit(1)
    if (!supplier || supplier.id !== row.supplierId) {
      throw new ForbiddenError('This purchase order belongs to another supplier.')
    }
  }
  return row
}

export async function loadSupplier(
  executor: Executor,
  supplierId: number,
): Promise<typeof suppliers.$inferSelect> {
  const [row] = await executor
    .select()
    .from(suppliers)
    .where(eq(suppliers.id, supplierId))
    .limit(1)
  if (!row) throw new NotFoundError('Supplier')
  return row
}

export function isEditableStatus(status: number): boolean {
  return status === 1 || status === 3 || status === 8 || status === 2 || status === 6
}

export function isTerminalStatus(status: PurchaseOrderStatus): boolean {
  return status === 10 || status === 11
}

export async function supplierIdForSession(
  session: AuthSessionView,
  executor: Executor,
): Promise<number> {
  const [supplier] = await executor
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(eq(suppliers.userId, session.user.id))
    .limit(1)
  if (!supplier) throw new ForbiddenError('This account is not linked to a supplier.')
  return supplier.id
}

export async function offeredSupplierIds(
  executor: Executor,
  rfqId: number,
): Promise<Set<number>> {
  const { purchaseOrderRfqSuppliers } = await import('@cls/db/schema')
  const rows = await executor
    .select({ supplierId: purchaseOrderRfqSuppliers.supplierId })
    .from(purchaseOrderRfqSuppliers)
    .where(eq(purchaseOrderRfqSuppliers.rfqId, rfqId))
  return new Set(rows.map((row) => row.supplierId))
}

export async function isSupplierOffered(
  executor: Executor,
  rfqId: number,
  supplierId: number,
): Promise<boolean> {
  const { purchaseOrderRfqSuppliers } = await import('@cls/db/schema')
  const [row] = await executor
    .select({ id: purchaseOrderRfqSuppliers.id })
    .from(purchaseOrderRfqSuppliers)
    .where(and(eq(purchaseOrderRfqSuppliers.rfqId, rfqId), eq(purchaseOrderRfqSuppliers.supplierId, supplierId)))
    .limit(1)
  return Boolean(row)
}
