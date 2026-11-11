/**
 * Quote and packing-slip PDFs.
 *
 * SERVER ONLY. Layout belongs to `@cls/pdf`; this file maps committed rows to
 * the versioned DTO, stores the artifact in the private accounting bucket and
 * records the immutable snapshot used for regeneration (ADR 0011).
 */
import { createHash, randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import { logger } from '@cls/core/logger'
import { getDb, type Db, type Tx } from '@cls/db'
import { generatedDocuments, quotePackingSlips } from '@cls/db/schema'
import { format, multiply, parseDecimal, round } from '@cls/pricing'
import { getStorage, STORAGE_LAYOUT } from '@cls/storage'
import type { AuthSessionView } from '../../../server/auth.types'
import type {
  QuoteDetail,
  QuotePackingInput,
  QuotePdfResult,
} from '../types'
import { assertQuotePermission, assertQuoteWrite, loadQuoteRow } from './access.server'
import { getQuoteDetail } from './get.server'
import { auditQuote } from './records.server'

const RENDERER_VERSION = '1.0.0'

function money(value: string): string {
  return format(round(parseDecimal(value) ?? { value: 0n, scale: 2 }, 2), 2)
}

function quantityLine(hours: string | null, numTechs: number): string {
  const base = parseDecimal(hours ?? '0') ?? { value: 0n, scale: 2 }
  return format(multiply(base, parseDecimal(String(numTechs)) ?? { value: 1n, scale: 0 }), 2)
}

function addressFor(detail: QuoteDetail) {
  return {
    name: detail.customerName ?? detail.siteName ?? `Site ${detail.siteId}`,
    contact: detail.shipContact ?? undefined,
    street: detail.shipStreet1 ?? undefined,
    street2: detail.shipStreet2 ?? undefined,
    city: detail.shipCity ?? undefined,
    province: detail.shipProvince ?? undefined,
    postalCode: detail.shipPostalCode ?? undefined,
  }
}

export function quoteDocumentData(detail: QuoteDetail) {
  const lines = [
    ...detail.hours.map((line) => ({
      partNumber: undefined,
      description: `Labour${line.numTechs > 1 ? ` (${line.numTechs} techs)` : ''}${line.lineDate ? ` — ${line.lineDate}` : ''}${line.note ? ` — ${line.note}` : ''}`,
      quantity: quantityLine(line.hours, line.numTechs),
      unit: 'hr',
      unitPrice: money(line.rate),
      lineTotal: money(
        format(
          multiply(
            multiply(
              parseDecimal(line.hours) ?? { value: 0n, scale: 2 },
              parseDecimal(String(line.numTechs)) ?? { value: 1n, scale: 0 },
            ),
            parseDecimal(line.rate) ?? { value: 0n, scale: 2 },
          ),
          2,
        ),
      ),
    })),
    ...detail.parts.map((line) => ({
      partNumber: line.partNo,
      description: line.description || line.partNo,
      quantity: String(line.qty),
      unit: 'ea',
      unitPrice: money(line.price),
      lineTotal: money(
        format(multiply(parseDecimal(String(line.qty)) ?? { value: 0n, scale: 0 }, parseDecimal(line.price) ?? { value: 0n, scale: 2 }), 2),
      ),
    })),
    ...detail.specialParts.map((line) => ({
      partNumber: undefined,
      description: line.name,
      quantity: String(line.qty),
      unit: 'ea',
      unitPrice: money(line.price),
      lineTotal: money(
        format(multiply(parseDecimal(String(line.qty)) ?? { value: 0n, scale: 0 }, parseDecimal(line.price) ?? { value: 0n, scale: 2 }), 2),
      ),
    })),
  ].map((line, index) => ({ position: index + 1, ...line }))

  return {
    schemaVersion: 1 as const,
    kind: 'quote' as const,
    number: detail.numberLabel,
    revision: detail.revisionId,
    issuedOn: detail.dateCreated,
    validUntil: detail.isDueDateTbd ? undefined : detail.dueDate ?? undefined,
    customer: addressFor(detail),
    shipTo: addressFor(detail),
    lines,
    totals: {
      subtotal: detail.totals.subtotal,
      taxLabel: `Tax (${detail.totals.taxProvince})`,
      tax: detail.totals.tax,
      total: detail.totals.total,
    },
    notes: detail.pdfNotes ? [detail.pdfNotes] : [],
    terms: [
      'Prices are in Canadian dollars.',
      'Quote valid for 30 days from the issue date unless stated otherwise.',
    ],
  }
}

async function storeDocument(input: {
  db: Db | Tx
  kind: string
  entityType: string
  entityId: string
  data: Record<string, unknown>
  buffer: Buffer
  pageCount: number | null
  session: AuthSessionView
}): Promise<QuotePdfResult> {
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
    entityType: input.entityType,
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

  const url = await getStorage('accounting').getSignedUrl(key, 300).catch(() => null)
  return {
    documentId: id,
    url,
    sha256,
    byteSize: input.buffer.byteLength,
    pageCount: input.pageCount,
  }
}

export async function renderQuotePdfCore(
  tx: Tx,
  id: number,
  session: AuthSessionView,
): Promise<QuotePdfResult> {
  assertQuotePermission(session, 'quote:read')
  const detail = await getQuoteDetail(session, id, tx)
  const data = quoteDocumentData(detail)
  const { renderDocument, countPdfPages } = await import('@cls/pdf')
  let buffer: Buffer
  try {
    buffer = await renderDocument('quote', data)
  } catch (error) {
    logger.error('Quote PDF render failed', {
      quoteId: id,
      cause: error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error),
    })
    throw error
  }
  const pageCount = countPdfPages(buffer)

  await auditQuote(tx, session, 'quote.pdf', id, {
    summary: `Rendered quote ${detail.numberLabel} PDF.`,
  })

  return storeDocument({
    db: tx,
    kind: 'quote',
    entityType: 'quote',
    entityId: String(id),
    data: data as unknown as Record<string, unknown>,
    buffer,
    pageCount,
    session,
  })
}

