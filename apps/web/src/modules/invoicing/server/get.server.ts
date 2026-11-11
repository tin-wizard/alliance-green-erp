/**
 * Invoice reads. Sales invoices are always returned with their posted totals
 * and wholesale line snapshot; office roles only.
 */
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { NotFoundError } from '@cls/core'
import type { Executor } from '@cls/db'
import {
  generatedDocuments,
  invoiceLabourLines,
  invoicePartLines,
  invoicePayments,
  invoiceSpecialPartLines,
  rejectedInvoices,
  sagePostings,
  salesInvoices,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import { getSite } from '../../work-orders/lib/lookups'
import { assertSalesInvoiceRead, invoiceImmutabilityState, loadSalesInvoice } from './access.server'
import { canEditInvoice, canIssueInvoice, type SalesInvoiceStatus } from '../lib/lifecycle'

export async function getInvoiceDetail(
  session: AuthSessionView,
  invoiceId: number,
  executor: Executor,
) {
  const invoice = await loadSalesInvoice(session, invoiceId, executor)
  const [labour, parts, specialParts, payments, rejections, site, immutability, postingRows] =
    await Promise.all([
      executor
        .select()
        .from(invoiceLabourLines)
        .where(eq(invoiceLabourLines.invoiceId, invoice.id))
        .orderBy(asc(invoiceLabourLines.position)),
      executor
        .select()
        .from(invoicePartLines)
        .where(eq(invoicePartLines.invoiceId, invoice.id))
        .orderBy(asc(invoicePartLines.position)),
      executor
        .select()
        .from(invoiceSpecialPartLines)
        .where(eq(invoiceSpecialPartLines.invoiceId, invoice.id))
        .orderBy(asc(invoiceSpecialPartLines.position)),
      executor
        .select()
        .from(invoicePayments)
        .where(eq(invoicePayments.invoiceId, invoice.id))
        .orderBy(desc(invoicePayments.paidOn), desc(invoicePayments.id)),
      executor
        .select()
        .from(rejectedInvoices)
        .where(eq(rejectedInvoices.invoiceId, invoice.id))
        .orderBy(desc(rejectedInvoices.rejectedAt)),
      getSite(invoice.siteId, executor),
      invoiceImmutabilityState(invoice, executor),
      executor
        .select()
        .from(sagePostings)
        .where(
          and(eq(sagePostings.docType, 'sales_invoice'), eq(sagePostings.docId, invoice.id)),
        )
        .limit(1),
    ])

  const documents = await executor
    .select({
      id: generatedDocuments.id,
      sha256: generatedDocuments.sha256,
      schemaVersion: generatedDocuments.schemaVersion,
      rendererVersion: generatedDocuments.rendererVersion,
      byteSize: generatedDocuments.byteSize,
      pageCount: generatedDocuments.pageCount,
      createdAt: generatedDocuments.createdAt,
    })
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.entityType, 'sales_invoice'),
        eq(generatedDocuments.entityId, String(invoice.id)),
      ),
    )
    .orderBy(desc(generatedDocuments.createdAt))

  const paidAmount = payments.reduce((sum, payment) => sum + Number(payment.amount), 0).toFixed(2)
  const status = invoice.status as SalesInvoiceStatus

  return {
    invoice: {
      ...invoice,
      issuedAt: invoice.issuedAt?.toISOString() ?? null,
      lastRejectedAt: invoice.lastRejectedAt?.toISOString() ?? null,
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
    },
    labour: labour.map((line) => ({
      ...line,
      lineDate: line.lineDate,
    })),
    parts,
    specialParts,
    payments: payments.map((payment) => ({
      ...payment,
      paidOn: payment.paidOn,
      createdAt: payment.createdAt.toISOString(),
    })),
    rejections: rejections.map((rejection) => ({
      id: rejection.id,
      invoiceNumber: rejection.invoiceNumber,
      reason: rejection.reason,
      rejectedByDetail: rejection.rejectedByDetail,
      rejectedAt: rejection.rejectedAt.toISOString(),
      resubmittedAt: rejection.resubmittedAt?.toISOString() ?? null,
    })),
    site,
    immutability,
    paidAmount,
    balanceDue: (Number(invoice.totalAmount) - Number(paidAmount)).toFixed(2),
    canEdit: canEditInvoice(status, immutability.immutable),
    canIssue: canIssueInvoice(status, immutability.immutable),
    sagePosting: postingRows[0]
      ? {
          id: postingRows[0].id,
          status: postingRows[0].status,
          attempt: postingRows[0].attempt,
          externalRef: postingRows[0].externalRef,
          lastError: postingRows[0].lastError,
          requestedAt: postingRows[0].requestedAt.toISOString(),
          processedAt: postingRows[0].processedAt?.toISOString() ?? null,
          updatedAt: postingRows[0].updatedAt.toISOString(),
        }
      : null,
    documents: documents.map((document) => ({
      ...document,
      createdAt: document.createdAt.toISOString(),
    })),
  }
}

