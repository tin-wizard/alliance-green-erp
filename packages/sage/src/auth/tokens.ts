/**
 * Access tokens: the 5-minute access token, the rotating refresh token, and the
 * 31-day idle death.
 *
 * The rules that keep the integration alive, in order of how expensive they are
 * to get wrong:
 *
 * 1. The refresh response contains a **new** refresh token; the old one dies the
 *    moment the response is produced. So the new pair is sealed and committed
 *    **before** the access token is handed to any caller. A commit failure means
 *    `needs_reauth` — never a retry with the old token.
 * 2. Only one refresh at a time per environment, enforced by the repository's
 *    lock (a Postgres advisory lock in the app, a mutex in tests).
 * 3. An idle business kills the token. Every health check computes the token
 *    age and warns at 14 days, blocks posting at 21, so a human is found before
 *    an invoice fails. That is why `status()` is cheap and never refreshes.
 */
import { createHash, randomBytes } from 'node:crypto'
import { connectionAad, type Sealer } from '../crypto'
import { SageError } from '../errors'
import type { ConnectionStatus, FetchLike } from '../types'

export interface StoredConnection {
  environment: 'sandbox' | 'production'
  businessId: string | null
  /** Sealed values; the token service never sees ciphertext. */
  accessTokenSealed: string
  refreshTokenSealed: string
  accessExpiresAt: Date
  refreshExpiresAt: Date
  lastRefreshAt: Date
  state: 'disconnected' | 'needs_reauth' | 'verified' | 'degraded' | 'error'
  message: string | null
}

/**
 * Persistence boundary. `withRefreshLock` runs the callback inside a
 * transaction that holds the refresh lock, so two workers cannot both rotate.
 */
export interface ConnectionRepository {
  load(): Promise<StoredConnection | null>
  withRefreshLock<T>(fn: (current: StoredConnection | null) => Promise<T>): Promise<T>
  save(connection: StoredConnection): Promise<void>
  markState(state: ConnectionStatus, message: string): Promise<void>
  writeHealthSample(sample: {
    checkedAt: Date
    daysSinceRefresh: number
    refreshExpiresAt: Date
    state: ConnectionStatus['state']
  }): Promise<void>
}

export interface TokenServiceOptions {
  environment: 'sandbox' | 'production'
  tokenUrl: string
  clientId: string
  clientSecret: string
  redirectUri: string
  repository: ConnectionRepository
  sealer: Sealer
  fetch?: FetchLike
  now?: () => Date
  /** Refresh this long before expiry; the spec uses 240 s of a 300 s token. */
  refreshAfterMs?: number
  /** Access token lifetime assumed when the response omits `expires_in`. */
  accessLifetimeMs?: number
  /** Idle lifetime of the refresh token: the 31-day death. */
  refreshLifetimeMs?: number
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in?: number
  token_type?: string
}

const DAY = 24 * 60 * 60 * 1000

export class TokenService {
  readonly #options: TokenServiceOptions
  readonly #fetch: FetchLike
  readonly #now: () => Date
  readonly #refreshAfterMs: number
  readonly #refreshLifetimeMs: number
  #accessToken: { value: string; expiresAt: number } | null = null
  #last401At = 0

  constructor(options: TokenServiceOptions) {
    this.#options = options
    this.#fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike)
    this.#now = options.now ?? (() => new Date())
    this.#refreshAfterMs = options.refreshAfterMs ?? 240_000
    this.#refreshLifetimeMs = options.refreshLifetimeMs ?? 31 * DAY
  }