export async function renderQuotePdf(
  id: number,
  session: AuthSessionView,
  executor?: Db,
): Promise<QuotePdfResult> {
  const db = executor ?? getDb()
  return db.transaction((tx) => renderQuotePdfCore(tx, id, session))
}

export async function createPackingSlipCore(
  tx: Tx,
  input: QuotePackingInput,
  session: AuthSessionView,
): Promise<{ id: number; pdf: QuotePdfResult }> {
  assertQuoteWrite(session)
  const quote = await loadQuoteRow(session, input.quoteId, tx)
  if (quote.status !== 4) {
    throw new ValidationError('Packing slips are issued from an approved quote.')
  }

  const [slip] = await tx
    .insert(quotePackingSlips)
    .values({
      quoteId: input.quoteId,
      shipDate: input.shipDate ?? null,
      notes: input.notes ?? null,
      packingSlipLevel: 1,
      createdBy: session.user.id,
    })
    .returning()
  if (!slip) throw new ValidationError('The packing slip could not be created.')

  const { quotePackingParts, quotePackingSpecialParts } = await import('@cls/db/schema')
  if (input.parts.length) {
    await tx.insert(quotePackingParts).values(
      input.parts.map((line, index) => ({
        packingSlipId: slip.id,
        quotePartId: line.quotePartId ?? null,
        partNo: line.partNo,
        actualQty: line.actualQty,
        shippedQty: line.shippedQty,
        backorderQty: line.backorderQty,
        sortOrder: index,
      })),
    )
  }
  if (input.specialParts.length) {
    await tx.insert(quotePackingSpecialParts).values(
      input.specialParts.map((line, index) => ({
        packingSlipId: slip.id,
        quoteSpecialPartId: line.quoteSpecialPartId ?? null,
        name: line.name,
        actualQty: line.actualQty,
        shippedQty: line.shippedQty,
        backorderQty: line.backorderQty,
        sortOrder: index,
      })),
    )
  }

  const detail = await getQuoteDetail(session, input.quoteId, tx)
  const dto = {
    schemaVersion: 1 as const,
    kind: 'packing-slip' as const,
    number: `PS-${detail.numberLabel}-${slip.id}`,
    issuedOn: slip.dateCreated,
    shipDate: slip.shipDate ?? undefined,
    customer: addressFor(detail),
    shipTo: addressFor(detail),
    lines: [
      ...input.parts.map((line, index) => ({
        position: index + 1,
        partNumber: line.partNo,
        description: detail.parts.find((part) => part.partNo === line.partNo)?.description ?? line.partNo,
        quantity: String(line.actualQty),
        unit: 'ea',
        shipped: String(line.shippedQty),
        backorder: String(line.backorderQty),
      })),
      ...input.specialParts.map((line, index) => ({
        position: input.parts.length + index + 1,
        partNumber: undefined,
        description: line.name,
        quantity: String(line.actualQty),
        unit: 'ea',
        shipped: String(line.shippedQty),
        backorder: String(line.backorderQty),
      })),
    ],
    notes: slip.notes ? [slip.notes] : [],
  }

  const { renderDocument, countPdfPages } = await import('@cls/pdf')
  const buffer = await renderDocument('packing-slip', dto)
  const pageCount = countPdfPages(buffer)
  const pdf = await storeDocument({
    db: tx,
    kind: 'packing-slip',
    entityType: 'quote_packing_slip',
    entityId: String(slip.id),
    data: dto as unknown as Record<string, unknown>,
    buffer,
    pageCount,
    session,
  })

  await auditQuote(tx, session, 'quote.packing_slip', input.quoteId, {
    summary: `Created packing slip ${slip.id} for quote ${input.quoteId}.`,
    after: { packingSlipId: slip.id, pdfDocumentId: pdf.documentId },
  })

  return { id: slip.id, pdf }
}

