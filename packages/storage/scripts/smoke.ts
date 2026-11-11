/* eslint-disable no-console */
/**
 * Live object-storage proof: put, get, compare and delete one probe object in
 * each provisioned bucket. Run from the repo root:
 *   pnpm --filter @cls/storage smoke
 */
import { getStorage, type StorageBucket } from '../src/index'

async function main(): Promise<void> {
  for (const bucket of ['assets', 'accounting'] as StorageBucket[]) {
    const storage = getStorage(bucket)
    const health = await storage.health()
    console.log(`${bucket}: health`, health)

    const key = `_smoke/${new Date().toISOString().replaceAll(':', '-')}.txt`
    const content = `cls-green-erp storage probe ${Date.now()}`
    const stored = await storage.put(key, content, {
      contentType: 'text/plain; charset=utf-8',
    })
    const fetched = await storage.get(key)
    const text = new TextDecoder().decode(fetched.body)
    const signed = await storage.getSignedUrl(key, 60)
    console.log(`${bucket}: put`, stored)
    console.log(`${bucket}: get`, {
      bytes: fetched.body.byteLength,
      matches: text === content,
      contentType: fetched.contentType,
      signedUrl: signed ? 'issued' : 'none',
    })
    await storage.delete(key)
    let deleted = false
    try {
      await storage.get(key)
    } catch {
      deleted = true
    }
    console.log(`${bucket}: delete`, { deleted })
  }
}

main().catch((error: unknown) => {
  console.error('storage smoke failed:', error)
  process.exitCode = 1
})
