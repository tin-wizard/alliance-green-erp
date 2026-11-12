/**
 * TJX quote PDF and internal order sheet.
 *
 * SERVER ONLY. The customer document and the internal document are different
 * registered kinds, so one can never be downloaded as the other. Both store the
 * DTO snapshot that produced the bytes and are regenerated from that snapshot.
 */
import { createHash, randomUUID } from 'node:crypto'
import { and, asc, desc, eq } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import { getDb, type Db, type Tx } from '@cls/db'
import { generatedDocuments, tjxQuoteWorkOrders } from '@cls/db/schema'
import { getStorage, STORAGE_LAYOUT } from '@cls/storage'
import type { AuthSessionView } from '../../../server/auth.types'
import type {
  TjxGeneratedDocument,
  TjxPdfResult,
  TjxQuoteDetail,
} from '../types'
import { gridLabel, paymentTermsLabel } from '../lib/lifecycle'
import { assertTjxRead, auditTjx } from './access.server'
import { getQuoteDetail } from './quotes.server'

const RENDERER_VERSION = '1.0.0'

type TjxPdfKind = 'tjx-quote' | 'tjx-order-sheet'

function address(detail: TjxQuoteDetail) {
  return {
    name: detail.customerName ?? detail.siteName ?? `Site ${detail.siteId ?? 'unknown'}`,
    contact: detail.shipContactName ?? undefined,
    street: detail.shipStreet1 ?? undefined,
    street2: detail.shipStreet2 ?? undefined,
    city: detail.shipCity ?? undefined,
    province: detail.shipProvince ?? undefined,
    postalCode: detail.shipPostalCode ?? undefined,
    phone: detail.shipPhone ?? undefined,
  }
}

function scope(detail: TjxQuoteDetail) {
  return detail.rooms.map((room) => ({
    name: room.roomName,
    fixtures: room.fixtures.map((fixture) => ({
      name: fixture.fixtureName,
      quantity: fixture.quantity,
    })),
  }))
}

function issuedOn(detail: TjxQuoteDetail): string {
  return detail.createdAt.slice(0, 10)
}

function common(detail: TjxQuoteDetail) {
  return {
    schemaVersion: 1 as const,
    number: `TJX-${detail.id}`,
    revision: detail.revisionNo > 0 ? String(detail.revisionNo) : undefined,
    issuedOn: issuedOn(detail),
    dueDate: detail.dueDate ?? undefined,
    customer: address(detail),
    shipTo: address(detail),
    quoteType: detail.quoteType,
    gridType: gridLabel(detail.ceilingGridType) ?? undefined,
    paymentTerms: paymentTermsLabel(detail.paymentTermsCode) ?? undefined,
    rooms: scope(detail),
    notes: detail.pdfNotes ? [detail.pdfNotes] : [],
  }
}

export function tjxQuoteDocumentData(detail: TjxQuoteDetail) {
  return {
    ...common(detail),
    kind: 'tjx-quote' as const,
    lines: detail.parts.map((part, index) => ({
      position: index + 1,
      partNumber: part.partNo,
      description: part.description || part.partNo,
      quantity: part.qtyWithMarkup,
      unitPrice: part.unitPrice,
      lineTotal: part.lineSubtotal,
    })),
    specialParts: detail.specialParts.map((part, index) => ({
      position: index + 1,
      description: part.name,
      quantity: part.quantity,
      unitPrice: part.unitPrice,
      lineTotal: part.lineSubtotal,
    })),
    totals: {
      subtotal: detail.subtotal,
      taxLabel: `Tax (${detail.taxProvince ?? 'ON'})`,
      tax: detail.tax,
      total: detail.total,
    },
  }
}

export function tjxOrderSheetDocumentData(detail: TjxQuoteDetail, workOrders: number[]) {
  return {
    ...common(detail),
    kind: 'tjx-order-sheet' as const,
    lines: detail.parts.map((part, index) => ({
      position: index + 1,
      partNumber: part.partNo,
      description: part.description || part.partNo,
      qtyWithMarkup: part.qtyWithMarkup,
      qtyWithoutMarkup: part.qtyWithoutMarkup,
      unitPrice: part.unitPrice,
      lineWithMarkup: part.lineSubtotal,
      lineWithoutMarkup: part.lineSubtotalWithoutMarkup,
    })),
    specialParts: detail.specialParts.map((part, index) => ({
      position: index + 1,
      description: part.name,
      quantity: part.quantity,
      unitPrice: part.unitPrice,
      lineTotal: part.lineSubtotal,
    })),
    totals: {
      withMarkup: {
        subtotal: detail.subtotal,
        taxLabel: `Tax (${detail.taxProvince ?? 'ON'})`,
        tax: detail.tax,
        total: detail.total,
      },
      withoutMarkup: {
        subtotal: detail.withoutMarkupSubtotal,
        taxLabel: `Tax (${detail.taxProvince ?? 'ON'})`,
        tax: detail.withoutMarkupTax,
        total: detail.withoutMarkupTotal,
      },
    },
    workOrders: workOrders.map((id) => `WO-${id}`),
    notes: [detail.notes, detail.pdfNotes].filter((text): text is string => Boolean(text)),
  }
}