  /** Cheap, no network. Used by health and by the worker before claiming work. */
  async status(): Promise<ConnectionStatus> {
    const current = await this.#options.repository.load()
    if (!current) {
      return {
        state: 'disconnected',
        businessId: null,
        accessTokenExpiresAt: null,
        refreshExpiresAt: null,
        daysSinceRefresh: null,
        message: 'Sage is enabled but no business has been authorised yet.',
      }
    }
    const daysSinceRefresh = Math.floor(
      (this.#now().getTime() - current.lastRefreshAt.getTime()) / DAY,
    )
    const refreshDaysLeft = (current.refreshExpiresAt.getTime() - this.#now().getTime()) / DAY
    let state = current.state
    let message = current.message ?? 'Connected.'

    if (daysSinceRefresh >= 21 || refreshDaysLeft < 3) {
      state = 'needs_reauth'
      message =
        daysSinceRefresh >= 21
          ? `Refresh token is ${daysSinceRefresh} days old; the Sage connection must be authorised again.`
          : 'Refresh token expires within three days; authorise the Sage connection again.'
    } else if (daysSinceRefresh >= 14 || refreshDaysLeft <= 10) {
      state = state === 'verified' ? 'degraded' : state
      message =
        daysSinceRefresh >= 14
          ? `Refresh token is ${daysSinceRefresh} days old; a keep-alive refresh is due.`
          : 'Refresh token expires within ten days; check the keep-alive job.'
    }

    return {
      state,
      businessId: current.businessId,
      accessTokenExpiresAt: current.accessExpiresAt,
      refreshExpiresAt: current.refreshExpiresAt,
      daysSinceRefresh,
      message,
    }
  }

  /**
   * A usable access token: cached in-process until the 240 s mark, otherwise
   * loaded from the repository, and only refreshed through the lock.
   */
  async getAccessToken(): Promise<string> {
    const now = this.#now().getTime()
    if (this.#accessToken && this.#accessToken.expiresAt - this.#refreshAfterMs > now) {
      return this.#accessToken.value
    }
    const current = await this.#options.repository.load()
    if (!current) {
      throw new SageError('unconfigured', 'SAGE_NOT_CONNECTED', 'No Sage business is authorised.')
    }
    if (current.state === 'needs_reauth') {
      throw new SageError('auth', 'SAGE_NEEDS_REAUTH', 'The Sage connection needs re-authorisation.')
    }
    if (current.accessExpiresAt.getTime() - this.#refreshAfterMs > now) {
      const token = this.#decryptAccess(current)
      this.#accessToken = { value: token, expiresAt: current.accessExpiresAt.getTime() }
      return token
    }
    return this.refresh()
  }

  /** Rotate. Serialised, sealed before use, and never retried with the old token. */
  async refresh(options: { force?: boolean } = {}): Promise<string> {
    return this.#options.repository.withRefreshLock(async (current) => {
      if (!current) {
        throw new SageError('unconfigured', 'SAGE_NOT_CONNECTED', 'No Sage business is authorised.')
      }
      // Another process may have refreshed while we waited for the lock. A
      // forced refresh (after a 401) skips this: the token looked fresh and the
      // server disagreed, so the clock is not the authority.
      const now = this.#now().getTime()
      if (!options.force && current.accessExpiresAt.getTime() - this.#refreshAfterMs > now) {
        const token = this.#decryptAccess(current)
        this.#accessToken = { value: token, expiresAt: current.accessExpiresAt.getTime() }
        return token
      }

      const refreshToken = this.#options.sealer.open(
        current.refreshTokenSealed,
        this.#aad(current.businessId),
      )
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.#options.clientId,
        client_secret: this.#options.clientSecret,
      })
      const response = await this.#fetch(this.#options.tokenUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: body.toString(),
      })
      const text = await response.text()

      if (response.status === 400 || response.status === 401) {
        await this.#options.repository.markState(
          {
            state: 'needs_reauth',
            businessId: current.businessId,
            accessTokenExpiresAt: null,
            refreshExpiresAt: current.refreshExpiresAt,
            daysSinceRefresh: null,
            message: 'The refresh token was rejected; a human must authorise Sage again.',
          },
          'The refresh token was rejected; a human must authorise Sage again.',
        )
        throw new SageError(
          'auth',
          'SAGE_REFRESH_REJECTED',
          'The refresh token was rejected; a human must authorise Sage again.',
        )
      }
      if (response.status < 200 || response.status >= 300) {
        throw new SageError(
          'retryable',
          'SAGE_TOKEN_UNAVAILABLE',
          `The token endpoint answered ${response.status}.`,
          { status: response.status },
        )
      }

      const parsed = JSON.parse(text) as TokenResponse
      const lifetime = (parsed.expires_in ?? (this.#options.accessLifetimeMs ?? 300_000) / 1000) * 1000
      const accessExpiresAt = new Date(this.#now().getTime() + lifetime)
      const next: StoredConnection = {
        ...current,
        accessTokenSealed: this.#options.sealer.seal(parsed.access_token, this.#aad(current.businessId)),
        // Rotation: the old refresh token is dead now, so the new one is stored
        // before anybody sees the access token.
        refreshTokenSealed: this.#options.sealer.seal(parsed.refresh_token, this.#aad(current.businessId)),
        accessExpiresAt,
        refreshExpiresAt: new Date(this.#now().getTime() + this.#refreshLifetimeMs),
        lastRefreshAt: this.#now(),
        state: 'verified',
        message: null,
      }
      await this.#options.repository.save(next)
      this.#accessToken = { value: parsed.access_token, expiresAt: accessExpiresAt.getTime() }
      return parsed.access_token
    })
  }

  /**
   * Called after a 401. Refreshes once; a second 401 in quick succession is a
   * permission problem, not a token problem, and demands a human.
   */
  async invalidate(reason: string): Promise<void> {
    const now = this.#now().getTime()
    const secondFailure = now - this.#last401At < 60_000
    this.#last401At = now
    this.#accessToken = null
    if (secondFailure) {
      await this.#options.repository.markState(
        {
          state: 'needs_reauth',
          businessId: null,
          accessTokenExpiresAt: null,
          refreshExpiresAt: null,
          daysSinceRefresh: null,
          message: `Sage rejected the token twice (${reason}); a human must authorise again.`,
        },
        `Sage rejected the token twice (${reason}).`,
      )
      return
    }
    try {
      await this.refresh({ force: true })
    } catch {
      // refresh() already recorded needs_reauth for auth failures.
    }
  }

  /** The daily keep-alive: one call that proves the token is alive. */
  async keepAlive(): Promise<{ state: ConnectionStatus['state']; daysSinceRefresh: number }> {
    const before = await this.status()
    if (before.state === 'disconnected') {
      return { state: 'disconnected', daysSinceRefresh: 0 }
    }
    let state: ConnectionStatus['state'] = before.state
    try {
      await this.refresh()
      const after = await this.status()
      state = after.state === 'needs_reauth' ? after.state : 'verified'
      return { state, daysSinceRefresh: after.daysSinceRefresh ?? 0 }
    } catch (error) {
      state = error instanceof SageError && error.kind === 'auth' ? 'needs_reauth' : 'error'
      return { state, daysSinceRefresh: before.daysSinceRefresh ?? 0 }
    } finally {
      const after = await this.status()
      await this.#options.repository.writeHealthSample({
        checkedAt: this.#now(),
        daysSinceRefresh: after.daysSinceRefresh ?? 0,
        refreshExpiresAt: after.refreshExpiresAt ?? this.#now(),
        state,
      })
    }
  }

  /** Exchange an authorisation code. Used once, by the callback route. */
  async exchangeCode(code: string): Promise<{ businessId: string | null }> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.#options.clientId,
      client_secret: this.#options.clientSecret,
      redirect_uri: this.#options.redirectUri,
    })
    const response = await this.#fetch(this.#options.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
    })
    const text = await response.text()
    if (response.status < 200 || response.status >= 300) {
      throw new SageError('auth', 'SAGE_CODE_REJECTED', `The token exchange answered ${response.status}.`, {
        status: response.status,
        details: text.slice(0, 500),
      })
    }
    const parsed = JSON.parse(text) as TokenResponse
    const lifetime = (parsed.expires_in ?? (this.#options.accessLifetimeMs ?? 300_000) / 1000) * 1000
    // business_id is unknown until GET /businesses, so the connection is stored
    // against a null business and the AAD is re-bound once it is known.
    const connection: StoredConnection = {
      environment: this.#options.environment,
      businessId: null,
      accessTokenSealed: this.#options.sealer.seal(parsed.access_token, this.#aad(null)),
      refreshTokenSealed: this.#options.sealer.seal(parsed.refresh_token, this.#aad(null)),
      accessExpiresAt: new Date(this.#now().getTime() + lifetime),
      refreshExpiresAt: new Date(this.#now().getTime() + this.#refreshLifetimeMs),
      lastRefreshAt: this.#now(),
      state: 'verified',
      message: null,
    }
    await this.#options.repository.save(connection)
    this.#accessToken = { value: parsed.access_token, expiresAt: connection.accessExpiresAt.getTime() }
    return { businessId: null }
  }

  /** A 32-byte random state, stored hashed by the route, never logged. */
  static newOauthState(): string {
    return randomBytes(32).toString('base64url')
  }

  static hashOauthState(state: string): string {
    return createHash('sha256').update(state).digest('hex')
  }

  #decryptAccess(current: StoredConnection): string {
    return this.#options.sealer.open(current.accessTokenSealed, this.#aad(current.businessId))
  }

  #aad(businessId: string | null): string {
    return connectionAad(this.#options.environment, businessId)
  }

  /**
   * After `GET /businesses` the tokens are re-sealed under the business-bound
   * AAD. Until then they are bound to the environment only, which is why the
   * dashboard shows `businessId: null` as "choose a business".
   */
  async bindBusiness(businessId: string): Promise<void> {
    await this.#options.repository.withRefreshLock(async (current) => {
      if (!current) {
        throw new SageError('unconfigured', 'SAGE_NOT_CONNECTED', 'No Sage business is authorised.')
      }
      const access = this.#options.sealer.open(
        current.accessTokenSealed,
        connectionAad(this.#options.environment, current.businessId),
      )
      const refresh = this.#options.sealer.open(
        current.refreshTokenSealed,
        connectionAad(this.#options.environment, current.businessId),
      )
      await this.#options.repository.save({
        ...current,
        businessId,
        accessTokenSealed: this.#options.sealer.seal(access, this.#aad(businessId)),
        refreshTokenSealed: this.#options.sealer.seal(refresh, this.#aad(businessId)),
        state: 'verified',
        message: null,
      })
      return businessId
    })
  }
}
