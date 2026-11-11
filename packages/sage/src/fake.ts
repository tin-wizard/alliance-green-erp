/**
 * Adapters that make no network call at all.
 *
 * `UnconfiguredSageAdapter` is what the app resolves when Sage is enabled but
 * has no credentials, or when it is disabled. It exists so that "we have not
 * connected Sage yet" is a state with a message, not a crash and not a silent
 * fallback to the fake gateway. Production refuses `SAGE_FAKE=true` outright.
 */
import type { SageAdapter, SageHealth, SageHealthStatus } from './types'
import type { SageQuotaSnapshot } from './types'

export class UnconfiguredSageAdapter implements SageAdapter {
  readonly name = 'sage-unconfigured'
  readonly #status: SageHealthStatus
  readonly #message: string
  readonly #environment: 'sandbox' | 'production'

  constructor(options: {
    status: SageHealthStatus
    message: string
    environment: 'sandbox' | 'production'
  }) {
    this.#status = options.status
    this.#message = options.message
    this.#environment = options.environment
  }

  async health(): Promise<SageHealth> {
    const quota: SageQuotaSnapshot = {
      used: 0,
      limit: 0,
      resetsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }
    return {
      status: this.#status,
      checkedAt: new Date(),
      environment: this.#environment,
      businessId: null,
      accessTokenExpiresAt: null,
      refreshExpiresAt: null,
      tokenAgeDays: null,
      quota,
      message: this.#message,
    }
  }
}

/**
 * The development sandbox. It answers health without a tenant and leaves
 * posting to the in-memory `FakeSageInvoiceGateway`, which is scriptable for
 * faults and is the implementation the invoicing tests run against.
 */
export class FakeSageAdapter implements SageAdapter {
  readonly name = 'sage-fake'
  #status: SageHealthStatus = 'verified'
  #message = 'Fake Sage adapter: no network calls are made.'

  setState(status: SageHealthStatus, message?: string): void {
    this.#status = status
    if (message) this.#message = message
  }

  async health(): Promise<SageHealth> {
    return {
      status: this.#status,
      checkedAt: new Date(),
      environment: 'sandbox',
      businessId: 'business_fake',
      accessTokenExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      refreshExpiresAt: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000),
      tokenAgeDays: 0,
      quota: {
        used: 0,
        limit: 2500,
        resetsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
      message: this.#message,
    }
  }
}

/** An environment guard, not a convention: the fake cannot reach production. */
export function assertFakeAllowed(input: {
  nodeEnv: string | undefined
  fake: boolean
  environment: 'sandbox' | 'production'
}): void {
  if (input.nodeEnv === 'production' && input.fake) {
    throw new Error('SAGE_FAKE=true is refused in production; configure the real credentials instead.')
  }
  if (input.nodeEnv === 'production' && input.environment === 'sandbox') {
    throw new Error('SAGE_ENVIRONMENT=sandbox is refused in production.')
  }
}
