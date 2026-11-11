/**
 * Invoicing access and immutability guards.
 *
 * SERVER ONLY. Sales invoices are office documents: subcontractors and
 * suppliers only reach their own purchase invoices through the portal.
 */
import { and, eq } from 'drizzle-orm'
import { ForbiddenError, NotFoundError, ValidationError } from '@cls/core'
import type { Executor, Tx } from '@cls/db'
import {
  invoiceStockPostings,
  sagePostings,
  salesInvoices,
  subcontractorInvoices,
  workOrders,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import { assertPermission } from '../../../server/middleware'
import { invoiceImmutability, type ImmutabilityResult } from '../lib/lifecycle'

export function assertSalesInvoiceRead(session: AuthSessionView): void {
  assertPermission(session, 'invoice:read')
  if (session.user.role === 'subcontractor' || session.user.role === 'supplier') {
    throw new ForbiddenError('Customer invoices are not available to this account.')
  }
}

export function assertSalesInvoiceWrite(session: AuthSessionView): void {
  assertPermission(session, 'invoice:write')
}

export function assertSalesInvoiceIssue(session: AuthSessionView): void {
  assertPermission(session, 'invoice:issue')
}

export async function loadSalesInvoice(
  session: AuthSessionView,
  invoiceId: number,
  executor: Executor,
  options: { forUpdate?: boolean; tx?: Tx } = {},
): Promise<typeof salesInvoices.$inferSelect> {
  assertSalesInvoiceRead(session)
  const base = executor.select().from(salesInvoices).where(eq(salesInvoices.id, invoiceId))
  const query = options.forUpdate && options.tx ? base.for('update') : base
  const [row] = await query.limit(1)
  if (!row) throw new NotFoundError('That invoice does not exist.')
  return row
}

export async function loadWorkOrderFlags(
  workOrderId: number,
  executor: Executor,
): Promise<{
  sageSalesDone: boolean
  stockUpdated: boolean
  onlyPortalStockUpdated: boolean
}> {
  const [row] = await executor
    .select({
      sageSalesDone: workOrders.sageSalesDone,
      stockUpdated: workOrders.stockUpdated,
      onlyPortalStockUpdated: workOrders.onlyPortalStockUpdated,
    })
    .from(workOrders)
    .where(eq(workOrders.id, workOrderId))
    .limit(1)
  if (!row) throw new ValidationError('That invoice has no work order.')
  return row
}

export async function invoiceImmutabilityState(
  invoice: { id: number; workOrderId: number },
  executor: Executor,
): Promise<ImmutabilityResult> {
  const [flags, stock, posting] = await Promise.all([
    loadWorkOrderFlags(invoice.workOrderId, executor),
    executor
      .select({ status: invoiceStockPostings.status })
      .from(invoiceStockPostings)
      .where(eq(invoiceStockPostings.invoiceId, invoice.id))
      .limit(1),
    executor
      .select({ status: sagePostings.status })
      .from(sagePostings)
      .where(and(eq(sagePostings.docType, 'sales_invoice'), eq(sagePostings.docId, invoice.id)))
      .limit(1),
  ])
  return invoiceImmutability({
    workOrderFlags: flags,
    stockPosted: stock[0]?.status === 'posted',
    sageStatus: posting[0]?.status ?? null,
  })
}

export async function assertInvoiceMutable(
  invoice: { id: number; workOrderId: number },
  executor: Executor,
): Promise<void> {
  const state = await invoiceImmutabilityState(invoice, executor)
  if (state.immutable) {
    throw new ValidationError(`The invoice can not be edited. ${state.reason ?? ''}`.trim())
  }
}

export function assertSubcontractorInvoiceRead(session: AuthSessionView): void {
  assertPermission(session, 'invoice:read')
}

export function subcontractorScope(session: AuthSessionView): number {
  if (
    (session.user.role === 'subcontractor' || session.user.role === 'admin') &&
    session.user.subcontractorId
  ) {
    return session.user.subcontractorId
  }
  throw new ForbiddenError('This account is not linked to a subcontractor.')
}

export async function loadSubcontractorInvoice(
  session: AuthSessionView,
  invoiceId: number,
  executor: Executor,
  options: { forUpdate?: boolean; tx?: Tx } = {},
): Promise<typeof subcontractorInvoices.$inferSelect> {
  assertSubcontractorInvoiceRead(session)
  const base = executor
    .select()
    .from(subcontractorInvoices)
    .where(eq(subcontractorInvoices.id, invoiceId))
  const query = options.forUpdate && options.tx ? base.for('update') : base
  const [row] = await query.limit(1)
  if (!row) throw new NotFoundError('That subcontractor invoice does not exist.')

  // A subcontractor sees only its own documents; office roles with invoice:read
  // may review all.
  if (
    session.user.role === 'subcontractor' &&
    row.subcontractorId !== session.user.subcontractorId
  ) {
    throw new NotFoundError('That subcontractor invoice does not exist.')
  }
  return row
}
