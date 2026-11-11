/**
 * Customer invoice PDFs.
 *
 * SERVER ONLY. The PDF is rendered from the stored invoice snapshot, stored in
 * the accounting bucket with its hash and schema version, and can be regenerated
 * byte-identically from `generated_documents.data_snapshot` (ADR 0011).
 */
import { createHash, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { NotFoundError, ValidationError } from '@cls/core'
import { logger } from '@cls/core/logger'
import { getDb, type Db, type Executor, type Tx } from '@cls/db'
import { generatedDocuments } from '@cls/db/schema'
import { getStorage, STORAGE_LAYOUT } from '@cls/storage'
import type { AuthSessionView } from '../../../server/auth.types'
import { assertSalesInvoiceRead } from './access.server'
import { getInvoiceDetail } from './get.server'
import { auditInvoice } from './records.server'

const RENDERER_VERSION = '1.0.0'

type InvoiceDetail = Awaited<ReturnType<typeof getInvoiceDetail>>

function address(detail: InvoiceDetail) {
  const site = detail.site
  return {
    name: site?.customerName?.trim() || site?.name || `Site ${detail.invoice.siteId}`,
    contact: site?.name && site.name !== site.customerName ? site.name : undefined,
    street: site?.street || undefined,
    city: site?.city || undefined,
    province: site?.province || undefined,
    postalCode: site?.postalCode ?? undefined,
  }
}

/** Deterministic DTO. Every value comes from committed invoice rows. */
export function invoiceDocumentData(detail: InvoiceDetail) {
  const lines = [
    ...detail.labour.map((line) => ({
      partNumber: undefined,
      description: line.description || `Labour — ${line.lineDate}`,
      quantity: line.hours,
      unit: 'hr',
      unitPrice: line.hourlyRate,
      lineTotal: line.amount,
    })),
    ...detail.parts.map((line) => ({
      partNumber: line.partNo,
      description: line.description || line.partNo,
      quantity: line.qty,
      unit: 'ea',
      unitPrice: line.price,
      lineTotal: line.amount,
    })),
    ...detail.specialParts.map((line) => ({
      partNumber: undefined,
      description: line.name,
      quantity: line.qty,
      unit: 'ea',
      unitPrice: line.price,
      lineTotal: line.amount,
    })),
  ].map((line, index) => ({ position: index + 1, ...line }))

  const invoice = detail.invoice
  return {
    schemaVersion: 1 as const,
    kind: 'invoice' as const,
    number: invoice.invoiceNumber,
    issuedOn: invoice.issuedOn ?? invoice.invoiceDate,
    dueDate: invoice.dueDate ?? undefined,
    workOrderNumber: String(invoice.workOrderNumber),
    customer: address(detail),
    shipTo: address(detail),
    lines,
    totals: {
      subtotal: invoice.subtotalAmount,
      taxLabel: `Tax (${invoice.taxProvince})`,
      tax: invoice.taxAmount,
      total: invoice.totalAmount,
    },
    notes: invoice.notes ? [invoice.notes] : [],
    terms: [
      'Payment is due by the date shown on this invoice.',
      'Please quote the invoice number with your payment.',
    ],
  }
}

async function storeDocument(input: {
  db: Tx | Db
  entityId: string
  data: Record<string, unknown>
  buffer: Buffer
  pageCount: number | null
  session: AuthSessionView
}) {
  const id = randomUUID()
  const now = new Date()
  const key = STORAGE_LAYOUT.generatedPdf('invoice', now.getFullYear(), now.getMonth() + 1, id)
  const sha256 = createHash('sha256').update(input.buffer).digest('hex')

  await getStorage('accounting').put(key, input.buffer, {
    contentType: 'application/pdf',
    metadata: { kind: 'invoice', entityId: input.entityId, sha256 },
  })

  await input.db.insert(generatedDocuments).values({
    id,
    kind: 'invoice',
    entityType: 'sales_invoice',
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
    sha256,
    byteSize: input.buffer.byteLength,
    pageCount: input.pageCount,
    storageKey: key,
  }
}

export async function renderInvoicePdfCore(
  tx: Tx,
  invoiceId: number,
  session: AuthSessionView,
) {
  assertSalesInvoiceRead(session)
  const detail = await getInvoiceDetail(session, invoiceId, tx)
  const data = invoiceDocumentData(detail)
  const { renderDocument, countPdfPages } = await import('@cls/pdf')
  let buffer: Buffer
  try {
    buffer = await renderDocument('invoice', data)
  } catch (error) {
    logger.error('Invoice PDF render failed', {
      invoiceId,
      cause: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
  const pageCount = countPdfPages(buffer)
  const stored = await storeDocument({
    db: tx,
    entityId: String(invoiceId),
    data: data as unknown as Record<string, unknown>,
    buffer,
    pageCount,
    session,
  })
  await auditInvoice(tx, session, 'invoice.pdf', invoiceId, {
    summary: `Rendered invoice ${detail.invoice.invoiceNumber} PDF.`,
    after: { documentId: stored.documentId, sha256: stored.sha256 },
  })
  return stored
}

export async function renderInvoicePdf(
  invoiceId: number,
  session: AuthSessionView,
  executor?: Db,
) {
  const db = executor ?? getDb()
  return db.transaction((tx) => renderInvoicePdfCore(tx, invoiceId, session))
}

/**
 * Regenerate from the stored DTO, never from live rows. The returned bytes are
 * identical to the first render of the same snapshot.
 */
export async function regenerateInvoiceDocument(
  documentId: string,
  session: AuthSessionView,
  executor?: Executor,
) {
  assertSalesInvoiceRead(session)
  const db = executor ?? getDb()
  const [row] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, documentId))
    .limit(1)
  if (!row) throw new NotFoundError('Generated document not found.')
  if (row.kind !== 'invoice' || row.entityType !== 'sales_invoice') {
    throw new ValidationError(`Unsupported generated document kind: ${row.kind}`)
  }
  const invoiceId = Number(row.entityId)
  if (!Number.isInteger(invoiceId)) throw new ValidationError('Invalid invoice document.')
  const { renderDocument, countPdfPages } = await import('@cls/pdf')
  const buffer = await renderDocument('invoice', row.dataSnapshot as never)
  return storeDocument({
    db,
    entityId: row.entityId,
    data: row.dataSnapshot,
    buffer,
    pageCount: countPdfPages(buffer),
    session,
  })
}

export async function listInvoiceDocuments(
  invoiceId: number,
  session: AuthSessionView,
  executor?: Executor,
) {
  assertSalesInvoiceRead(session)
  const db = executor ?? getDb()
  const rows = await db
    .select()
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.entityType, 'sales_invoice'),
        eq(generatedDocuments.entityId, String(invoiceId)),
      ),
    )
  const storage = getStorage('accounting')
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      sha256: row.sha256,
      schemaVersion: row.schemaVersion,
      createdAt: row.createdAt.toISOString(),
      url: await storage.getSignedUrl(row.storageKey, 300).catch(() => null),
    })),
  )
}
