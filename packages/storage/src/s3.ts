import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner'
import { NotFoundError, ServiceUnavailableError } from '@cls/core'
import type {
  ObjectBody,
  PutOptions,
  StorageAdapter,
  StorageHealth,
  StoredObject,
} from './types'

export interface S3StorageOptions {
  endpoint: string | undefined
  region: string
  bucket: string
  accessKeyId: string | undefined
  secretAccessKey: string | undefined
  /** Cache window for health() so status checks do not hit S3 on every call. */
  healthCacheMs?: number
}

/**
 * Neon Object Storage through the S3 API.
 *
 * `forcePathStyle` is required for a custom endpoint (Neon docs). The endpoint
 * is branch-scoped; the credential is valid for that branch and its
 * descendants, so a preview deployment can reuse it only along the lineage.
 */
export class S3StorageAdapter implements StorageAdapter {
  readonly name = 's3' as const
  private readonly options: Required<S3StorageOptions>
  private client: S3Client | undefined
  private cachedHealth: StorageHealth | undefined
  private cachedAt = 0

  constructor(options: S3StorageOptions) {
    this.options = { healthCacheMs: 30_000, ...options }
  }

  get isConfigured(): boolean {
    return Boolean(
      this.options.endpoint &&
        this.options.bucket &&
        this.options.accessKeyId &&
        this.options.secretAccessKey,
    )
  }

  private s3(): S3Client {
    if (!this.isConfigured) {
      throw new ServiceUnavailableError(
        'Object Storage',
        'AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and S3_BUCKET are required.',
      )
    }
    if (!this.client) {
      this.client = new S3Client({
        region: this.options.region,
        endpoint: this.options.endpoint,
        forcePathStyle: true,
        credentials: {
          accessKeyId: this.options.accessKeyId as string,
          secretAccessKey: this.options.secretAccessKey as string,
        },
      })
    }
    return this.client
  }

  async put(key: string, body: Uint8Array | string, options: PutOptions): Promise<StoredObject> {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
    const result = await this.s3().send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: bytes,
        ContentType: options.contentType,
        Metadata: options.metadata,
      }),
    )
    return {
      key,
      size: bytes.byteLength,
      contentType: options.contentType,
      etag: result.ETag,
    }
  }

  async get(key: string): Promise<ObjectBody> {
    try {
      const result = await this.s3().send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      )
      if (!result.Body) throw new NotFoundError('Object')
      return {
        body: await result.Body.transformToByteArray(),
        contentType: result.ContentType ?? null,
        etag: result.ETag,
      }
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') throw new NotFoundError('Object')
      throw error
    }
  }

  async getSignedUrl(key: string, expiresInSeconds = 300): Promise<string | null> {
    return presign(
      this.s3(),
      new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      { expiresIn: Math.min(Math.max(expiresInSeconds, 30), 3600) },
    )
  }

  async delete(key: string): Promise<void> {
    await this.s3().send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }))
  }

  async health(): Promise<StorageHealth> {
    const now = Date.now()
    if (this.cachedHealth && now - this.cachedAt < this.options.healthCacheMs) {
      return this.cachedHealth
    }

    let health: StorageHealth
    if (!this.isConfigured) {
      health = {
        status: 'not_configured',
        driver: 's3',
        bucket: this.options.bucket,
        message: 'Object storage credentials are not set.',
      }
    } else {
      const started = Date.now()
      try {
        await this.s3().send(new HeadBucketCommand({ Bucket: this.options.bucket }))
        health = {
          status: 'ok',
          driver: 's3',
          bucket: this.options.bucket,
          latencyMs: Date.now() - started,
          message: `Bucket ${this.options.bucket} is reachable.`,
        }
      } catch (error) {
        health = {
          status: 'unavailable',
          driver: 's3',
          bucket: this.options.bucket,
          latencyMs: Date.now() - started,
          message: error instanceof Error ? error.message : 'Object storage is unavailable',
        }
      }
    }

    this.cachedHealth = health
    this.cachedAt = now
    return health
  }
}