export type InvoiceDetail = Awaited<ReturnType<typeof getInvoiceDetail>>

export async function listInvoices(
  session: AuthSessionView,
  input: { status?: string; search?: string; limit?: number },
  executor: Executor,
) {
  assertSalesInvoiceRead(session)
  const term = input.search?.trim()
  const where = and(
    input.status ? eq(salesInvoices.status, input.status) : sql`true`,
    term
      ? or(
          ilike(salesInvoices.invoiceNumber, `%${term}%`),
          ilike(sql`${salesInvoices.workOrderNumber}::text`, `%${term}%`),
        )
      : sql`true`,
  )
  const rows = await executor
    .select()
    .from(salesInvoices)
    .where(where)
    .orderBy(desc(salesInvoices.invoiceDate), desc(salesInvoices.id))
    .limit(Math.min(input.limit ?? 100, 200))
  return rows.map((row) => ({
    ...row,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    lastRejectedAt: row.lastRejectedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }))
}

export async function findInvoiceForWorkOrder(
  session: AuthSessionView,
  workOrderId: number,
  executor: Executor,
) {
  assertSalesInvoiceRead(session)
  const [row] = await executor
    .select({
      id: salesInvoices.id,
      invoiceNumber: salesInvoices.invoiceNumber,
      status: salesInvoices.status,
    })
    .from(salesInvoices)
    .where(eq(salesInvoices.workOrderId, workOrderId))
    .limit(1)
  if (!row) return null
  const [rejection] = await executor
    .select({ reason: rejectedInvoices.reason })
    .from(rejectedInvoices)
    .where(eq(rejectedInvoices.invoiceId, row.id))
    .orderBy(desc(rejectedInvoices.rejectedAt))
    .limit(1)
  return { ...row, rejectionReason: rejection?.reason ?? null }
}

export async function invoiceContentForRejection(invoiceId: number, executor: Executor) {
  const [invoice] = await executor
    .select()
    .from(salesInvoices)
    .where(eq(salesInvoices.id, invoiceId))
    .limit(1)
  if (!invoice) throw new NotFoundError('That invoice does not exist.')
  const [labour, parts, specialParts] = await Promise.all([
    executor
      .select()
      .from(invoiceLabourLines)
      .where(eq(invoiceLabourLines.invoiceId, invoiceId)),
    executor.select().from(invoicePartLines).where(eq(invoicePartLines.invoiceId, invoiceId)),
    executor
      .select()
      .from(invoiceSpecialPartLines)
      .where(eq(invoiceSpecialPartLines.invoiceId, invoiceId)),
  ])
  return {
    invoice: {
      number: invoice.invoiceNumber,
      workOrderNumber: invoice.workOrderNumber,
      subtotal: invoice.subtotalAmount,
      tax: invoice.taxAmount,
      total: invoice.totalAmount,
      status: invoice.status,
    },
    labour,
    parts,
    specialParts,
  }
}
