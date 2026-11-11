/**
 * The HTTP client used by the real adapter.
 *
 * Every call takes a quota class, goes through the governor, and is classified
 * on the way out. The adapter never retries blindly: a retryable error comes
 * back as a `SageError` and the outbox decides what to do with it.
 *
 * Test guard: importing this module under `NODE_ENV=test` is fine, but making a
 * network call is not. `fetch` is always injected, so the tests pass an
 * in-memory fake and the guard fails the build if somebody reaches for the real
 * `fetch` without `SAGE_TEST_HTTP=1`.
 */
import { classifyResponse, SageError } from '../errors'
import type { QuotaClass, QuotaGovernor } from '../quota'
import { quotaPausedError } from '../quota'
import type { FetchLike } from '../types'

export interface SageHttpOptions {
  apiBaseUrl: string
  /** A string, or resolved per call from the saved connection. */
  businessId: string | (() => Promise<string | null>)
  getAccessToken: () => Promise<string>
  onUnauthorised: (reason: string) => Promise<void>
  quota?: QuotaGovernor
  fetch?: FetchLike
  now?: () => Date
  timeoutMs?: number
  /** Called after a 429 so the adapter can drain its minute bucket. */
  onRateLimited?: () => void
  onThreshold?: (threshold: 'near_limit' | 'exhausted') => void
}

export interface SageRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
  quotaClass?: QuotaClass
  /** Search endpoints are idempotent, so a 401 retry is safe for them too. */
  idempotent?: boolean
}

export interface SageResponse {
  status: number
  body: string
  json: unknown
}

function defaultFetch(): FetchLike {
  if (process.env.NODE_ENV === 'test' && process.env.SAGE_TEST_HTTP !== '1') {
    throw new SageError(
      'unconfigured',
      'SAGE_TEST_NETWORK_BLOCKED',
      'A test tried to make a real Sage call. Inject a fetch or set SAGE_TEST_HTTP=1.',
    )
  }
  return globalThis.fetch as unknown as FetchLike
}

export class SageHttp {
  readonly #options: SageHttpOptions
  readonly #fetch: FetchLike

  constructor(options: SageHttpOptions) {
    this.#options = options
    this.#fetch = options.fetch ?? defaultFetch()
  }

  get baseUrl(): string {
    return this.#options.apiBaseUrl.replace(/\/$/, '')
  }

  /** One call, one quota unit, one classification. A 401 retries once. */
  async request(request: SageRequest): Promise<SageResponse> {
    return this.#attempt(request, true)
  }

  async #attempt(request: SageRequest, allowAuthRetry: boolean): Promise<SageResponse> {
    const klass = request.quotaClass ?? 'sync'
    if (this.#options.quota) {
      const decision = await this.#options.quota.reserve(klass)
      if (!decision.allowed) throw quotaPausedError(decision)
      if (decision.threshold !== 'ok') this.#options.onThreshold?.(decision.threshold)
    }

    const token = await this.#options.getAccessToken()
    const businessId =
      typeof this.#options.businessId === 'string'
        ? this.#options.businessId
        : await this.#options.businessId()
    if (!businessId) {
      throw new SageError(
        'unconfigured',
        'SAGE_BUSINESS_UNRESOLVED',
        'The Sage business is not selected yet; choose one in the connection screen.',
      )
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.#options.timeoutMs ?? 30_000)
    let response: Awaited<ReturnType<FetchLike>>
    try {
      response = await this.#fetch(`${this.baseUrl}/${request.path.replace(/^\//, '')}`, {
        method: request.method,
        headers: {
          authorization: `Bearer ${token}`,
          'x-business': businessId,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new SageError('retryable', 'SAGE_TIMEOUT', `Sage did not answer: ${message}`)
    } finally {
      clearTimeout(timeout)
    }

    const text = await response.text()
    if (response.status === 401 && allowAuthRetry) {
      await this.#options.onUnauthorised('401 from the Sage API')
      return this.#attempt(request, false)
    }
    if (response.status === 429) {
      this.#options.onRateLimited?.()
    }
    if (response.status >= 200 && response.status < 300) {
      return { status: response.status, body: text, json: safeJson(text) }
    }
    throw classifyResponse(response.status, text, response.headers)
  }

  async get(path: string, quotaClass: QuotaClass = 'sync'): Promise<unknown> {
    const response = await this.request({ method: 'GET', path, quotaClass })
    return response.json
  }

  async post(path: string, body: unknown, quotaClass: QuotaClass = 'posting'): Promise<SageResponse> {
    return this.request({ method: 'POST', path, body, quotaClass })
  }
}

function safeJson(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
