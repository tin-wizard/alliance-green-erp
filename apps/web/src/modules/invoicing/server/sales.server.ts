/**
 * Sales-invoice lifecycle.
 *
 * SERVER ONLY. The Work Orders snapshot seeds the first invoice. Every save
 * replaces the line set wholesale and stores the posted totals without
 * recalculating them (A5, B1). Issue queues Sage and renders the PDF; rejection
 * records the reason and returns the invoice to draft only while no final
 * posting exists (B3).
 */
import { asc, desc, eq, sql } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import type { Executor, Tx } from '@cls/db'
import {
  invoiceLabourLines,
  invoicePartLines,
  invoicePayments,
  invoiceSpecialPartLines,
  rejectedInvoices,
  salesInvoices,
} from '@cls/db/schema'
import { format, parseDecimal, round, LEGACY_PART_PLACEHOLDER, LEGACY_PART_PLACEHOLDER_MESSAGE } from '@cls/pricing'
import type { AuthSessionView } from '../../../server/auth.types'
import { buildInvoiceReadySnapshot } from '../../work-orders/server/snapshot.server'
import {
  assertInvoiceMutable,
  assertSalesInvoiceIssue,
  assertSalesInvoiceWrite,
  invoiceImmutabilityState,
  loadSalesInvoice,
} from './access.server'
import {
  canEditInvoice,
  canIssueInvoice,
  canRecordPayment,
  canRejectInvoice,
  paymentStatus,
  type SalesInvoiceStatus,
} from '../lib/lifecycle'
import { lineAmount } from '../lib/money'
import { invoiceContentForRejection } from './get.server'
import { auditInvoice } from './records.server'
import { cancelSalesPostingCore, queueSalesInvoicePostingCore } from './posting.server'

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

export interface CreateInvoiceResult {
  invoiceId: number
  version: number
  invoiceNumber: string
  existing: boolean
}

export async function createInvoiceFromSnapshotCore(
  tx: Tx,
  input: { workOrderId: number },
  session: AuthSessionView,
): Promise<CreateInvoiceResult> {
  assertSalesInvoiceWrite(session)

  const [existing] = await tx
    .select()
    .from(salesInvoices)
    .where(eq(salesInvoices.workOrderId, input.workOrderId))
    .limit(1)
  if (existing) {
    return {
      invoiceId: existing.id,
      version: existing.version,
      invoiceNumber: existing.invoiceNumber,
      existing: true,
    }
  }

  const snapshot = await buildInvoiceReadySnapshot(session, input.workOrderId, tx)
  if (!snapshot.totals) {
    throw new ValidationError(
      snapshot.calculationError ??
        'The invoice snapshot does not include totals. invoice.calculate is required.',
    )
  }

  const invoiceNumber = `INV-${snapshot.workOrderId}`
  const [invoice] = await tx
    .insert(salesInvoices)
    .values({
      workOrderId: snapshot.workOrderId,
      workOrderNumber: snapshot.workOrderNumber,
      invoiceNumber,
      customerId: snapshot.customerId,
      siteId: snapshot.siteId,
      calcType: snapshot.calcType,
      status: 'draft',
      invoiceDate: snapshot.completionDate ?? snapshot.workOrderDate ?? today(),
      taxProvince: snapshot.taxProvince,
      appliedTaxRate: snapshot.appliedTaxRate,
      appliedTaxRatePst: snapshot.appliedTaxRatePst,
      labourAmount: snapshot.totals.labour,
      materialAmount: snapshot.totals.material,
      subtotalAmount: snapshot.totals.subtotal,
      taxAmount: snapshot.totals.tax,
      totalAmount: snapshot.totals.total,
      manualTaxAmount: snapshot.manualTaxAmount,
      manualSubtotalAmount: snapshot.manualSubtotalAmount,
      legacyCentCorrectionApplied: snapshot.legacyCentCorrectionApplied,
      createdBy: session.user.id,
    })
    .returning()
  if (!invoice) throw new ValidationError('The invoice could not be created.')

  let position = 1
  if (snapshot.labour.length > 0) {
    await tx.insert(invoiceLabourLines).values(
      snapshot.labour.map((line) => ({
        invoiceId: invoice.id,
        position: position++,
        description: `Labour — ${line.date}`,
        lineDate: line.date,
        hours: line.hours,
        rateCode: line.rateCode,
        hourlyRate: line.hourlyRate,
        qty: line.hours,
        price: line.hourlyRate,
        amount: line.amount,
      })),
    )
  }
  if (snapshot.parts.length > 0) {
    await tx.insert(invoicePartLines).values(
      snapshot.parts.map((line) => ({
        invoiceId: invoice.id,
        position: position++,
        partNo: line.partNo,
        description: line.description,
        qty: line.qty,
        price: line.price,
        amount: line.amount,
      })),
    )
  }
  if (snapshot.specialParts.length > 0) {
    await tx.insert(invoiceSpecialPartLines).values(
      snapshot.specialParts.map((line) => ({
        invoiceId: invoice.id,
        position: position++,
        name: line.name,
        qty: line.qty,
        price: line.price,
        amount: line.amount,
      })),
    )
  }

  await auditInvoice(tx, session, 'invoice.create', invoice.id, {
    summary: `Created invoice ${invoiceNumber} from work order ${snapshot.workOrderId}.`,
    after: { invoiceNumber, workOrderId: snapshot.workOrderId, total: snapshot.totals.total },
  })
  return { invoiceId: invoice.id, version: invoice.version, invoiceNumber, existing: false }
}

