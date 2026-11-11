/**
 * Sage runtime wiring.
 *
 * One place decides which adapter exists. The rules, in order:
 *
 * 1. `SAGE_ENABLED=false` → the fake gateway posts nothing anywhere and health
 *    says `disabled`. This is the default and the whole test suite.
 * 2. `SAGE_FAKE=true` outside production → the in-memory gateway, health `verified`.
 * 3. Enabled with credentials → the real cloud adapter, with the database-backed
 *    token, quota and pause stores.
 * 4. Enabled without credentials → a gateway that refuses with
 *    `SAGE_NOT_CONFIGURED`. It never falls back to the fake: a production
 *    deployment that lost its secrets must go quiet and say why, not pretend.
 */
import { getConfig } from '@cls/core/env.server'
import {
  FakeSageAdapter,
  MinuteBucket,
  PauseGovernor,
  QuotaGovernor,
  SageCloudAdapter,
  SageError,
  SageHttp,
  TokenService,
  UnconfiguredSageAdapter,
  createSealer,
  getSageInvoiceGateway,
  setSageInvoiceGateway,
  type SageInvoiceGateway,
  type SagePostingOutcome,
} from '@cls/sage'
import { dbConnectionRepository, dbPauseStore, dbQuotaStore } from './stores.server'

export function sageConfig() {
  return getConfig().sage
}

export function sageCredentialsPresent(): boolean {
  const config = sageConfig()
  return Boolean(config.clientId && config.clientSecret && config.redirectUri && config.tokenEncKey)
}

let tokenService: TokenService | undefined
let quotaGovernor: QuotaGovernor | undefined
let pauseGovernor: PauseGovernor | undefined
let adapter: SageCloudAdapter | FakeSageAdapter | UnconfiguredSageAdapter | undefined
let gateway: SageInvoiceGateway | undefined

export function getTokenService(): TokenService {
  if (tokenService) return tokenService
  const config = sageConfig()
  if (!config.clientId || !config.clientSecret || !config.redirectUri || !config.tokenEncKey) {
    throw new SageError(
      'unconfigured',
      'SAGE_NOT_CONFIGURED',
      'Sage is enabled but the developer app credentials are missing.',
    )
  }
  tokenService = new TokenService({
    environment: config.environment,
    tokenUrl: config.tokenUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
    sealer: createSealer(config.tokenEncKey),
    repository: dbConnectionRepository(config.environment),
  })
  return tokenService
}

export function getQuotaGovernor(): QuotaGovernor {
  if (quotaGovernor) return quotaGovernor
  const config = sageConfig()
  quotaGovernor = new QuotaGovernor({
    store: dbQuotaStore(),
    limit: config.dailyQuota,
    minute: new MinuteBucket({
      capacity: Math.max(1, Math.floor(config.minuteQuota * 0.9)),
    }),
  })
  return quotaGovernor
}

export function getPauseGovernor(): PauseGovernor {
  if (pauseGovernor) return pauseGovernor
  pauseGovernor = new PauseGovernor({ store: dbPauseStore(sageConfig().environment) })
  return pauseGovernor
}

/** Health: no network call when not configured, and no call when disabled. */
export function getSageHealthAdapter(): SageCloudAdapter | FakeSageAdapter | UnconfiguredSageAdapter {
  if (adapter) return adapter
  const config = sageConfig()
  if (!config.enabled) {
    adapter = new UnconfiguredSageAdapter({
      status: 'disabled',
      message: 'Sage posting is disabled (SAGE_ENABLED=false).',
      environment: config.environment,
    })
    return adapter
  }
  if (config.fake) {
    adapter = new FakeSageAdapter()
    return adapter
  }
  if (!sageCredentialsPresent()) {
    adapter = new UnconfiguredSageAdapter({
      status: 'disconnected',
      message:
        'Sage is enabled but not configured. Set SAGE_CLIENT_ID, SAGE_CLIENT_SECRET, SAGE_REDIRECT_URI and SAGE_TOKEN_ENC_KEY, then authorise the business.',
      environment: config.environment,
    })
    return adapter
  }
  adapter = buildCloudAdapter()
  return adapter
}

function buildCloudAdapter(): SageCloudAdapter {
  const config = sageConfig()
  const tokens = getTokenService()
  const pause = getPauseGovernor()
  const http = new SageHttp({
    apiBaseUrl: config.apiBaseUrl,
    businessId: () => tokens.status().then((status) => status.businessId),
    getAccessToken: () => tokens.getAccessToken(),
    onUnauthorised: (reason) => tokens.invalidate(reason),
    quota: getQuotaGovernor(),
    onRateLimited: () => getQuotaGovernor().noteRateLimited(),
  })
  return new SageCloudAdapter({
    http,
    tokens,
    quota: getQuotaGovernor(),
    pause,
    environment: config.environment,
    ledger: config.ledger,
  })
}

/** The worker's gateway. The invoicing outbox calls whichever this returns. */
export function getSagePostingGateway(): SageInvoiceGateway {
  if (gateway) return gateway
  const config = sageConfig()
  if (!config.enabled || config.fake) {
    gateway = getSageInvoiceGateway()
    return gateway
  }
  if (!sageCredentialsPresent()) {
    gateway = unconfiguredGateway()
    return gateway
  }
  gateway = buildCloudAdapter()
  return gateway
}

/** Kleene star: refuses, loudly, instead of posting to nowhere. */
function unconfiguredGateway(): SageInvoiceGateway {
  const refuse = async (): Promise<SagePostingOutcome> => {
    throw new SageError(
      'unconfigured',
      'SAGE_NOT_CONFIGURED',
      'Sage is enabled but has no credentials; the posting is held until the connection is configured.',
    )
  }
  return {
    name: 'sage-unconfigured',
    postSalesInvoice: refuse,
    postPurchaseInvoice: refuse,
    postPurchaseCreditNote: refuse,
    async findSalesInvoice() {
      return null
    },
  }
}

/**
 * Installs the chosen gateway into `@cls/sage` so the invoicing worker (which
 * imports the package, not this module) sees it. Idempotent.
 */
export function installSagePostingGateway(): SageInvoiceGateway {
  const next = getSagePostingGateway()
  if (getSageInvoiceGateway() !== next) setSageInvoiceGateway(next)
  return next
}

/** Test seam: forget every singleton so the next call re-reads the config. */
export function resetSageRuntimeForTests(): void {
  tokenService = undefined
  quotaGovernor = undefined
  pauseGovernor = undefined
  adapter = undefined
  gateway = undefined
}
