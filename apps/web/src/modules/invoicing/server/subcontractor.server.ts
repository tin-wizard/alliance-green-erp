/**
 * Subcontractor purchase invoices (§8).
 *
 * A subcontractor submits against one of their own work orders. Office review
 * approves or rejects; approval is what queues the Sage posting. Subcontractors
 * can only ever read and submit their own records.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { ForbiddenError, NotFoundError, ValidationError } from '@cls/core'
import type { Executor, Tx } from '@cls/db'
import {
  subcontractorInvoiceLines,
  subcontractorInvoicePayments,
  subcontractorInvoices,
  workOrders,
} from '@cls/db/schema'
import { calculateSubcontractorPurchaseTotals, format, parseDecimal, round } from '@cls/pricing'
import type { AuthSessionView } from '../../../server/auth.types'
import {
  assertSubcontractorInvoiceRead,
  assertSalesInvoiceWrite,
  loadSubcontractorInvoice,
  subcontractorScope,
} from './access.server'
import { paymentStatus, type SubcontractorInvoiceStatus } from '../lib/lifecycle'
import { lineAmount } from '../lib/money'
import { auditSubInvoice } from './records.server'
import { queueSubcontractorPostingCore } from './posting.server'

function money(value: string): string {
  const parsed = parseDecimal(value)
  if (!parsed) throw new ValidationError(`Invalid money value: ${value}`)
  return format(round(parsed, 2), 2)
}

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function requireSubcontractor(session: AuthSessionView): number {
  if (session.user.role !== 'subcontractor' || !session.user.subcontractorId) {
    throw new ForbiddenError('Only a subcontractor can submit this invoice.')
  }
  return session.user.subcontractorId
}

export interface SubcontractorInvoiceLineInput {
  kind: 'labour' | 'part' | 'special'
  description?: string | null
  qty: string
  rate: string
  sourceLineId?: number | null
}

export async function createSubcontractorInvoiceCore(
  tx: Tx,
  input: {
    workOrderId: number
    invoiceNumber: string
    invoiceDate: string
    taxProvince: string
    appliedTaxRate?: string | null
    notes?: string | null
    lines: SubcontractorInvoiceLineInput[]
  },
  session: AuthSessionView,
): Promise<{ invoiceId: number; version: number; status: SubcontractorInvoiceStatus }> {
  const subcontractorId = requireSubcontractor(session)
  const [workOrder] = await tx
    .select({ id: workOrders.id, subcontractorId: workOrders.subcontractorId })
    .from(workOrders)
    .where(and(eq(workOrders.id, input.workOrderId), eq(workOrders.subcontractorId, subcontractorId)))
    .limit(1)
  if (!workOrder) throw new NotFoundError('That work order is not assigned to you.')
  if (input.lines.length === 0) throw new ValidationError('Add at least one line.')

  const totals = calculateSubcontractorPurchaseTotals({
    taxProvince: input.taxProvince,
    appliedTaxRate: input.appliedTaxRate ?? null,
    invoiceDate: input.invoiceDate,
    labour: input.lines
      .filter((line) => line.kind === 'labour')
      .map((line) => ({
        date: input.invoiceDate,
        hours: line.qty,
        hourlyRate: line.rate,
      })),
    parts: input.lines
      .filter((line) => line.kind === 'part')
      .map((line) => ({ qty: line.qty, price: line.rate })),
    specialParts: input.lines
      .filter((line) => line.kind === 'special')
      .map((line) => ({ name: line.description, qty: line.qty, price: line.rate })),
  })
  if (!totals || !totals.payable) {
    throw new ValidationError('Those lines do not produce a payable invoice.')
  }

  const [invoice] = await tx
    .insert(subcontractorInvoices)
    .values({
      workOrderId: workOrder.id,
      subcontractorId,
      invoiceNumber: input.invoiceNumber.trim(),
      invoiceDate: input.invoiceDate,
      status: 'submitted',
      taxProvince: totals.taxProvince,
      appliedTaxRate: input.appliedTaxRate ?? null,
      labourAmount: totals.labour,
      materialAmount: totals.material,
      subtotalAmount: totals.subtotal,
      taxAmount: totals.tax,
      totalAmount: totals.total,
      notes: input.notes ?? null,
      submittedBy: session.user.id,
    })
    .returning()
  if (!invoice) throw new ValidationError('The invoice could not be submitted.')

  await tx.insert(subcontractorInvoiceLines).values(
    input.lines.map((line, index) => ({
      invoiceId: invoice.id,
      kind: line.kind,
      position: index + 1,
      description: line.description ?? null,
      qty: line.qty,
      rate: line.rate,
      amount: lineAmount(line.qty, line.rate),
      sourceLineId: line.sourceLineId ?? null,
    })),
  )

  await auditSubInvoice(tx, session, 'sub_invoice.submit', invoice.id, {
    summary: `Subcontractor submitted invoice ${invoice.invoiceNumber} for work order ${workOrder.id}.`,
    after: { total: totals.total, workOrderId: workOrder.id },
  })
  return { invoiceId: invoice.id, version: invoice.version, status: 'submitted' }
}

export async function approveSubcontractorInvoiceCore(
  tx: Tx,
  input: { invoiceId: number; version: number },
  session: AuthSessionView,
): Promise<{ invoiceId: number; version: number; status: SubcontractorInvoiceStatus }> {
  assertSalesInvoiceWrite(session)
  const invoice = await loadSubcontractorInvoice(session, input.invoiceId, tx, {
    forUpdate: true,
    tx,
  })
  if (invoice.status !== 'submitted') {
    throw new ValidationError('Only a submitted invoice can be approved.')
  }
  if (invoice.version !== input.version) {
    throw new ValidationError('This invoice changed since it was loaded. Reload and retry.')
  }
  const [updated] = await tx
    .update(subcontractorInvoices)
    .set({
      status: 'approved',
      reviewedBy: session.user.id,
      reviewedAt: new Date(),
      rejectionReason: null,
      version: sql`${subcontractorInvoices.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(subcontractorInvoices.id, invoice.id))
    .returning()
  if (!updated) throw new ValidationError('The invoice could not be approved.')

  await queueSubcontractorPostingCore(tx, invoice.id)
  await auditSubInvoice(tx, session, 'sub_invoice.approve', invoice.id, {
    summary: `Approved subcontractor invoice ${invoice.invoiceNumber}.`,
    before: { status: invoice.status, version: invoice.version },
    after: { status: 'approved', version: updated.version },
  })
  return { invoiceId: updated.id, version: updated.version, status: 'approved' }
}

export async function rejectSubcontractorInvoiceCore(
  tx: Tx,
  input: { invoiceId: number; reason: string },
  session: AuthSessionView,
): Promise<{ invoiceId: number; status: SubcontractorInvoiceStatus }> {
  assertSalesInvoiceWrite(session)
  const invoice = await loadSubcontractorInvoice(session, input.invoiceId, tx, {
    forUpdate: true,
    tx,
  })
  if (invoice.status !== 'submitted') {
    throw new ValidationError('Only a submitted invoice can be rejected.')
  }
  await tx
    .update(subcontractorInvoices)
    .set({
      status: 'rejected',
      rejectionReason: input.reason,
      reviewedBy: session.user.id,
      reviewedAt: new Date(),
      version: sql`${subcontractorInvoices.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(subcontractorInvoices.id, invoice.id))
  await auditSubInvoice(tx, session, 'sub_invoice.reject', invoice.id, {
    summary: `Rejected subcontractor invoice ${invoice.invoiceNumber}: ${input.reason}`,
    permission: 'invoice:write',
    after: { status: 'rejected' },
  })
  return { invoiceId: invoice.id, status: 'rejected' }
}

export async function recordSubcontractorPaymentCore(
  tx: Tx,
  input: {
    invoiceId: number
    amount: string
    paidOn?: string
    method?: string | null
    reference?: string | null
    idempotencyKey: string
  },
  session: AuthSessionView,
): Promise<{ paymentId: number; status: SubcontractorInvoiceStatus; paidAmount: string; replay: boolean }> {
  assertSalesInvoiceWrite(session)
  const invoice = await loadSubcontractorInvoice(session, input.invoiceId, tx, {
    forUpdate: true,
    tx,
  })
  if (!['approved', 'partially_paid'].includes(invoice.status)) {
    throw new ValidationError('Payments can only be recorded against an approved invoice.')
  }
  const amount = money(input.amount)
  const [payment] = await tx
    .insert(subcontractorInvoicePayments)
    .values({
      invoiceId: invoice.id,
      amount,
      paidOn: input.paidOn ?? today(),
      method: input.method ?? null,
      reference: input.reference ?? null,
      idempotencyKey: input.idempotencyKey,
      recordedBy: session.user.id,
    })
    .onConflictDoNothing({ target: subcontractorInvoicePayments.idempotencyKey })
    .returning()
  if (!payment) {
    const [existing] = await tx
      .select()
      .from(subcontractorInvoicePayments)
      .where(eq(subcontractorInvoicePayments.idempotencyKey, input.idempotencyKey))
      .limit(1)
    const [paid] = await tx
      .select({ total: sql<string>`coalesce(sum(${subcontractorInvoicePayments.amount}), 0)::text` })
      .from(subcontractorInvoicePayments)
      .where(eq(subcontractorInvoicePayments.invoiceId, invoice.id))
    return {
      paymentId: existing!.id,
      status: invoice.status as SubcontractorInvoiceStatus,
      paidAmount: money(paid?.total ?? '0'),
      replay: true,
    }
  }
  const [paid] = await tx
    .select({ total: sql<string>`coalesce(sum(${subcontractorInvoicePayments.amount}), 0)::text` })
    .from(subcontractorInvoicePayments)
    .where(eq(subcontractorInvoicePayments.invoiceId, invoice.id))
  const paidAmount = money(paid?.total ?? '0')
  const status = paymentStatus(invoice.totalAmount, paidAmount) as SubcontractorInvoiceStatus
  await tx
    .update(subcontractorInvoices)
    .set({ status, version: sql`${subcontractorInvoices.version} + 1`, updatedAt: new Date() })
    .where(eq(subcontractorInvoices.id, invoice.id))
  await auditSubInvoice(tx, session, 'sub_invoice.payment', invoice.id, {
    summary: `Recorded payment ${amount} against subcontractor invoice ${invoice.invoiceNumber}.`,
    permission: 'invoice:write',
    after: { paymentId: payment.id, paidAmount, status },
  })
  return { paymentId: payment.id, status, paidAmount, replay: false }
}

export interface SubcontractorInvoiceSummary {
  id: number
  workOrderId: number
  subcontractorId: number
  invoiceNumber: string
  invoiceDate: string
  status: string
  totalAmount: string
  paidAmount: string
  rejectionReason: string | null
  version: number
  createdAt: string
}

export async function listSubcontractorInvoices(
  session: AuthSessionView,
  executor: Executor,
): Promise<SubcontractorInvoiceSummary[]> {
  assertSubcontractorInvoiceRead(session)
  const scope = session.user.role === 'admin' ? null : subcontractorScope(session)
  const rows = await executor
    .select({
      invoice: subcontractorInvoices,
      paidAmount: sql<string>`coalesce((
        select sum(p.amount) from ${subcontractorInvoicePayments} p
        where p.invoice_id = ${subcontractorInvoices.id}
      ), 0)::text`,
    })
    .from(subcontractorInvoices)
    .where(scope === null ? undefined : eq(subcontractorInvoices.subcontractorId, scope))
    .orderBy(desc(subcontractorInvoices.createdAt))
    .limit(200)
  return rows.map(({ invoice, paidAmount }) => ({
    id: invoice.id,
    workOrderId: invoice.workOrderId,
    subcontractorId: invoice.subcontractorId,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    status: invoice.status,
    totalAmount: invoice.totalAmount,
    paidAmount,
    rejectionReason: invoice.rejectionReason,
    version: invoice.version,
    createdAt: invoice.createdAt.toISOString(),
  }))
}

export async function getSubcontractorInvoiceDetail(
  session: AuthSessionView,
  invoiceId: number,
  executor: Executor,
) {
  assertSubcontractorInvoiceRead(session)
  const invoice = await loadSubcontractorInvoice(session, invoiceId, executor)
  const [lines, payments, workOrderRows] = await Promise.all([
    executor
      .select()
      .from(subcontractorInvoiceLines)
      .where(eq(subcontractorInvoiceLines.invoiceId, invoice.id))
      .orderBy(asc(subcontractorInvoiceLines.position)),
    executor
      .select()
      .from(subcontractorInvoicePayments)
      .where(eq(subcontractorInvoicePayments.invoiceId, invoice.id))
      .orderBy(desc(subcontractorInvoicePayments.paidOn)),
    executor
      .select({ id: workOrders.id })
      .from(workOrders)
      .where(eq(workOrders.id, invoice.workOrderId))
      .limit(1),
  ])
  const paidAmount = money(
    payments.reduce((sum, payment) => sum + Number(payment.amount), 0).toFixed(2),
  )
  return {
    invoice: { ...invoice, workOrderNumber: workOrderRows[0]?.id ?? null },
    lines,
    payments,
    paidAmount,
    balanceDue: money((Number(invoice.totalAmount) - Number(paidAmount)).toFixed(2)),
  }
}
