import { resolve } from 'node:path'
import { getConfig } from '@cls/core/env.server'
import { LocalStorageAdapter } from './local'
import { S3StorageAdapter } from './s3'
import type { StorageAdapter } from './types'

export * from './types'
export { LocalStorageAdapter } from './local'
export { S3StorageAdapter, type S3StorageOptions } from './s3'

/**
 * Two buckets, matching the provisioned Neon project:
 *  - `assets`     operational files: work-order photos, documents, compliance
 *  - `accounting` generated financial PDFs (invoices, statements, reports)
 *
 * Keeping them apart means a lifecycle or access policy on generated financial
 * documents never touches operational evidence.
 */
export type StorageBucket = 'assets' | 'accounting'

const adapters = new Map<StorageBucket, StorageAdapter>()

/**
 * Resolves storage once per process, per bucket.
 *
 * `STORAGE_DRIVER=auto` (default) uses Neon Object Storage when the full
 * credential set is present and the local filesystem otherwise, so a developer
 * can run the app with no Neon account and no network.
 */
export function getStorage(bucket: StorageBucket = 'assets'): StorageAdapter {
  const existing = adapters.get(bucket)
  if (existing) return existing
  const storage = getConfig().storage
  const s3 = new S3StorageAdapter({
    endpoint: storage.endpoint,
    region: storage.region,
    bucket: bucket === 'accounting' ? storage.accountingBucket : storage.bucket,
    accessKeyId: storage.accessKeyId,
    secretAccessKey: storage.secretAccessKey,
  })

  let adapter: StorageAdapter
  if (storage.driver === 'local') {
    adapter = new LocalStorageAdapter(resolve(storage.localDir, bucket))
  } else if (storage.driver === 's3' || s3.isConfigured) {
    adapter = s3
  } else {
    adapter = new LocalStorageAdapter(resolve(storage.localDir, bucket))
  }
  adapters.set(bucket, adapter)
  return adapter
}

export function setStorageForTests(
  next: StorageAdapter | undefined,
  bucket: StorageBucket = 'assets',
): void {
  if (next) adapters.set(bucket, next)
  else adapters.delete(bucket)
}
