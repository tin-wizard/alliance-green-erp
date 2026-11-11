/**
 * Compliance document upload and authenticated read. SERVER ONLY.
 *
 * Files are private, type-checked by magic bytes, checksummed and never deleted
 * on replace. Metadata and the object are written together; a DB failure removes
 * the just-uploaded object.
 */
import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import type { Db, Tx } from '@cls/db'
import { subcontractorDocuments, subcontractors } from '@cls/db/schema'
import { getStorage, STORAGE_LAYOUT } from '@cls/storage'
import type { AuthSessionView } from '../../../server/auth.types'
import type { DocumentUploadInput } from '../lib/write-validation'
import { auditMasterData } from './write-support.server'

const MAX_BYTES = 10 * 1024 * 1024

const SIGNATURES: Record<string, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
}

export function sniffContentType(bytes: Uint8Array): string | null {
  for (const [type, signature] of Object.entries(SIGNATURES)) {
    if (signature.every((byte, index) => bytes[index] === byte)) return type
  }
  return null
}

function decode(data: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data.replace(/\s/g, ''))) {
    throw new ValidationError('The uploaded file is not valid base64.')
  }
  const bytes = Buffer.from(data, 'base64')
  if (bytes.byteLength === 0) throw new ValidationError('The uploaded file is empty.')
  if (bytes.byteLength > MAX_BYTES) {
    throw new ValidationError('The uploaded file is larger than 10 MiB.')
  }
  return bytes
}

export async function uploadSubcontractorDocument(
  tx: Tx,
  input: DocumentUploadInput,
  session: AuthSessionView,
): Promise<{ id: string; supersededId: string | null; checksum: string }> {
  const [subcontractor] = await tx
    .select({ id: subcontractors.id, name: subcontractors.name })
    .from(subcontractors)
    .where(eq(subcontractors.id, input.subcontractorId))
    .limit(1)
  if (!subcontractor) throw new ValidationError('Subcontractor not found.')

  const bytes = decode(input.data)
  const sniffed = sniffContentType(bytes)
  if (sniffed === null) {
    throw new ValidationError('Only PDF, JPEG or PNG files are accepted.')
  }
  if (sniffed !== input.contentType) {
    throw new ValidationError('The file contents do not match its declared type.')
  }

  let supersededId: string | null = null
  if (input.replacesDocumentId) {
    const [previous] = await tx
      .select({ id: subcontractorDocuments.id, subcontractorId: subcontractorDocuments.subcontractorId })
      .from(subcontractorDocuments)
      .where(eq(subcontractorDocuments.id, input.replacesDocumentId))
      .limit(1)
    if (!previous || previous.subcontractorId !== input.subcontractorId) {
      throw new ValidationError('The document being replaced does not belong to this subcontractor.')
    }
    supersededId = previous.id
  }

  const id = randomUUID()
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const key = STORAGE_LAYOUT.subcontractorCompliance(input.subcontractorId, id, input.fileName)
  const storage = getStorage('assets')
  await storage.put(key, bytes, {
    contentType: input.contentType,
    metadata: {
      subcontractorId: String(input.subcontractorId),
      documentId: id,
      checksumSha256: checksum,
    },
  })

  try {
    if (supersededId) {
      await tx
        .update(subcontractorDocuments)
        .set({ supersededAt: new Date() })
        .where(eq(subcontractorDocuments.id, supersededId))
    }
    const [row] = await tx
      .insert(subcontractorDocuments)
      .values({
        id,
        subcontractorId: input.subcontractorId,
        kind: input.kind,
        documentType: input.documentType,
        documentName: input.documentName,
        storageKey: key,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: bytes.byteLength,
        checksumSha256: checksum,
        uploadedBy: session.user.id,
        expiresOn: input.expiresOn ?? null,
        isExpired: false,
      })
      .returning()
    if (!row) throw new ValidationError('The document record could not be saved.')

    await auditMasterData(tx, session, {
      action: supersededId
        ? 'masterdata.compliance.replace'
        : 'masterdata.compliance.upload',
      entityType: 'subcontractor_document',
      entityId: id,
      permission: 'compliance:write',
      summary: `Uploaded ${input.kind} document for subcontractor ${input.subcontractorId}.`,
      after: {
        id,
        subcontractorId: input.subcontractorId,
        kind: input.kind,
        checksum,
        sizeBytes: bytes.byteLength,
        supersededId,
      },
    })
    return { id, supersededId, checksum }
  } catch (error) {
    await storage.delete(key).catch(() => undefined)
    throw error
  }
}

export async function loadDocumentForView(
  executor: Db | Tx,
  id: string,
): Promise<{
  id: string
  subcontractorId: number
  kind: string
  fileName: string | null
  contentType: string | null
  storageKey: string | null
} | null> {
  const [row] = await executor
    .select({
      id: subcontractorDocuments.id,
      subcontractorId: subcontractorDocuments.subcontractorId,
      kind: subcontractorDocuments.kind,
      fileName: subcontractorDocuments.fileName,
      contentType: subcontractorDocuments.contentType,
      storageKey: subcontractorDocuments.storageKey,
    })
    .from(subcontractorDocuments)
    .where(eq(subcontractorDocuments.id, id))
    .limit(1)
  return row ?? null
}

export async function signedDocumentUrl(
  id: string,
  executor: Db | Tx,
): Promise<{ url: string; expiresInSeconds: number | null } | null> {
  const document = await loadDocumentForView(executor, id)
  if (!document?.storageKey) return null
  const signed = await getStorage('assets').getSignedUrl(document.storageKey, 300)
  if (signed) return { url: signed, expiresInSeconds: 300 }
  return { url: `/api/master-data/documents/${id}`, expiresInSeconds: null }
}

/** The latest current document of a kind, used by the reminder job. */
export async function latestCurrentDocuments(
  executor: Db | Tx,
  kind: 'wsib' | 'insurance',
): Promise<
  Array<{
    id: string
    subcontractorId: number
    kind: 'wsib' | 'insurance'
    expiresOn: string | null
    reminderState: Record<string, unknown> | null
    supersededAt: Date | null
  }>
> {
  const rows = await executor
    .select({
      id: subcontractorDocuments.id,
      subcontractorId: subcontractorDocuments.subcontractorId,
      kind: subcontractorDocuments.kind,
      expiresOn: subcontractorDocuments.expiresOn,
      reminderState: subcontractorDocuments.reminderState,
      supersededAt: subcontractorDocuments.supersededAt,
    })
    .from(subcontractorDocuments)
    .where(
      and(
        eq(subcontractorDocuments.kind, kind),
        isNull(subcontractorDocuments.supersededAt),
      ),
    )
    .orderBy(desc(subcontractorDocuments.uploadedAt))
  return rows.map((row) => ({ ...row, kind: row.kind as 'wsib' | 'insurance' }))
}
