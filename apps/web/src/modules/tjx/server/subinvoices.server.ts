/**
 * TJX subcontractor invoices: drafts, gates, rates and the Invoicing handoff.
 *
 * SERVER ONLY. Rates, totals and tax are resolved here from the quote snapshot;
 * the client only supplies installed quantities, header fields and document
 * links. Final submit consumes Invoicing's exported cores and never writes its
 * tables directly.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { ForbiddenError, NotFoundError, ValidationError } from '@cls/core'
import type { Executor, Tx } from '@cls/db'
import {
  parts,
  subcontractorInvoices,
  tjxQuoteFixtureParts,
  tjxQuoteFixtures,
  tjxQuoteParts,
  tjxQuoteRooms,
  tjxQuoteWorkOrders,
  tjxQuotes,
  tjxSubInvoiceDocuments,
  tjxSubInvoiceFixtures,
  tjxSubInvoiceParts,
  tjxSubInvoiceRevisions,
  tjxSubInvoiceSubmissions,
  tjxSubInvoices,
  tjxSubcontractorRates,
  workOrderDocuments,
  workOrders,
} from '@cls/db/schema'
import {
  add,
  calculateSubcontractorPurchaseTotals,
  compare,
  format,
  multiply,
  parseDecimal,
  purchaseTaxRate,
  round,
  type Decimal,
} from '@cls/pricing'
import type { AuthSessionView } from '../../../server/auth.types'
import type {
  TjxAssignedTjxWorkOrderRow,
  TjxGateKind,
  TjxSubInvoiceDetail,
  TjxSubInvoiceListRow,
  TjxSubInvoiceSaveInput,
  TjxSubInvoiceStatus,
} from '../types'
import { assertTjxRead, auditTjx } from './access.server'
import { approveSubcontractorInvoiceCore, createSubcontractorInvoiceCore, rejectSubcontractorInvoiceCore } from '../../invoicing/server/subcontractor.server'
import { transitionWorkOrderCore } from '../../work-orders/server/transition.server'

const GATE_KINDS: readonly TjxGateKind[] = [
  'post_project_fc_reading',
  'post_project_photos',
  'signed_work_order',
]

const GATE_LABEL: Record<TjxGateKind, string> = {
  post_project_fc_reading: 'Post-project foot-candle readings',
  post_project_photos: 'Post-project photos',
  signed_work_order: 'Signed work order',
}

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function zero(): string {
  return '0.00'
}

function statusOf(row: {
  isSubmitted: boolean
  approvedAt: Date | null
  rejectedAt: Date | null
}): TjxSubInvoiceStatus {
  if (row.approvedAt) return 'approved'
  if (row.isSubmitted) return 'submitted'
  if (row.rejectedAt) return 'rejected'
  return 'draft'
}

function isSubcontractor(session: AuthSessionView): boolean {
  return session.user.role === 'subcontractor' && Boolean(session.user.subcontractorId)
}

function requireSubcontractor(session: AuthSessionView): number {
  if (!isSubcontractor(session)) {
    throw new ForbiddenError('Only the assigned subcontractor can work on this invoice.')
  }
  return session.user.subcontractorId!
}

function assertOfficeRead(session: AuthSessionView): void {
  assertTjxRead(session)
}

function assertOfficeWrite(session: AuthSessionView): void {
  if (!session.user.grants.some((grant) => grant.key === 'invoice:write')) {
    throw new ForbiddenError('invoice:write')
  }
}

function ceilInteger(value: Decimal): Decimal {
  if (value.scale === 0) return value
  const factor = 10n ** BigInt(value.scale)
  const whole = value.value / factor
  const remainder = value.value % factor
  return { value: remainder > 0n ? whole + 1n : whole, scale: 0 }
}

interface InvoiceContext {
  workOrder: typeof workOrders.$inferSelect
  quote: typeof tjxQuotes.$inferSelect
}

async function loadContext(
  tx: Tx,
  workOrderId: number,
  session: AuthSessionView,
): Promise<InvoiceContext> {
  const [workOrder] = await tx
    .select()
    .from(workOrders)
    .where(eq(workOrders.id, workOrderId))
    .limit(1)
  if (!workOrder) throw new NotFoundError('Work order')
  if (!workOrder.isTjxQuote) throw new ValidationError('That work order is not a TJX work order.')

  if (isSubcontractor(session)) {
    if (workOrder.subcontractorId !== session.user.subcontractorId) {
      throw new NotFoundError('That work order is not assigned to you.')
    }
  } else {
    assertOfficeRead(session)
  }

  const [link] = await tx
    .select()
    .from(tjxQuoteWorkOrders)
    .where(
      and(eq(tjxQuoteWorkOrders.workOrderId, workOrderId), eq(tjxQuoteWorkOrders.isPrimary, true)),
    )
    .limit(1)
  if (!link) throw new ValidationError('This work order has no primary TJX quote.')
  const [quote] = await tx.select().from(tjxQuotes).where(eq(tjxQuotes.id, link.quoteId)).limit(1)
  if (!quote) throw new NotFoundError('TJX quote')
  if (quote.status !== 4) throw new ValidationError('Only an approved TJX quote can be invoiced.')
  return { workOrder, quote }
}

async function loadRow(tx: Tx, workOrderId: number, session: AuthSessionView) {
  const context = await loadContext(tx, workOrderId, session)
  const [row] = await tx
    .select()
    .from(tjxSubInvoices)
    .where(eq(tjxSubInvoices.workOrderId, workOrderId))
    .orderBy(desc(tjxSubInvoices.id))
    .limit(1)
  if (!row) throw new NotFoundError('TJX invoice')
  return { ...context, row }
}

async function loadRowForUpdate(tx: Tx, workOrderId: number, session: AuthSessionView) {
  const context = await loadContext(tx, workOrderId, session)
  const [row] = await tx
    .select()
    .from(tjxSubInvoices)
    .where(eq(tjxSubInvoices.workOrderId, workOrderId))
    .orderBy(desc(tjxSubInvoices.id))
    .limit(1)
    .for('update')
  if (!row) throw new NotFoundError('TJX invoice')
  return { ...context, row }
}

function assertOwner(row: typeof tjxSubInvoices.$inferSelect, session: AuthSessionView): void {
  if (!isSubcontractor(session) || row.subcontractorId !== session.user.subcontractorId) {
    throw new ForbiddenError('Only the assigned subcontractor can change this invoice.')
  }
}

function assertEditable(row: typeof tjxSubInvoices.$inferSelect): void {
  if (row.isSubmitted || row.approvedAt) {
    throw new ValidationError('This invoice has been submitted and cannot be edited.')
  }
}

interface ExpandedPart {
  partNo: string
  description: string | null
  quantity: string
  unitRate: string
  lineSubtotal: string
  rateSource: 'quoted_part' | 'fixture_part'
  missing: boolean
}

async function expandParts(
  tx: Tx,
  quoteId: number,
  subcontractorId: number,
  fixtures: { quoteFixtureId: number | null; installedQuantity: string }[],
): Promise<ExpandedPart[]> {
  const fixtureIds = fixtures
    .map((fixture) => fixture.quoteFixtureId)
    .filter((id): id is number => typeof id === 'number')
  if (fixtureIds.length === 0) return []

  const partRows = await tx
    .select()
    .from(tjxQuoteFixtureParts)
    .where(inArray(tjxQuoteFixtureParts.quoteFixtureId, fixtureIds))
  const byFixture = new Map<number, typeof partRows>()
  for (const row of partRows) {
    const list = byFixture.get(row.quoteFixtureId) ?? []
    list.push(row)
    byFixture.set(row.quoteFixtureId, list)
  }

  const totals = new Map<string, Decimal>()
  for (const fixture of fixtures) {
    if (!fixture.quoteFixtureId) continue
    const installed = parseDecimal(fixture.installedQuantity) ?? { value: 0n, scale: 0 }
    if (compare(installed, { value: 0n, scale: 0 }) <= 0) continue
    for (const part of byFixture.get(fixture.quoteFixtureId) ?? []) {
      const markup = parseDecimal(part.markup) ?? { value: 0n, scale: 0 }
      const ratio = parseDecimal(part.ratioPerFixture) ?? { value: 0n, scale: 0 }
      const raw =
        part.partNo.toUpperCase() === 'WIN-150'
          ? multiply(multiply(installed, markup), ratio)
          : multiply(ceilInteger(installed), ratio)
      const rounded = round(raw, 3)
      totals.set(part.partNo, add(totals.get(part.partNo) ?? { value: 0n, scale: 3 }, rounded))
    }
  }

  const partNos = [...totals.keys()].sort()
  if (partNos.length === 0) return []

  const [quoteParts, rateRows, masterRows] = await Promise.all([
    tx
      .select({ partNo: tjxQuoteParts.partNo, description: tjxQuoteParts.description })
      .from(tjxQuoteParts)
      .where(and(eq(tjxQuoteParts.quoteId, quoteId), inArray(tjxQuoteParts.partNo, partNos))),
    tx
      .select()
      .from(tjxSubcontractorRates)
      .where(
        and(
          eq(tjxSubcontractorRates.subcontractorId, subcontractorId),
          inArray(tjxSubcontractorRates.partNo, partNos),
        ),
      ),
    tx
      .select({ partNumber: parts.partNumber, name: parts.name })
      .from(parts)
      .where(inArray(parts.partNumber, partNos)),
  ])
  const quotePartSet = new Set(quoteParts.map((row) => row.partNo))
  const description = new Map<string, string | null>()
  for (const row of masterRows) description.set(row.partNumber, row.name)
  for (const row of quoteParts) if (row.description) description.set(row.partNo, row.description)
  const rates = new Map(rateRows.map((row) => [row.partNo, row.installCostPerUnit]))

  return partNos.map((partNo) => {
    const quantity = format(totals.get(partNo)!, 3)
    const rate = rates.get(partNo)
    const unitRate = rate ? format(parseDecimal(rate)!, 2) : zero()
    const lineSubtotal = rate
      ? format(round(multiply(parseDecimal(quantity)!, parseDecimal(rate)!), 2), 2)
      : zero()
    return {
      partNo,
      description: description.get(partNo) ?? null,
      quantity,
      unitRate,
      lineSubtotal,
      rateSource: quotePartSet.has(partNo) ? 'quoted_part' : 'fixture_part',
      missing: !rate,
    }
  })
}

function computeTotals(input: {
  taxProvince: string
  invoiceDate: string
  parts: { quantity: string; unitRate: string }[]
}): {
  subtotal: string
  tax: string
  taxGst: string
  taxPst: string
  total: string
  rate: string
} {
  const totals = calculateSubcontractorPurchaseTotals({
    taxProvince: input.taxProvince,
    invoiceDate: input.invoiceDate,
    labour: [],
    parts: input.parts.map((part) => ({ qty: part.quantity, price: part.unitRate })),
  })
  const rate = purchaseTaxRate(input.taxProvince, input.invoiceDate)
  if (!totals) {
    return {
      subtotal: zero(),
      tax: zero(),
      taxGst: zero(),
      taxPst: zero(),
      total: zero(),
      rate: format(rate.rate, 5).replace(/0+$/, '').replace(/\.$/, ''),
    }
  }
  const subtotal = parseDecimal(totals.subtotal)!
  const tax = parseDecimal(totals.tax)!
  const gst: Decimal = rate.pst
    ? round(multiply(subtotal, rate.rate), 2)
    : tax
  return {
    subtotal: totals.subtotal,
    tax: totals.tax,
    taxGst: format(gst, 2),
    taxPst: format(round({ value: tax.value - gst.value, scale: tax.scale }, 2), 2),
    total: totals.total,
    rate: totals.taxRate,
  }
}

async function replaceFixtureParts(
  tx: Tx,
  input: {
    quoteId: number
    subcontractorId: number
    rowId: number
    fixtures: TjxSubInvoiceSaveInput['fixtures']
    invoiceDate: string
    taxProvince: string
  },
): Promise<{ missingRates: string[]; totals: ReturnType<typeof computeTotals> }> {
  const quoteFixtureIds = input.fixtures
    .map((fixture) => fixture.quoteFixtureId)
    .filter((id): id is number => typeof id === 'number')
  if (quoteFixtureIds.length > 0) {
    const valid = await tx
      .select({ id: tjxQuoteFixtures.id })
      .from(tjxQuoteFixtures)
      .where(and(eq(tjxQuoteFixtures.quoteId, input.quoteId), inArray(tjxQuoteFixtures.id, quoteFixtureIds)))
    const validIds = new Set(valid.map((row) => row.id))
    for (const fixture of input.fixtures) {
      if (fixture.quoteFixtureId && !validIds.has(fixture.quoteFixtureId)) {
        throw new ValidationError('A fixture does not belong to this quote.')
      }
    }
  }

  await tx.delete(tjxSubInvoiceFixtures).where(eq(tjxSubInvoiceFixtures.subInvoiceId, input.rowId))
  if (input.fixtures.length > 0) {
    await tx.insert(tjxSubInvoiceFixtures).values(
      input.fixtures.map((fixture, index) => ({
        subInvoiceId: input.rowId,
        quoteFixtureId: fixture.quoteFixtureId,
        roomName: fixture.roomName,
        fixtureName: fixture.fixtureName,
        quotedQuantity: fixture.quotedQuantity,
        installedQuantity: fixture.installedQuantity,
        discrepancyNotes: fixture.discrepancyNotes,
        sortOrder: index,
      })),
    )
  }

  const expanded = await expandParts(
    tx,
    input.quoteId,
    input.subcontractorId,
    input.fixtures,
  )
  await tx.delete(tjxSubInvoiceParts).where(eq(tjxSubInvoiceParts.subInvoiceId, input.rowId))
  if (expanded.length > 0) {
    await tx.insert(tjxSubInvoiceParts).values(
      expanded.map((part, index) => ({
        subInvoiceId: input.rowId,
        quotePartId: null,
        partNo: part.partNo,
        description: part.description,
        quantity: part.quantity,
        unitRate: part.unitRate,
        lineSubtotal: part.lineSubtotal,
        rateSource: part.rateSource,
        sortOrder: index,
      })),
    )
  }
  return {
    missingRates: expanded.filter((part) => part.missing).map((part) => part.partNo),
    totals: computeTotals({
      taxProvince: input.taxProvince,
      invoiceDate: input.invoiceDate,
      parts: expanded,
    }),
  }
}

async function writeRevision(
  tx: Tx,
  input: {
    subInvoiceId: number
    revisionNo: number
    revisionType: 'insert' | 'update' | 'submit' | 'reject' | 'approve'
    session: AuthSessionView
  },
): Promise<void> {
  const [row] = await tx
    .select()
    .from(tjxSubInvoices)
    .where(eq(tjxSubInvoices.id, input.subInvoiceId))
  if (!row) return
  const [fixtures, partRows] = await Promise.all([
    tx.select().from(tjxSubInvoiceFixtures).where(eq(tjxSubInvoiceFixtures.subInvoiceId, row.id)),
    tx.select().from(tjxSubInvoiceParts).where(eq(tjxSubInvoiceParts.subInvoiceId, row.id)),
  ])
  await tx.insert(tjxSubInvoiceRevisions).values({
    subInvoiceId: row.id,
    revisionNo: input.revisionNo,
    revisionType: input.revisionType,
    revisedBy: input.session.user.id,
    dataInvoice: {
      invoiceNumber: row.invoiceNumber,
      invoiceDate: row.invoiceDate,
      taxProvince: row.taxProvince,
      appliedTaxRate: row.appliedTaxRate,
      subtotal: row.subtotalAmount,
      tax: row.taxAmount,
      total: row.totalAmount,
      gates: {
        reading: row.chkProjectReading,
        photos: row.chkProjectPhotos,
        signoff: row.chkProjectSignoff,
      },
    },
    dataFixtures: fixtures.map((fixture) => ({ ...fixture })),
    dataParts: partRows.map((part) => ({ ...part })),
  })
}

async function detail(tx: Tx, workOrderId: number, session: AuthSessionView): Promise<TjxSubInvoiceDetail> {
  const { quote, row } = await loadRow(tx, workOrderId, session)
  const [fixtures, partRows, documentRows, submissions, revisions] = await Promise.all([
    tx
      .select()
      .from(tjxSubInvoiceFixtures)
      .where(eq(tjxSubInvoiceFixtures.subInvoiceId, row.id))
      .orderBy(asc(tjxSubInvoiceFixtures.sortOrder)),
    tx
      .select()
      .from(tjxSubInvoiceParts)
      .where(eq(tjxSubInvoiceParts.subInvoiceId, row.id))
      .orderBy(asc(tjxSubInvoiceParts.sortOrder)),
    tx
      .select({
        documentId: tjxSubInvoiceDocuments.documentId,
        kind: tjxSubInvoiceDocuments.kind,
        createdAt: tjxSubInvoiceDocuments.createdAt,
        filename: workOrderDocuments.filename,
      })
      .from(tjxSubInvoiceDocuments)
      .innerJoin(
        workOrderDocuments,
        eq(tjxSubInvoiceDocuments.documentId, workOrderDocuments.id),
      )
      .where(eq(tjxSubInvoiceDocuments.subInvoiceId, row.id))
      .orderBy(asc(tjxSubInvoiceDocuments.createdAt)),
    tx
      .select()
      .from(tjxSubInvoiceSubmissions)
      .where(eq(tjxSubInvoiceSubmissions.subInvoiceId, row.id))
      .orderBy(desc(tjxSubInvoiceSubmissions.revisionNo)),
    tx
      .select()
      .from(tjxSubInvoiceRevisions)
      .where(eq(tjxSubInvoiceRevisions.subInvoiceId, row.id))
      .orderBy(desc(tjxSubInvoiceRevisions.id))
      .limit(20),
  ])
  const missingRates = partRows
    .filter((part) => compare(parseDecimal(part.unitRate)!, { value: 0n, scale: 0 }) <= 0)
    .map((part) => part.partNo)
  return {
    id: row.id,
    quoteId: quote.id,
    quoteNumber: quote.legacyId ?? quote.id,
    workOrderId: row.workOrderId,
    subcontractorId: row.subcontractorId,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    taxProvince: row.taxProvince ?? '',
    appliedTaxRate: row.appliedTaxRate,
    notes: row.notes,
    subNotes: row.subNotes,
    subtotal: row.subtotalAmount,
    tax: row.taxAmount,
    taxGst: row.taxGst,
    taxPst: row.taxPst,
    total: row.totalAmount,
    chkProjectReading: row.chkProjectReading,
    chkProjectPhotos: row.chkProjectPhotos,
    chkProjectSignoff: row.chkProjectSignoff,
    isSubmitted: row.isSubmitted,
    rejectedCount: row.rejectedCount,
    status: statusOf(row),
    subcontractorInvoiceId: row.subcontractorInvoiceId,
    submittedAt: iso(row.submittedAt),
    approvedAt: iso(row.approvedAt),
    rejectedAt: iso(row.rejectedAt),
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    fixtures,
    parts: partRows.map((part) => ({
      partNo: part.partNo,
      description: part.description,
      quantity: part.quantity,
      unitRate: part.unitRate,
      lineSubtotal: part.lineSubtotal,
      rateSource: part.rateSource,
      sortOrder: part.sortOrder,
    })),
    documents: documentRows.map((document) => ({
      documentId: document.documentId,
      kind: document.kind as TjxGateKind,
      filename: document.filename,
      createdAt: document.createdAt.toISOString(),
    })),
    submissions: submissions.map((submission) => ({
      revisionNo: submission.revisionNo,
      subcontractorInvoiceId: submission.subcontractorInvoiceId,
      submittedAt: submission.submittedAt.toISOString(),
      outcome: submission.outcome,
      rejectionReason: submission.rejectionReason,
    })),
    revisions: revisions.map((revision) => ({
      id: revision.id,
      revisionNo: revision.revisionNo,
      revisionType: revision.revisionType,
      createdAt: revision.createdAt.toISOString(),
    })),
    missingRates,
  }
}

export async function getOrCreateSubInvoiceCore(
  tx: Tx,
  workOrderId: number,
  session: AuthSessionView,
): Promise<TjxSubInvoiceDetail> {
  const { quote, workOrder } = await loadContext(tx, workOrderId, session)
  const [existing] = await tx
    .select()
    .from(tjxSubInvoices)
    .where(eq(tjxSubInvoices.workOrderId, workOrderId))
    .orderBy(desc(tjxSubInvoices.id))
    .limit(1)
  if (existing) return detail(tx, workOrderId, session)

  const subcontractorId = requireSubcontractor(session)
  const [row] = await tx
    .insert(tjxSubInvoices)
    .values({
      quoteId: quote.id,
      workOrderId,
      subcontractorId,
      invoiceNumber: '',
      invoiceDate: today(),
      taxProvince: quote.shipProvince ?? quote.taxProvince ?? 'ON',
      createdBy: session.user.id,
      updatedBy: session.user.id,
    })
    .returning()
  if (!row) throw new ValidationError('The TJX invoice could not be created.')

  const fixtureRows = await tx
    .select({
      id: tjxQuoteFixtures.id,
      fixtureName: tjxQuoteFixtures.fixtureName,
      quantity: tjxQuoteFixtures.quantity,
      sortOrder: tjxQuoteFixtures.sortOrder,
      roomName: tjxQuoteRooms.roomName,
      roomSort: tjxQuoteRooms.sortOrder,
    })
    .from(tjxQuoteFixtures)
    .innerJoin(tjxQuoteRooms, eq(tjxQuoteFixtures.quoteRoomId, tjxQuoteRooms.id))
    .where(eq(tjxQuoteFixtures.quoteId, quote.id))
    .orderBy(asc(tjxQuoteRooms.sortOrder), asc(tjxQuoteFixtures.sortOrder))

  const fixtures = fixtureRows.map((fixture, index) => ({
    quoteFixtureId: fixture.id,
    roomName: fixture.roomName,
    fixtureName: fixture.fixtureName,
    quotedQuantity: fixture.quantity,
    installedQuantity: fixture.quantity,
    discrepancyNotes: null,
    sortOrder: index,
  }))
  const { totals, missingRates } = await replaceFixtureParts(tx, {
    quoteId: quote.id,
    subcontractorId,
    rowId: row.id,
    fixtures,
    invoiceDate: row.invoiceDate,
    taxProvince: row.taxProvince ?? 'ON',
  })
  const [updated] = await tx
    .update(tjxSubInvoices)
    .set({
      subtotalAmount: totals.subtotal,
      taxAmount: totals.tax,
      taxGst: totals.taxGst,
      taxPst: totals.taxPst,
      totalAmount: totals.total,
      appliedTaxRate: totals.rate,
      updatedAt: new Date(),
    })
    .where(eq(tjxSubInvoices.id, row.id))
    .returning()
  await writeRevision(tx, {
    subInvoiceId: row.id,
    revisionNo: 0,
    revisionType: 'insert',
    session,
  })
  await auditTjx(tx, session, 'tjx.sub_invoice.create', 'tjx_sub_invoice', row.id, {
    summary: `Opened the TJX invoice for work order ${workOrder.id}.`,
    after: { workOrderId, missingRates, total: updated?.totalAmount ?? totals.total },
  })
  return detail(tx, workOrderId, session)
}

export async function saveSubInvoiceCore(
  tx: Tx,
  input: TjxSubInvoiceSaveInput,
  session: AuthSessionView,
): Promise<TjxSubInvoiceDetail> {
  const { row } = await loadRowForUpdate(tx, input.workOrderId, session)
  assertOwner(row, session)
  assertEditable(row)
  if (row.version !== input.version) {
    throw new ValidationError('This invoice changed since it was loaded. Reload and retry.')
  }

  const { totals } = await replaceFixtureParts(tx, {
    quoteId: row.quoteId,
    subcontractorId: row.subcontractorId,
    rowId: row.id,
    fixtures: input.fixtures,
    invoiceDate: input.invoiceDate,
    taxProvince: input.taxProvince,
  })
  await tx
    .update(tjxSubInvoices)
    .set({
      invoiceNumber: input.invoiceNumber,
      invoiceDate: input.invoiceDate,
      taxProvince: input.taxProvince,
      appliedTaxRate: totals.rate,
      notes: input.notes,
      subNotes: input.subNotes,
      subtotalAmount: totals.subtotal,
      taxAmount: totals.tax,
      taxGst: totals.taxGst,
      taxPst: totals.taxPst,
      totalAmount: totals.total,
      version: sql`${tjxSubInvoices.version} + 1`,
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(eq(tjxSubInvoices.id, row.id))
  await writeRevision(tx, {
    subInvoiceId: row.id,
    revisionNo: row.rejectedCount,
    revisionType: 'update',
    session,
  })
  await auditTjx(tx, session, 'tjx.sub_invoice.save', 'tjx_sub_invoice', row.id, {
    summary: `Saved the TJX invoice draft for work order ${input.workOrderId}.`,
    after: { total: totals.total, version: row.version + 1 },
  })
  return detail(tx, input.workOrderId, session)
}

export async function setSubInvoiceGateCore(
  tx: Tx,
  input: {
    workOrderId: number
    version: number
    kind: TjxGateKind
    checked: boolean
    documentId: string | null
  },
  session: AuthSessionView,
): Promise<TjxSubInvoiceDetail> {
  const { row, workOrder } = await loadRowForUpdate(tx, input.workOrderId, session)
  assertOwner(row, session)
  assertEditable(row)
  if (row.version !== input.version) {
    throw new ValidationError('This invoice changed since it was loaded. Reload and retry.')
  }
  if (!GATE_KINDS.includes(input.kind)) throw new ValidationError('Unknown gate.')

  if (input.checked) {
    if (!input.documentId) {
      throw new ValidationError(`${GATE_LABEL[input.kind]} needs an uploaded document.`)
    }
    const [document] = await tx
      .select({ id: workOrderDocuments.id })
      .from(workOrderDocuments)
      .where(
        and(
          eq(workOrderDocuments.id, input.documentId),
          eq(workOrderDocuments.workOrderId, workOrder.id),
        ),
      )
      .limit(1)
    if (!document) throw new ValidationError('That document is not on this work order.')
    await tx
      .insert(tjxSubInvoiceDocuments)
      .values({
        subInvoiceId: row.id,
        documentId: input.documentId,
        kind: input.kind,
        createdBy: session.user.id,
      })
      .onConflictDoNothing()
  }

  const patch =
    input.kind === 'post_project_fc_reading'
      ? { chkProjectReading: input.checked }
      : input.kind === 'post_project_photos'
        ? { chkProjectPhotos: input.checked }
        : { chkProjectSignoff: input.checked }
  await tx
    .update(tjxSubInvoices)
    .set({
      ...patch,
      version: sql`${tjxSubInvoices.version} + 1`,
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(eq(tjxSubInvoices.id, row.id))
  await auditTjx(tx, session, 'tjx.sub_invoice.gate', 'tjx_sub_invoice', row.id, {
    summary: `${GATE_LABEL[input.kind]} ${input.checked ? 'recorded' : 'cleared'}.`,
    after: { kind: input.kind, checked: input.checked, documentId: input.documentId },
  })
  return detail(tx, input.workOrderId, session)
}

export async function submitSubInvoiceCore(
  tx: Tx,
  input: { workOrderId: number; version: number },
  session: AuthSessionView,
): Promise<TjxSubInvoiceDetail> {
  const { row, workOrder } = await loadRowForUpdate(tx, input.workOrderId, session)
  assertOwner(row, session)
  assertEditable(row)
  if (row.version !== input.version) {
    throw new ValidationError('This invoice changed since it was loaded. Reload and retry.')
  }
  if (!row.invoiceNumber.trim()) throw new ValidationError('Enter your invoice number.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.invoiceDate)) {
    throw new ValidationError('Enter a valid invoice date.')
  }
  if (!row.taxProvince) throw new ValidationError('Choose a tax province.')

  const gates: [boolean, TjxGateKind][] = [
    [row.chkProjectReading, 'post_project_fc_reading'],
    [row.chkProjectPhotos, 'post_project_photos'],
    [row.chkProjectSignoff, 'signed_work_order'],
  ]
  const documents = await tx
    .select({ kind: tjxSubInvoiceDocuments.kind })
    .from(tjxSubInvoiceDocuments)
    .where(eq(tjxSubInvoiceDocuments.subInvoiceId, row.id))
  const linked = new Set(documents.map((document) => document.kind))
  for (const [checked, kind] of gates) {
    if (!checked) {
      throw new ValidationError(`${GATE_LABEL[kind]} is not recorded.`)
    }
    if (!linked.has(kind)) {
      throw new ValidationError(`${GATE_LABEL[kind]} has no linked document.`)
    }
  }

  const partRows = await tx
    .select()
    .from(tjxSubInvoiceParts)
    .where(eq(tjxSubInvoiceParts.subInvoiceId, row.id))
    .orderBy(asc(tjxSubInvoiceParts.sortOrder))
  const positive = partRows.filter(
    (part) => compare(parseDecimal(part.quantity)!, { value: 0n, scale: 0 }) > 0,
  )
  if (positive.length === 0) {
    throw new ValidationError('Enter at least one installed fixture quantity.')
  }
  const missing = partRows
    .filter((part) => compare(parseDecimal(part.unitRate)!, { value: 0n, scale: 0 }) <= 0)
    .map((part) => part.partNo)
  if (missing.length > 0) {
    throw new ValidationError(`No install rate for: ${missing.join(', ')}.`)
  }

  const [latest] = await tx
    .select({ revisionNo: tjxSubInvoiceSubmissions.revisionNo })
    .from(tjxSubInvoiceSubmissions)
    .where(eq(tjxSubInvoiceSubmissions.subInvoiceId, row.id))
    .orderBy(desc(tjxSubInvoiceSubmissions.revisionNo))
    .limit(1)
  const revisionNo = (latest?.revisionNo ?? 0) + 1
  const standardNumber =
    revisionNo === 1 ? row.invoiceNumber.trim() : `${row.invoiceNumber.trim()}-R${revisionNo}`

  const created = await createSubcontractorInvoiceCore(
    tx,
    {
      workOrderId: workOrder.id,
      invoiceNumber: standardNumber,
      invoiceDate: row.invoiceDate,
      taxProvince: row.taxProvince,
      appliedTaxRate: row.appliedTaxRate,
      notes: row.notes,
      lines: partRows.map((part) => ({
        kind: 'part',
        description: `${part.partNo}${part.description ? ` — ${part.description}` : ''}`,
        qty: part.quantity,
        rate: part.unitRate,
      })),
    },
    session,
  )

  const [standard] = await tx
    .select()
    .from(subcontractorInvoices)
    .where(eq(subcontractorInvoices.id, created.invoiceId))
  if (!standard) throw new ValidationError('The standard invoice was not created.')
  if (standard.totalAmount !== row.totalAmount || standard.subtotalAmount !== row.subtotalAmount) {
    throw new ValidationError('The invoice totals changed. Reload and submit again.')
  }

  const now = new Date()
  await tx
    .update(tjxSubInvoices)
    .set({
      subcontractorInvoiceId: created.invoiceId,
      isSubmitted: true,
      submittedAt: now,
      rejectedAt: null,
      approvedAt: null,
      version: sql`${tjxSubInvoices.version} + 1`,
      updatedBy: session.user.id,
      updatedAt: now,
    })
    .where(eq(tjxSubInvoices.id, row.id))
  await tx.insert(tjxSubInvoiceSubmissions).values({
    subInvoiceId: row.id,
    revisionNo,
    subcontractorInvoiceId: created.invoiceId,
    submittedBy: session.user.id,
    submittedAt: now,
    outcome: 'submitted',
  })
  await writeRevision(tx, {
    subInvoiceId: row.id,
    revisionNo,
    revisionType: 'submit',
    session,
  })
  await auditTjx(tx, session, 'tjx.sub_invoice.submit', 'tjx_sub_invoice', row.id, {
    summary: `Submitted TJX invoice ${standardNumber} for work order ${workOrder.id}.`,
    after: {
      subcontractorInvoiceId: created.invoiceId,
      revisionNo,
      standardNumber,
      total: row.totalAmount,
    },
  })
  return detail(tx, input.workOrderId, session)
}

export async function rejectSubInvoiceCore(
  tx: Tx,
  input: { workOrderId: number; version: number; reason: string },
  session: AuthSessionView,
): Promise<TjxSubInvoiceDetail> {
  assertOfficeWrite(session)
  const { row, workOrder } = await loadRowForUpdate(tx, input.workOrderId, session)
  if (!row.isSubmitted || !row.subcontractorInvoiceId) {
    throw new ValidationError('Only a submitted TJX invoice can be rejected.')
  }
  if (row.version !== input.version) {
    throw new ValidationError('This invoice changed since it was loaded. Reload and retry.')
  }
  const [standard] = await tx
    .select()
    .from(subcontractorInvoices)
    .where(eq(subcontractorInvoices.id, row.subcontractorInvoiceId))
  if (!standard) throw new NotFoundError('Standard invoice')

  await rejectSubcontractorInvoiceCore(
    tx,
    { invoiceId: standard.id, reason: input.reason },
    session,
  )

  const now = new Date()
  await tx
    .update(tjxSubInvoices)
    .set({
      isSubmitted: false,
      approvedAt: null,
      rejectedAt: now,
      rejectedCount: sql`${tjxSubInvoices.rejectedCount} + 1`,
      version: sql`${tjxSubInvoices.version} + 1`,
      updatedBy: session.user.id,
      updatedAt: now,
    })
    .where(eq(tjxSubInvoices.id, row.id))
  const [latestSubmission] = await tx
    .select()
    .from(tjxSubInvoiceSubmissions)
    .where(eq(tjxSubInvoiceSubmissions.subInvoiceId, row.id))
    .orderBy(desc(tjxSubInvoiceSubmissions.revisionNo))
    .limit(1)
  if (latestSubmission) {
    await tx
      .update(tjxSubInvoiceSubmissions)
      .set({ outcome: 'rejected', rejectionReason: input.reason })
      .where(eq(tjxSubInvoiceSubmissions.id, latestSubmission.id))
  }
  await writeRevision(tx, {
    subInvoiceId: row.id,
    revisionNo: latestSubmission?.revisionNo ?? 0,
    revisionType: 'reject',
    session,
  })
  await auditTjx(tx, session, 'tjx.sub_invoice.reject', 'tjx_sub_invoice', row.id, {
    summary: `Rejected TJX invoice for work order ${workOrder.id}: ${input.reason}`,
    after: { rejectedCount: row.rejectedCount + 1, reason: input.reason },
  })
  return detail(tx, input.workOrderId, session)
}

export async function approveSubInvoiceCore(
  tx: Tx,
  input: { workOrderId: number; version: number },
  session: AuthSessionView,
): Promise<TjxSubInvoiceDetail> {
  assertOfficeWrite(session)
  const { row, workOrder } = await loadRowForUpdate(tx, input.workOrderId, session)
  if (!row.isSubmitted || !row.subcontractorInvoiceId) {
    throw new ValidationError('Only a submitted TJX invoice can be approved.')
  }
  if (row.version !== input.version) {
    throw new ValidationError('This invoice changed since it was loaded. Reload and retry.')
  }
  const [standard] = await tx
    .select()
    .from(subcontractorInvoices)
    .where(eq(subcontractorInvoices.id, row.subcontractorInvoiceId))
  if (!standard) throw new NotFoundError('Standard invoice')

  await approveSubcontractorInvoiceCore(
    tx,
    { invoiceId: standard.id, version: standard.version },
    session,
  )

  const [current] = await tx
    .select({ status: workOrders.status, version: workOrders.version })
    .from(workOrders)
    .where(eq(workOrders.id, workOrder.id))
  if (current?.status === 2) {
    await transitionWorkOrderCore(
      tx,
      { id: workOrder.id, version: current.version, to: 4, note: 'TJX subcontractor invoice approved.' },
      session,
    )
  } else if (current?.status !== 4) {
    throw new ValidationError(
      'The work order must be Complete before its TJX invoice can be approved.',
    )
  }

  const now = new Date()
  await tx
    .update(tjxSubInvoices)
    .set({
      approvedAt: now,
      rejectedAt: null,
      version: sql`${tjxSubInvoices.version} + 1`,
      updatedBy: session.user.id,
      updatedAt: now,
    })
    .where(eq(tjxSubInvoices.id, row.id))
  const [latestSubmission] = await tx
    .select()
    .from(tjxSubInvoiceSubmissions)
    .where(eq(tjxSubInvoiceSubmissions.subInvoiceId, row.id))
    .orderBy(desc(tjxSubInvoiceSubmissions.revisionNo))
    .limit(1)
  if (latestSubmission) {
    await tx
      .update(tjxSubInvoiceSubmissions)
      .set({ outcome: 'approved' })
      .where(eq(tjxSubInvoiceSubmissions.id, latestSubmission.id))
  }
  await writeRevision(tx, {
    subInvoiceId: row.id,
    revisionNo: latestSubmission?.revisionNo ?? 0,
    revisionType: 'approve',
    session,
  })
  await auditTjx(tx, session, 'tjx.sub_invoice.approve', 'tjx_sub_invoice', row.id, {
    summary: `Approved TJX invoice for work order ${workOrder.id}.`,
    after: { subcontractorInvoiceId: standard.id, total: standard.totalAmount },
  })
  return detail(tx, input.workOrderId, session)
}

export async function listAssignedTjxWorkOrders(
  executor: Executor,
  session: AuthSessionView,
): Promise<TjxAssignedTjxWorkOrderRow[]> {
  const subcontractorId = requireSubcontractor(session)
  const rows = await executor
    .select({
      workOrderId: workOrders.id,
      quoteId: tjxQuoteWorkOrders.quoteId,
      siteName: sql<string | null>`null`,
      invoiceId: tjxSubInvoices.id,
      isSubmitted: tjxSubInvoices.isSubmitted,
      approvedAt: tjxSubInvoices.approvedAt,
      rejectedAt: tjxSubInvoices.rejectedAt,
      total: tjxSubInvoices.totalAmount,
      rejectedCount: tjxSubInvoices.rejectedCount,
      updatedAt: tjxSubInvoices.updatedAt,
    })
    .from(workOrders)
    .innerJoin(
      tjxQuoteWorkOrders,
      and(
        eq(tjxQuoteWorkOrders.workOrderId, workOrders.id),
        eq(tjxQuoteWorkOrders.isPrimary, true),
      ),
    )
    .leftJoin(tjxSubInvoices, eq(tjxSubInvoices.workOrderId, workOrders.id))
    .where(and(eq(workOrders.subcontractorId, subcontractorId), eq(workOrders.isTjxQuote, true)))
    .orderBy(desc(workOrders.updatedAt))
  return rows.map((row) => ({
    workOrderId: row.workOrderId,
    quoteId: row.quoteId,
    siteName: row.siteName,
    invoiceId: row.invoiceId,
    invoiceStatus: row.invoiceId
      ? statusOf({
          isSubmitted: row.isSubmitted ?? false,
          approvedAt: row.approvedAt,
          rejectedAt: row.rejectedAt,
        })
      : null,
    total: row.total,
    rejectedCount: row.rejectedCount,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  }))
}

export async function listSubInvoices(
  executor: Executor,
  session: AuthSessionView,
): Promise<TjxSubInvoiceListRow[]> {
  const office = session.user.grants.some((grant) => grant.key === 'tjx:read')
  if (!office && !isSubcontractor(session)) throw new ForbiddenError('tjx:read')

  const rows = await executor
    .select({ row: tjxSubInvoices })
    .from(tjxSubInvoices)
    .where(
      office
        ? undefined
        : eq(tjxSubInvoices.subcontractorId, session.user.subcontractorId!),
    )
    .orderBy(desc(tjxSubInvoices.updatedAt))
    .limit(300)
  return rows.map(({ row }) => ({
    id: row.id,
    workOrderId: row.workOrderId,
    quoteId: row.quoteId,
    invoiceNumber: row.invoiceNumber || '(draft)',
    invoiceDate: row.invoiceDate,
    status: statusOf(row),
    isSubmitted: row.isSubmitted,
    rejectedCount: row.rejectedCount,
    subtotal: row.subtotalAmount,
    tax: row.taxAmount,
    total: row.totalAmount,
    subcontractorInvoiceId: row.subcontractorInvoiceId,
    submittedAt: iso(row.submittedAt),
    updatedAt: row.updatedAt.toISOString(),
  }))
}
