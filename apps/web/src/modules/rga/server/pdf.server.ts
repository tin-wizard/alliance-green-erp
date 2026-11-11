/**
 * RGA print document — the `print_rga` equivalent.
 *
 * SERVER ONLY. The PDF is built from committed rows and stored in the
 * accounting bucket with its hash and schema version, following ADR 0011.
 */
import { createHash, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { NotFoundError } from '@cls/core'
import type { Db, Executor, Tx } from '@cls/db'
import { generatedDocuments } from '@cls/db/schema'
import { getStorage, STORAGE_LAYOUT } from '@cls/storage'
import type { AuthSessionView } from '../../../server/auth.types'
import { RGA_TYPE_LABELS, type RgaType } from '../lib/lifecycle'
import { assertRgaRead } from './access.server'
import { getRgaDetail } from './get.server'
import { auditRga } from './records.server'

const RENDERER_VERSION = '1.0.0'

type RgaDetail = Awaited<ReturnType<typeof getRgaDetail>>

export function rgaDocumentData(detail: RgaDetail) {
  const { rga, supplier, site, workOrder, purchaseOrder } = detail
  const lines = [
    ...detail.parts.map((line) => ({
      position: line.position,
      partNumber: line.partNo,
      description: line.description || line.partNo,
      quantity: line.qty,
      returnQuantity: line.returnQty,
      unitPrice: line.price,
      reason: line.reasonForReturn ?? undefined,
    })),
    ...detail.specialParts.map((line) => ({
      position: detail.parts.length + line.position,
      partNumber: undefined,
      description: line.description || line.name,
      quantity: line.qty,
      returnQuantity: line.returnQty,
      unitPrice: line.price,
      reason: line.reasonForReturn ?? undefined,
    })),
  ].sort((a, b) => a.position - b.position)

  const notes = [rga.rgaNotes, rga.internalNotes].filter(
    (note): note is string => Boolean(note && note.trim()),
  )

  return {
    schemaVersion: 1 as const,
    kind: 'rga' as const,
    number: rga.number,
    issuedOn: rga.requestDate,
    typeLabel: RGA_TYPE_LABELS[rga.rgaType as RgaType] ?? rga.rgaType,
    statusLabel: rga.statusLabel,
    supplier: supplier
      ? {
          name: supplier.name,
          street: supplier.address ?? undefined,
          city: supplier.city ?? undefined,
          province: supplier.province ?? undefined,
          postalCode: supplier.postalCode ?? undefined,
        }
      : undefined,
    site: site
      ? {
          name: site.name,
          street: site.street ?? undefined,
          city: site.city ?? undefined,
          province: site.province ?? undefined,
          postalCode: site.postalCode ?? undefined,
        }
      : undefined,
    workOrderNumber: workOrder ? String(workOrder.number) : undefined,
    purchaseOrderNumber: purchaseOrder?.displayNumber ?? undefined,
    lines,
    notes,
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
  const key = STORAGE_LAYOUT.generatedPdf('rga', now.getFullYear(), now.getMonth() + 1, id)
  const sha256 = createHash('sha256').update(input.buffer).digest('hex')

  await getStorage('accounting').put(key, input.buffer, {
    contentType: 'application/pdf',
    metadata: { kind: 'rga', entityId: input.entityId, sha256 },
  })

  await input.db.insert(generatedDocuments).values({
    id,
    kind: 'rga',
    entityType: 'rga',
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

export async function renderRgaPdfCore(tx: Tx, rgaId: number, session: AuthSessionView) {
  assertRgaRead(session)
  const detail = await getRgaDetail(session, rgaId, tx)
  const data = rgaDocumentData(detail)
  const { renderDocument, countPdfPages } = await import('@cls/pdf')
  const buffer = await renderDocument('rga', data)
  const stored = await storeDocument({
    db: tx,
    entityId: String(rgaId),
    data: data as unknown as Record<string, unknown>,
    buffer,
    pageCount: countPdfPages(buffer),
    session,
  })
  await auditRga(tx, session, 'rga.pdf', rgaId, {
    summary: `Rendered RGA ${detail.rga.number} PDF.`,
    after: { documentId: stored.documentId, sha256: stored.sha256 },
  })
  return stored
}

export async function renderRgaPdf(rgaId: number, session: AuthSessionView, executor?: Db) {
  const db = executor ?? (await import('@cls/db')).getDb()
  return db.transaction((tx) => renderRgaPdfCore(tx, rgaId, session))
}

export async function listRgaDocuments(
  rgaId: number,
  session: AuthSessionView,
  executor?: Executor,
) {
  assertRgaRead(session)
  const db = executor ?? (await import('@cls/db')).getDb()
  const rows = await db
    .select()
    .from(generatedDocuments)
    .where(
      and(eq(generatedDocuments.entityType, 'rga'), eq(generatedDocuments.entityId, String(rgaId))),
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

/** Regenerate from the stored DTO, never from live rows. */
export async function regenerateRgaDocument(
  documentId: string,
  session: AuthSessionView,
  executor?: Executor,
) {
  assertRgaRead(session)
  const db = executor ?? (await import('@cls/db')).getDb()
  const [row] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, documentId))
    .limit(1)
  if (!row) throw new NotFoundError('Generated document not found.')
  if (row.kind !== 'rga' || row.entityType !== 'rga') {
    throw new NotFoundError('Generated document not found.')
  }
  const { renderDocument, countPdfPages } = await import('@cls/pdf')
  const buffer = await renderDocument('rga', row.dataSnapshot as never)
  return storeDocument({
    db,
    entityId: row.entityId,
    data: row.dataSnapshot,
    buffer,
    pageCount: countPdfPages(buffer),
    session,
  })
}