async function storeDocument(input: {
  db: Db | Tx
  kind: TjxPdfKind
  entityId: string
  data: Record<string, unknown>
  buffer: Buffer
  pageCount: number | null
  session: AuthSessionView
}): Promise<TjxPdfResult> {
  const id = randomUUID()
  const now = new Date()
  const key = STORAGE_LAYOUT.generatedPdf(input.kind, now.getFullYear(), now.getMonth() + 1, id)
  const sha256 = createHash('sha256').update(input.buffer).digest('hex')

  await getStorage('accounting').put(key, input.buffer, {
    contentType: 'application/pdf',
    metadata: { kind: input.kind, entityId: input.entityId, sha256 },
  })
  await input.db.insert(generatedDocuments).values({
    id,
    kind: input.kind,
    entityType: 'tjx_quote',
    entityId: input.entityId,
    schemaVersion: 1,
    rendererVersion: RENDERER_VERSION,
    storageBucket: 'accounting',
    storageKey: key,
    sha256,
    byteSize: input.buffer.byteLength,
    pageCount: input.pageCount,
    dataSnapshot: input.data,
    createdBy: input.session.user.id,
  })

  return {
    documentId: id,
    url: await getStorage('accounting').getSignedUrl(key, 300).catch(() => null),
    sha256,
    byteSize: input.buffer.byteLength,
    pageCount: input.pageCount,
  }
}

export async function renderTjxDocumentCore(
  tx: Tx,
  id: number,
  session: AuthSessionView,
  kind: TjxPdfKind,
): Promise<TjxPdfResult> {
  assertTjxRead(session)
  const detail = await getQuoteDetail(tx, id)
  let data: Record<string, unknown>
  if (kind === 'tjx-quote') {
    data = tjxQuoteDocumentData(detail) as unknown as Record<string, unknown>
  } else {
    const links = await tx
      .select({ workOrderId: tjxQuoteWorkOrders.workOrderId })
      .from(tjxQuoteWorkOrders)
      .where(eq(tjxQuoteWorkOrders.quoteId, id))
      .orderBy(asc(tjxQuoteWorkOrders.sortOrder))
    data = tjxOrderSheetDocumentData(
      detail,
      links.map((link) => link.workOrderId),
    ) as unknown as Record<string, unknown>
  }

  const { renderDocument, countPdfPages } = await import('@cls/pdf')
  const buffer = await renderDocument(kind, data as never)
  const pageCount = countPdfPages(buffer)
  const pdf = await storeDocument({
    db: tx,
    kind,
    entityId: String(id),
    data,
    buffer,
    pageCount,
    session,
  })

  await auditTjx(
    tx,
    session,
    kind === 'tjx-quote' ? 'tjx.quote.pdf_downloaded' : 'tjx.quote.order_sheet',
    'tjx_quote',
    id,
    { summary: `Generated ${kind} for TJX quote ${id}.`, after: { documentId: pdf.documentId } },
  )
  return pdf
}

export async function renderTjxDocument(
  id: number,
  session: AuthSessionView,
  kind: TjxPdfKind,
  executor?: Db,
): Promise<TjxPdfResult> {
  const db = executor ?? getDb()
  return db.transaction((tx) => renderTjxDocumentCore(tx, id, session, kind))
}

export async function listTjxDocuments(
  id: number,
  session: AuthSessionView,
  executor?: Db,
): Promise<TjxGeneratedDocument[]> {
  assertTjxRead(session)
  const db = executor ?? getDb()
  const rows = await db
    .select()
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.entityType, 'tjx_quote'),
        eq(generatedDocuments.entityId, String(id)),
      ),
    )
    .orderBy(desc(generatedDocuments.createdAt))
  const storage = getStorage('accounting')
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      kind: row.kind,
      schemaVersion: row.schemaVersion,
      sha256: row.sha256,
      byteSize: row.byteSize,
      pageCount: row.pageCount,
      createdAt: row.createdAt.toISOString(),
      url: await storage.getSignedUrl(row.storageKey, 300).catch(() => null),
    })),
  )
}

export async function regenerateTjxDocument(
  documentId: string,
  session: AuthSessionView,
  executor?: Db,
): Promise<TjxPdfResult> {
  assertTjxRead(session)
  const db = executor ?? getDb()
  const [row] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, documentId))
    .limit(1)
  if (!row) throw new ValidationError('Generated document not found.')
  if (row.kind !== 'tjx-quote' && row.kind !== 'tjx-order-sheet') {
    throw new ValidationError(`Unsupported TJX document kind: ${row.kind}`)
  }
  const { renderDocument, countPdfPages } = await import('@cls/pdf')
  const buffer = await renderDocument(row.kind, row.dataSnapshot as never)
  return storeDocument({
    db,
    kind: row.kind,
    entityId: row.entityId,
    data: row.dataSnapshot,
    buffer,
    pageCount: countPdfPages(buffer),
    session,
  })
}
