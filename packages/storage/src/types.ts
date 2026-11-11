/**
 * Storage adapter boundary.
 *
 * The assessment assumed Cloudflare R2. The human provisioned Neon Object
 * Storage instead: an S3-compatible endpoint scoped to one branch. This
 * interface keeps that choice reversible and gives offline development a
 * filesystem fallback.
 *
 * SERVER ONLY. Nothing outside this package may import the AWS SDK or read the
 * AWS or STORAGE environment variables.
 */

export interface StoredObject {
  key: string
  size: number
  contentType: string
  etag?: string
}

export interface ObjectBody {
  body: Uint8Array
  contentType: string | null
  etag?: string
}

export interface PutOptions {
  contentType: string
  /** Optional metadata stored alongside the object (S3 user metadata). */
  metadata?: Record<string, string>
}

export type StorageHealthStatus = 'ok' | 'unavailable' | 'not_configured'

export interface StorageHealth {
  status: StorageHealthStatus
  driver: 's3' | 'local'
  bucket?: string
  latencyMs?: number
  message: string
}

export interface StorageAdapter {
  readonly name: 's3' | 'local'
  put(key: string, body: Uint8Array | string, options: PutOptions): Promise<StoredObject>
  get(key: string): Promise<ObjectBody>
  /** Returns null when the driver cannot sign (local development). */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string | null>
  delete(key: string): Promise<void>
  health(): Promise<StorageHealth>
}

/**
 * Canonical bucket layout. Modules must use these prefixes so a lifecycle rule,
 * backup job or migration can reason about objects without reading code.
 *
 * Local storage mirrors the layout under `STORAGE_LOCAL_DIR`.
 */
export const STORAGE_LAYOUT = {
  workOrderPhoto: (woid: number, id: string, ext: string) =>
    `workorders/${woid}/photos/${id}.${ext.replace(/^\./, '')}`,
  workOrderDocument: (woid: number, id: string, filename: string) =>
    `workorders/${woid}/documents/${id}-${safeFilename(filename)}`,
  customerDocument: (customerId: string, id: string, filename: string) =>
    `customers/${customerId}/documents/${id}-${safeFilename(filename)}`,
  supplierDocument: (supplierId: string, id: string, filename: string) =>
    `suppliers/${supplierId}/documents/${id}-${safeFilename(filename)}`,
  subcontractorCompliance: (subcontractorId: number, id: string, filename: string) =>
    `subcontractors/${subcontractorId}/compliance/${id}-${safeFilename(filename)}`,
  generatedPdf: (kind: string, year: number, month: number, id: string) =>
    `generated/${kind}/${year}/${String(month).padStart(2, '0')}/${id}.pdf`,
  quarantine: (id: string, filename: string) => `quarantine/${id}-${safeFilename(filename)}`,
} as const

export function safeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? 'file'
  return base
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, '-')
    .slice(0, 120)
}