export interface SaveInvoiceInput {
  invoiceId: number
  version: number
  invoiceDate?: string
  dueDate?: string | null
  notes?: string | null
  taxProvince: string
  appliedTaxRate?: string | null
  appliedTaxRatePst?: string | null
  manualTaxAmount?: string | null
  manualSubtotalAmount?: string | null
  labour: Array<{
    date: string
    hours: string
    rateCode: number
    hourlyRate: string
    description?: string | null
  }>
  parts: Array<{
    partNo: string
    description?: string | null
    qty: string
    price: string
    isLocalPart: boolean
  }>
  specialParts: Array<{
    name: string
    qty: string
    price: string
    isEmergencyLighting: boolean
    isLocalPart: boolean
    warrantyYears?: string | null
    laborWarrantyYears?: string | null
  }>
  totals: { labour: string; material: string; subtotal: string; tax: string; total: string }
}

export async function saveInvoiceDraftCore(
  tx: Tx,
  input: SaveInvoiceInput,
  session: AuthSessionView,
): Promise<{ invoiceId: number; version: number; status: SalesInvoiceStatus }> {
  assertSalesInvoiceWrite(session)
  const invoice = await loadSalesInvoice(session, input.invoiceId, tx, {
    forUpdate: true,
    tx,
  })
  const status = invoice.status as SalesInvoiceStatus
  await assertInvoiceMutable(invoice, tx)
  if (!canEditInvoice(status, false)) {
    throw new ValidationError('This invoice can no longer be edited.')
  }
  if (invoice.version !== input.version) {
    throw new ValidationError('This invoice changed since it was loaded. Reload and retry.')
  }
  if (input.labour.length === 0) {
    throw new ValidationError('Enter labour before saving an invoice.')
  }
  if (input.parts.some((line) => line.partNo.trim() === LEGACY_PART_PLACEHOLDER)) {
    throw new ValidationError(LEGACY_PART_PLACEHOLDER_MESSAGE)
  }

  await tx.delete(invoiceLabourLines).where(eq(invoiceLabourLines.invoiceId, invoice.id))
  await tx.delete(invoicePartLines).where(eq(invoicePartLines.invoiceId, invoice.id))
  await tx.delete(invoiceSpecialPartLines).where(eq(invoiceSpecialPartLines.invoiceId, invoice.id))

  let position = 1
  await tx.insert(invoiceLabourLines).values(
    input.labour.map((line) => ({
      invoiceId: invoice.id,
      position: position++,
      description: line.description?.trim() || `Labour — ${line.date}`,
      lineDate: line.date,
      hours: line.hours,
      rateCode: line.rateCode,
      hourlyRate: line.hourlyRate,
      qty: line.hours,
      price: line.hourlyRate,
      amount: lineAmount(line.hours, line.hourlyRate),
    })),
  )
  if (input.parts.length > 0) {
    await tx.insert(invoicePartLines).values(
      input.parts.map((line) => ({
        invoiceId: invoice.id,
        position: position++,
        partNo: line.partNo,
        description: line.description,
        qty: line.qty,
        price: line.price,
        amount: lineAmount(line.qty, line.price),
        isLocalPart: line.isLocalPart,
      })),
    )
  }
  if (input.specialParts.length > 0) {
    await tx.insert(invoiceSpecialPartLines).values(
      input.specialParts.map((line) => ({
        invoiceId: invoice.id,
        position: position++,
        name: line.name,
        qty: line.qty,
        price: line.price,
        amount: lineAmount(line.qty, line.price),
        isEmergencyLighting: line.isEmergencyLighting,
        isLocalPart: line.isLocalPart,
        warrantyYears: line.warrantyYears ?? null,
        laborWarrantyYears: line.laborWarrantyYears ?? null,
      })),
    )
  }

  const nextStatus = status === 'rejected' ? 'draft' : status
  const [updated] = await tx
    .update(salesInvoices)
    .set({
      invoiceDate: input.invoiceDate ?? invoice.invoiceDate,
      dueDate: input.dueDate ?? null,
      notes: input.notes ?? null,
      taxProvince: input.taxProvince,
      appliedTaxRate: input.appliedTaxRate ?? null,
      appliedTaxRatePst: input.appliedTaxRatePst ?? null,
      labourAmount: money(input.totals.labour),
      materialAmount: money(input.totals.material),
      subtotalAmount: money(input.totals.subtotal),
      taxAmount: money(input.totals.tax),
      totalAmount: money(input.totals.total),
      manualTaxAmount: input.manualTaxAmount ? money(input.manualTaxAmount) : null,
      manualSubtotalAmount: input.manualSubtotalAmount ? money(input.manualSubtotalAmount) : null,
      legacyCentCorrectionApplied: false,
      status: nextStatus,
      version: sql`${salesInvoices.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(salesInvoices.id, invoice.id))
    .returning()
  if (!updated) throw new ValidationError('The invoice could not be saved.')

  await auditInvoice(tx, session, 'invoice.save', invoice.id, {
    summary: `Saved invoice ${invoice.invoiceNumber} from a replacement snapshot.`,
    before: { total: invoice.totalAmount, version: invoice.version },
    after: {
      total: updated.totalAmount,
      version: updated.version,
      lines: input.labour.length + input.parts.length + input.specialParts.length,
    },
  })
  return { invoiceId: updated.id, version: updated.version, status: nextStatus as SalesInvoiceStatus }
}

export async function issueInvoiceCore(
  tx: Tx,
  input: { invoiceId: number; version: number },
  session: AuthSessionView,
): Promise<{ invoiceId: number; version: number; status: SalesInvoiceStatus; documentId: string; sha256: string }> {
  assertSalesInvoiceIssue(session)
  const invoice = await loadSalesInvoice(session, input.invoiceId, tx, {
    forUpdate: true,
    tx,
  })
  const status = invoice.status as SalesInvoiceStatus
  const immutable = await invoiceImmutabilityState(invoice, tx)
  if (!canIssueInvoice(status, immutable.immutable)) {
    throw new ValidationError(
      immutable.immutable
        ? `The invoice can not be issued. ${immutable.reason ?? ''}`.trim()
        : 'Only a draft invoice can be issued.',
    )
  }
  if (invoice.version !== input.version) {
    throw new ValidationError('This invoice changed since it was loaded. Reload and retry.')
  }
  const [labour] = await tx
    .select({ id: invoiceLabourLines.id })
    .from(invoiceLabourLines)
    .where(eq(invoiceLabourLines.invoiceId, invoice.id))
    .limit(1)
  if (!labour) throw new ValidationError('Enter labour before issuing an invoice.')

  const issuedOn = today()
  const [updated] = await tx
    .update(salesInvoices)
    .set({
      status: 'issued',
      issuedOn,
      issuedAt: new Date(),
      invoiceDate: invoice.invoiceDate || issuedOn,
      version: sql`${salesInvoices.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(salesInvoices.id, invoice.id))
    .returning()
  if (!updated) throw new ValidationError('The invoice could not be issued.')

  await queueSalesInvoicePostingCore(tx, invoice.id, session)

  const { renderInvoicePdfCore } = await import('./pdf.server')
  const pdf = await renderInvoicePdfCore(tx, invoice.id, session)

  await auditInvoice(tx, session, 'invoice.issue', invoice.id, {
    summary: `Issued invoice ${invoice.invoiceNumber} for ${invoice.totalAmount}.`,
    permission: 'invoice:issue',
    before: { status, version: invoice.version },
    after: { status: 'issued', version: updated.version, documentId: pdf.documentId },
  })
  return {
    invoiceId: updated.id,
    version: updated.version,
    status: 'issued',
    documentId: pdf.documentId,
    sha256: pdf.sha256,
  }
}

export async function rejectInvoiceCore(
  tx: Tx,
  input: { invoiceId: number; reason: string; rejectedByDetail?: string | null },
  session: AuthSessionView,
): Promise<{ invoiceId: number; status: SalesInvoiceStatus; rejectionId: number }> {
  assertSalesInvoiceIssue(session)
  const invoice = await loadSalesInvoice(session, input.invoiceId, tx, {
    forUpdate: true,
    tx,
  })
  const status = invoice.status as SalesInvoiceStatus
  const [paid] = await tx
    .select({ total: sql<string>`coalesce(sum(${invoicePayments.amount}), 0)::text` })
    .from(invoicePayments)
    .where(eq(invoicePayments.invoiceId, invoice.id))
  const paidAmount = money(paid?.total ?? '0')
  if (!canRejectInvoice(status, paidAmount)) {
    throw new ValidationError('Only an issued, unpaid invoice can be rejected.')
  }
  const immutable = await invoiceImmutabilityState(invoice, tx)
  if (immutable.immutable) {
    throw new ValidationError(
      `The invoice can not be rejected. ${immutable.reason ?? ''}`.trim(),
    )
  }
  const content = await invoiceContentForRejection(invoice.id, tx)
  const [rejection] = await tx
    .insert(rejectedInvoices)
    .values({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      reason: input.reason,
      rejectedByDetail: input.rejectedByDetail ?? null,
      invoiceContent: content as unknown as Record<string, unknown>,
    })
    .returning()
  if (!rejection) throw new ValidationError('The rejection could not be recorded.')

  await tx
    .update(salesInvoices)
    .set({
      status: 'rejected',
      lastRejectedAt: new Date(),
      version: sql`${salesInvoices.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(salesInvoices.id, invoice.id))
  await cancelSalesPostingCore(tx, invoice.id)
  await auditInvoice(tx, session, 'invoice.reject', invoice.id, {
    summary: `Rejected invoice ${invoice.invoiceNumber}: ${input.reason}`,
    permission: 'invoice:issue',
    before: { status, version: invoice.version },
    after: { status: 'rejected', rejectionId: rejection.id },
  })
  return { invoiceId: invoice.id, status: 'rejected', rejectionId: rejection.id }
}

export async function resubmitInvoiceCore(
  tx: Tx,
  input: { invoiceId: number },
  session: AuthSessionView,
): Promise<{ invoiceId: number; status: SalesInvoiceStatus; version: number }> {
  assertSalesInvoiceWrite(session)
  const invoice = await loadSalesInvoice(session, input.invoiceId, tx, {
    forUpdate: true,
    tx,
  })
  if (invoice.status !== 'rejected') {
    throw new ValidationError('Only a rejected invoice can be resubmitted.')
  }
  await assertInvoiceMutable(invoice, tx)
  const [updated] = await tx
    .update(salesInvoices)
    .set({
      status: 'draft',
      version: sql`${salesInvoices.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(salesInvoices.id, invoice.id))
    .returning()
  if (!updated) throw new ValidationError('The invoice could not be resubmitted.')

  const [latest] = await tx
    .select()
    .from(rejectedInvoices)
    .where(eq(rejectedInvoices.invoiceId, invoice.id))
    .orderBy(desc(rejectedInvoices.rejectedAt))
    .limit(1)
  if (latest && !latest.resubmittedAt) {
    await tx
      .update(rejectedInvoices)
      .set({ resubmittedAt: new Date() })
      .where(eq(rejectedInvoices.id, latest.id))
  }
  await auditInvoice(tx, session, 'invoice.resubmit', invoice.id, {
    summary: `Resubmitted invoice ${invoice.invoiceNumber} for a new snapshot.`,
    before: { status: 'rejected', version: invoice.version },
    after: { status: 'draft', version: updated.version },
  })
  return { invoiceId: updated.id, status: 'draft', version: updated.version }
}

export async function recordInvoicePaymentCore(
  tx: Tx,
  input: {
    invoiceId: number
    amount: string
    paidOn?: string
    method?: string | null
    reference?: string | null
    notes?: string | null
    idempotencyKey: string
  },
  session: AuthSessionView,
): Promise<{
  paymentId: number
  status: SalesInvoiceStatus
  paidAmount: string
  replay: boolean
}> {
  assertSalesInvoiceIssue(session)
  const invoice = await loadSalesInvoice(session, input.invoiceId, tx, {
    forUpdate: true,
    tx,
  })
  if (!canRecordPayment(invoice.status as SalesInvoiceStatus)) {
    throw new ValidationError('Payments can only be recorded against an issued invoice.')
  }
  const amount = money(input.amount)
  if (Number(amount) <= 0) throw new ValidationError('Payment must be greater than zero.')

  const [payment] = await tx
    .insert(invoicePayments)
    .values({
      invoiceId: invoice.id,
      amount,
      paidOn: input.paidOn ?? today(),
      method: input.method ?? null,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      idempotencyKey: input.idempotencyKey,
      recordedBy: session.user.id,
    })
    .onConflictDoNothing({ target: invoicePayments.idempotencyKey })
    .returning()
  if (!payment) {
    const [existing] = await tx
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.idempotencyKey, input.idempotencyKey))
      .limit(1)
    const [paid] = await tx
      .select({ total: sql<string>`coalesce(sum(${invoicePayments.amount}), 0)::text` })
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, invoice.id))
    return {
      paymentId: existing!.id,
      status: invoice.status as SalesInvoiceStatus,
      paidAmount: money(paid?.total ?? '0'),
      replay: true,
    }
  }

  const [paid] = await tx
    .select({ total: sql<string>`coalesce(sum(${invoicePayments.amount}), 0)::text` })
    .from(invoicePayments)
    .where(eq(invoicePayments.invoiceId, invoice.id))
  const paidAmount = money(paid?.total ?? '0')
  const status = paymentStatus(invoice.totalAmount, paidAmount)
  await tx
    .update(salesInvoices)
    .set({ status, version: sql`${salesInvoices.version} + 1`, updatedAt: new Date() })
    .where(eq(salesInvoices.id, invoice.id))
  await auditInvoice(tx, session, 'invoice.payment', invoice.id, {
    summary: `Recorded payment ${amount} against invoice ${invoice.invoiceNumber}.`,
    permission: 'invoice:issue',
    after: { paymentId: payment.id, paidAmount, status },
  })
  return { paymentId: payment.id, status, paidAmount, replay: false }
}

/** Exposed for the list badge; no writes. */
export async function invoiceCounts(executor: Executor) {
  const rows = await executor
    .select({ status: salesInvoices.status, count: sql<number>`count(*)::int` })
    .from(salesInvoices)
    .groupBy(salesInvoices.status)
  return Object.fromEntries(rows.map((row) => [row.status, row.count]))
}

export async function invoiceLinesForPdf(invoiceId: number, executor: Executor) {
  const [labour, parts, specialParts] = await Promise.all([
    executor
      .select()
      .from(invoiceLabourLines)
      .where(eq(invoiceLabourLines.invoiceId, invoiceId))
      .orderBy(asc(invoiceLabourLines.position)),
    executor
      .select()
      .from(invoicePartLines)
      .where(eq(invoicePartLines.invoiceId, invoiceId))
      .orderBy(asc(invoicePartLines.position)),
    executor
      .select()
      .from(invoiceSpecialPartLines)
      .where(eq(invoiceSpecialPartLines.invoiceId, invoiceId))
      .orderBy(asc(invoiceSpecialPartLines.position)),
  ])
  return { labour, parts, specialParts }
}
