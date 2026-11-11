/**
 * Test harness: the real adapter, mappers, quota, pause and token service, with
 * only the socket replaced by the in-memory API.
 *
 * Every test that says "the adapter posts an invoice" therefore exercises the
 * same code the production adapter will run, which is the point of the
 * real-shape double.
 */
import { createSealer } from '../crypto'
import { MemoryPauseStore, PauseGovernor } from '../pause'
import { MemoryQuotaStore, MinuteBucket, QuotaGovernor } from '../quota'
import { SageCloudAdapter } from '../adapter'
import { SageHttp } from '../client/http'
import { TokenService, type ConnectionRepository, type StoredConnection } from '../auth/tokens'
import type { ConnectionStatus } from '../types'
import { createFakeSageApi, type FakeSageApi, type FakeSageApiOptions } from './fake-api'

export const TEST_KEY = Buffer.alloc(32, 7).toString('base64')

export class MemoryConnectionRepository implements ConnectionRepository {
  current: StoredConnection | null
  samples: { daysSinceRefresh: number; state: string }[] = []
  #queue: Promise<unknown> = Promise.resolve()
  saveAttempts = 0
  failNextSave = false

  constructor(initial: StoredConnection | null) {
    this.current = initial
  }

  async load(): Promise<StoredConnection | null> {
    return this.current ? structuredClone(this.current) : null
  }

  /** A mutex standing in for the Postgres advisory lock. */
  async withRefreshLock<T>(fn: (current: StoredConnection | null) => Promise<T>): Promise<T> {
    const run = this.#queue.then(() => fn(this.current ? structuredClone(this.current) : null))
    this.#queue = run.catch(() => undefined)
    return run
  }

  async save(connection: StoredConnection): Promise<void> {
    if (this.failNextSave) {
      this.failNextSave = false
      throw new Error('commit failed')
    }
    this.saveAttempts += 1
    this.current = structuredClone(connection)
  }

  async markState(status: ConnectionStatus): Promise<void> {
    if (!this.current) return
    this.current.state = status.state as StoredConnection['state']
    this.current.message = status.message
  }

  async writeHealthSample(sample: { daysSinceRefresh: number; state: string }): Promise<void> {
    this.samples.push({ daysSinceRefresh: sample.daysSinceRefresh, state: sample.state })
  }
}

export function initialConnection(options: {
  now: Date
  businessId?: string | null
  accessToken?: string
  refreshToken?: string
  lastRefreshAt?: Date
  state?: StoredConnection['state']
}): StoredConnection {
  const sealer = createSealer(TEST_KEY)
  const businessId = options.businessId ?? 'business_1'
  const aad = `sandbox|${businessId ?? ''}`
  return {
    environment: 'sandbox',
    businessId,
    accessTokenSealed: sealer.seal(options.accessToken ?? 'fake_access_0', aad),
    refreshTokenSealed: sealer.seal(options.refreshToken ?? 'fake_refresh_0', aad),
    accessExpiresAt: new Date(options.now.getTime() + 300_000),
    refreshExpiresAt: new Date(options.now.getTime() + 31 * 24 * 60 * 60 * 1000),
    lastRefreshAt: options.lastRefreshAt ?? options.now,
    state: options.state ?? 'verified',
    message: null,
  }
}

export interface Harness {
  api: FakeSageApi
  adapter: SageCloudAdapter
  tokens: TokenService
  repository: MemoryConnectionRepository
  pause: PauseGovernor
  quota: QuotaGovernor
  clock: { now: Date }
}

export function buildHarness(options: {
  api?: FakeSageApiOptions
  now?: Date
  ledger?: { salesAccountId?: string | null; purchaseAccountId?: string | null; roundingAccountId?: string | null }
  initial?: Parameters<typeof initialConnection>[0]
  quotaLimit?: number
} = {}): Harness {
  const clock = { now: options.now ?? new Date('2026-11-11T15:00:00Z') }
  const api = createFakeSageApi(options.api)
  const now = () => clock.now
  const repository = new MemoryConnectionRepository(
    initialConnection({ now: clock.now, ...(options.initial ?? {}) }),
  )
  const tokens = new TokenService({
    environment: 'sandbox',
    tokenUrl: 'https://oauth.example/token',
    clientId: 'client',
    clientSecret: 'secret',
    redirectUri: 'https://app.example/api/sage/oauth/callback',
    sealer: createSealer(TEST_KEY),
    repository,
    fetch: api.fetch,
    now,
  })
  const quota = new QuotaGovernor({
    store: new MemoryQuotaStore(),
    limit: options.quotaLimit ?? 2500,
    minute: new MinuteBucket({ now: () => clock.now.getTime() }),
    now,
  })
  const pause = new PauseGovernor({ store: new MemoryPauseStore(), now })
  const http = new SageHttp({
    apiBaseUrl: 'https://api.example/v3.1',
    businessId: () => tokens.status().then((status) => status.businessId),
    getAccessToken: () => tokens.getAccessToken(),
    onUnauthorised: (reason) => tokens.invalidate(reason),
    quota,
    now,
    fetch: api.fetch,
    timeoutMs: 50,
  })
  const adapter = new SageCloudAdapter({
    http,
    tokens,
    quota,
    pause,
    environment: 'sandbox',
    ledger: {
      salesAccountId: options.ledger?.salesAccountId ?? 'account_sales',
      purchaseAccountId: options.ledger?.purchaseAccountId ?? 'account_purchases',
      roundingAccountId: options.ledger?.roundingAccountId ?? null,
    },
    now,
  })
  return { api, adapter, tokens, repository, pause, quota, clock }
}
