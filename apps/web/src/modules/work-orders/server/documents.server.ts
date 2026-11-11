/**
 * Photos, documents and signatures.
 *
 * SERVER ONLY. Objects go through `packages/storage` with the canonical
 * work-order layout. A local filesystem driver is the offline fallback, so the
 * same code path works with or without Neon Object Storage.
 */
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { NotFoundError, ValidationError } from '@cls/core'
import { getDb, type Db, type Tx } from '@cls/db'
import {
  localWorkOrderSignatures,
  workOrderDocuments,
  workOrders,
} from '@cls/db/schema'
import { STORAGE_LAYOUT, getStorage } from '@cls/storage'
import type { AuthSessionView } from '../../../server/auth.types'
import type { DocumentUploadInput, SignatureInput, WorkOrderStatusCode } from '../types'
import { assertPermission, loadAccessibleWorkOrder } from './access.server'
import { auditWorkOrder } from './records.server'

const MAX_BYTES = 18 * 1024 * 1024
const LOCKED: readonly WorkOrderStatusCode[] = [6, 10, 11]

function decode(dataBase64: string, claimedBytes?: number): Uint8Array {
  const cleaned = dataBase64.includes(',') ? dataBase64.split(',').pop()! : dataBase64
  const bytes = Buffer.from(cleaned, 'base64')
  if (cleaned.length === 0) throw new ValidationError('The uploaded file is empty.')
  if (bytes.byteLength > MAX_BYTES) {
    throw new ValidationError('Files are limited to 18 MB.')
  }
  if (claimedBytes !== undefined && claimedBytes > MAX_BYTES) {
    throw new ValidationError('Files are limited to 18 MB.')
  }
  return new Uint8Array(bytes)
}

async function assertOpen(tx: Tx, workOrderId: number): Promise<void> {
  const [row] = await tx
    .select({ status: workOrders.status, isLocal: workOrders.isLocal })
    .from(workOrders)
    .where(eq(workOrders.id, workOrderId))
  if (!row) throw new NotFoundError('Work order')
  if (LOCKED.includes(row.status as WorkOrderStatusCode)) {
    throw new ValidationError('This work order is closed and cannot take new files.')
  }
}

export async function uploadDocumentCore(
  tx: Tx,
  input: DocumentUploadInput,
  session: AuthSessionView,
): Promise<{ id: string; storageKey: string }> {
  assertPermission(session, 'workorder:capture')
  await loadAccessibleWorkOrder(session, input.workOrderId, tx)
  await assertOpen(tx, input.workOrderId)

  const id = randomUUID()
  const bytes = decode(input.dataBase64)
  const key =
    input.kind === 'photo'
      ? STORAGE_LAYOUT.workOrderPhoto(input.workOrderId, id, extensionFor(input.filename))
      : STORAGE_LAYOUT.workOrderDocument(input.workOrderId, id, input.filename)

  await getStorage('assets').put(key, bytes, { contentType: input.contentType })

  await tx.insert(workOrderDocuments).values({
    id,
    workOrderId: input.workOrderId,
    kind: input.kind,
    storageKey: key,
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: bytes.byteLength,
    caption: input.caption ?? null,
    uploadedBy: session.user.id,
  })

  await auditWorkOrder(tx, session, 'workorder.document_uploaded', input.workOrderId, {
    summary: `${input.kind === 'photo' ? 'Photo' : 'Document'} uploaded: ${input.filename}.`,
    after: { documentId: id, kind: input.kind, filename: input.filename },
  })
  return { id, storageKey: key }
}

