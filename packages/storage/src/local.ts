import { mkdir, readFile, rm, stat, writeFile, access } from 'node:fs/promises'
import { dirname, join, normalize, resolve, sep } from 'node:path'
import { constants } from 'node:fs'
import { NotFoundError, ServiceUnavailableError } from '@cls/core'
import type {
  ObjectBody,
  PutOptions,
  StorageAdapter,
  StorageHealth,
  StoredObject,
} from './types'

/**
 * Filesystem fallback for offline development and for a LAN install with no
 * outbound access. Keys map to files under `root`, with the same prefix layout
 * used in object storage.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'local' as const
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  private pathFor(key: string): string {
    const clean = normalize(key).replaceAll(sep, '/')
    if (
      clean.length === 0 ||
      clean.startsWith('/') ||
      clean.split('/').some((part) => part === '..' || part === '.')
    ) {
      throw new ServiceUnavailableError('Storage', `Invalid object key: ${key}`)
    }
    const target = join(this.root, clean)
    if (target !== this.root && !target.startsWith(`${this.root}${sep}`)) {
      throw new ServiceUnavailableError('Storage', `Object key escapes the storage root: ${key}`)
    }
    return target
  }

  async put(key: string, body: Uint8Array | string, options: PutOptions): Promise<StoredObject> {
    const target = this.pathFor(key)
    await mkdir(dirname(target), { recursive: true })
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
    await writeFile(target, bytes)
    return {
      key,
      size: bytes.byteLength,
      contentType: options.contentType,
    }
  }

  async get(key: string): Promise<ObjectBody> {
    const target = this.pathFor(key)
    try {
      const body = new Uint8Array(await readFile(target))
      return { body, contentType: null }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError('Object')
      throw error
    }
  }

  async getSignedUrl(): Promise<string | null> {
    // A local install serves objects through the application, not a presigned URL.
    return null
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true })
  }

  async health(): Promise<StorageHealth> {
    const started = Date.now()
    try {
      await mkdir(this.root, { recursive: true })
      await access(this.root, constants.W_OK)
      const info = await stat(this.root)
      return {
        status: info.isDirectory() ? 'ok' : 'unavailable',
        driver: 'local',
        latencyMs: Date.now() - started,
        message: `Local storage at ${this.root}`,
      }
    } catch (error) {
      return {
        status: 'unavailable',
        driver: 'local',
        latencyMs: Date.now() - started,
        message: error instanceof Error ? error.message : 'Local storage is not writable',
      }
    }
  }
}
