import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NotFoundError } from '@cls/core'
import { LocalStorageAdapter } from './local'
import { STORAGE_LAYOUT, safeFilename } from './types'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cls-storage-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('LocalStorageAdapter', () => {
  it('round-trips binary content under a nested key', async () => {
    const adapter = new LocalStorageAdapter(root)
    const bytes = new Uint8Array([0, 1, 2, 255, 128])
    const stored = await adapter.put('workorders/42/photos/a.bin', bytes, {
      contentType: 'application/octet-stream',
    })
    expect(stored.size).toBe(5)
    const fetched = await adapter.get('workorders/42/photos/a.bin')
    expect(Array.from(fetched.body)).toEqual([0, 1, 2, 255, 128])
    expect(await readFile(join(root, 'workorders/42/photos/a.bin'))).toEqual(Buffer.from(bytes))
  })

  it('deletes an object and reports a missing one as not found', async () => {
    const adapter = new LocalStorageAdapter(root)
    await adapter.put('documents/x.txt', 'hello', { contentType: 'text/plain' })
    await adapter.delete('documents/x.txt')
    await expect(adapter.get('documents/x.txt')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('rejects keys that escape the storage root', async () => {
    const adapter = new LocalStorageAdapter(root)
    await expect(adapter.put('../escape.txt', 'x', { contentType: 'text/plain' })).rejects.toThrow(
      /Invalid object key|escapes/,
    )
    await expect(adapter.put('/etc/passwd', 'x', { contentType: 'text/plain' })).rejects.toThrow(
      /Invalid object key/,
    )
    await expect(adapter.put('a/../../b.txt', 'x', { contentType: 'text/plain' })).rejects.toThrow(
      /Invalid object key|escapes/,
    )
  })

  it('has no signed URLs locally and reports healthy', async () => {
    const adapter = new LocalStorageAdapter(root)
    expect(await adapter.getSignedUrl('x')).toBeNull()
    expect((await adapter.health()).status).toBe('ok')
  })
})

describe('storage layout', () => {
  it('builds the documented prefixes', () => {
    expect(STORAGE_LAYOUT.workOrderPhoto(42, 'uuid', '.jpg')).toBe('workorders/42/photos/uuid.jpg')
    expect(STORAGE_LAYOUT.generatedPdf('invoice', 2026, 3, 'uuid')).toBe(
      'generated/invoice/2026/03/uuid.pdf',
    )
    expect(STORAGE_LAYOUT.customerDocument('c1', 'id', '../../etc/passwd')).toBe(
      'customers/c1/documents/id-passwd',
    )
  })

  it('neutralises traversal and separators in filenames', () => {
    expect(safeFilename('C:\\Users\\x\\invoice 12.pdf')).toBe('invoice-12.pdf')
    expect(safeFilename('../../secret.txt')).toBe('secret.txt')
  })
})