export async function captureSignatureCore(
  tx: Tx,
  input: SignatureInput,
  session: AuthSessionView,
): Promise<{ id: string; storageKey: string }> {
  assertPermission(session, 'workorder:capture')
  const workOrder = await loadAccessibleWorkOrder(session, input.workOrderId, tx)
  if (!workOrder.isLocal) {
    throw new ValidationError('Signatures are captured on local work orders.')
  }
  if (LOCKED.includes(workOrder.status as WorkOrderStatusCode)) {
    throw new ValidationError('This work order is closed.')
  }

  const id = randomUUID()
  const bytes = decode(input.dataBase64)
  const extension = input.contentType === 'image/svg+xml' ? 'svg' : input.contentType === 'image/jpeg' ? 'jpg' : 'png'
  const key = STORAGE_LAYOUT.workOrderDocument(
    input.workOrderId,
    id,
    `signature-${input.signerName.replace(/[^\w-]+/g, '_')}.${extension}`,
  )
  await getStorage('assets').put(key, bytes, { contentType: input.contentType })

  await tx.insert(localWorkOrderSignatures).values({
    id,
    workOrderId: input.workOrderId,
    signerName: input.signerName,
    storageKey: key,
    note: input.note ?? null,
    capturedBy: session.user.id,
  })
  await tx.insert(workOrderDocuments).values({
    id,
    workOrderId: input.workOrderId,
    kind: 'signature',
    storageKey: key,
    filename: `signature-${input.signerName}.${extension}`,
    contentType: input.contentType,
    sizeBytes: bytes.byteLength,
    caption: input.note ?? null,
    uploadedBy: session.user.id,
  })

  await auditWorkOrder(tx, session, 'workorder.signature_captured', input.workOrderId, {
    summary: `Signature captured for ${input.signerName}.`,
  })
  return { id, storageKey: key }
}

export async function downloadDocument(
  input: { workOrderId: number; documentId: string },
  session: AuthSessionView,
  executor?: Db,
): Promise<{ filename: string; contentType: string; dataBase64: string }> {
  assertPermission(session, 'workorder:read')
  await loadAccessibleWorkOrder(session, input.workOrderId, executor)
  const db = executor ?? getDb()
  const [document] = await db
    .select()
    .from(workOrderDocuments)
    .where(
      and(
        eq(workOrderDocuments.id, input.documentId),
        eq(workOrderDocuments.workOrderId, input.workOrderId),
      ),
    )
    .limit(1)
  if (!document) throw new NotFoundError('Document')
  const object = await getStorage('assets').get(document.storageKey)
  return {
    filename: document.filename,
    contentType: object.contentType ?? document.contentType ?? 'application/octet-stream',
    dataBase64: Buffer.from(object.body).toString('base64'),
  }
}

export async function deleteDocument(
  input: { workOrderId: number; documentId: string },
  session: AuthSessionView,
): Promise<{ deleted: true }> {
  assertPermission(session, 'workorder:capture')
  const db = getDb()
  return db.transaction(async (tx) => {
    await loadAccessibleWorkOrder(session, input.workOrderId, tx)
    await assertOpen(tx, input.workOrderId)
    const [document] = await tx
      .delete(workOrderDocuments)
      .where(
        and(
          eq(workOrderDocuments.id, input.documentId),
          eq(workOrderDocuments.workOrderId, input.workOrderId),
        ),
      )
      .returning()
    if (!document) throw new NotFoundError('Document')
    await getStorage('assets').delete(document.storageKey)
    await auditWorkOrder(tx, session, 'workorder.document_deleted', input.workOrderId, {
      summary: `Document deleted: ${document.filename}.`,
      before: { documentId: document.id, filename: document.filename },
    })
    return { deleted: true as const }
  })
}

function extensionFor(filename: string): string {
  const extension = filename.split('.').pop() ?? 'bin'
  return extension.replace(/[^\w]/g, '').slice(0, 8) || 'bin'
}

export const runUploadDocument = (
  input: DocumentUploadInput,
  session: AuthSessionView,
  executor?: Db,
) => (executor ?? getDb()).transaction((tx) => uploadDocumentCore(tx, input, session))

export const runCaptureSignature = (
  input: SignatureInput,
  session: AuthSessionView,
  executor?: Db,
) => (executor ?? getDb()).transaction((tx) => captureSignatureCore(tx, input, session))