export async function createPackingSlip(
  input: QuotePackingInput,
  session: AuthSessionView,
  executor?: Db,
) {
  const db = executor ?? getDb()
  return db.transaction((tx) => createPackingSlipCore(tx, input, session))
}

/**
 * Regenerate an issued document from its stored snapshot. Live rows are never
 * consulted, so later price or address edits cannot change an issued PDF.
 */
export async function regenerateGeneratedDocument(
  documentId: string,
  session: AuthSessionView,
  executor?: Db,
): Promise<QuotePdfResult> {
  assertQuotePermission(session, 'quote:read')
  const db = executor ?? getDb()
  const [row] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, documentId))
    .limit(1)
  if (!row) throw new ValidationError('Generated document not found.')
  if (row.kind !== 'quote' && row.kind !== 'packing-slip') {
    throw new ValidationError(`Unsupported generated document kind: ${row.kind}`)
  }
  const { renderDocument, countPdfPages } = await import('@cls/pdf')
  const buffer = await renderDocument(row.kind, row.dataSnapshot as never)
  return storeDocument({
    db,
    kind: row.kind,
    entityType: row.entityType,
    entityId: row.entityId,
    data: row.dataSnapshot,
    buffer,
    pageCount: countPdfPages(buffer),
    session,
  })
}

export async function listGeneratedDocuments(
  entityType: string,
  entityId: string,
  session: AuthSessionView,
  executor?: Db,
) {
  assertQuotePermission(session, 'quote:read')
  const db = executor ?? getDb()
  const rows = await db
    .select()
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.entityType, entityType),
        eq(generatedDocuments.entityId, entityId),
      ),
    )
    .orderBy(asc(generatedDocuments.createdAt))
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

