/**
 * The Sage authorisation-code flow.
 *
 * Two calls, both human-driven and both rare:
 *
 * - `beginAuthorisation` stores a hashed `state` (single use, ten minutes) and
 *   returns the URL the browser is sent to.
 * - `completeAuthorisation` verifies the state, exchanges the code, and asks
 *   `GET /businesses` which company this is. If more than one business is
 *   returned it does **not** guess: the connection stays with a null business and
 *   the operator is told to choose. Posting to the wrong set of books is the one
 *   mistake that cannot be reconciled away.
 */
import { createHash } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { getDb } from '@cls/db'
import { sageOauthStates } from '@cls/db/schema'
import { SageError, TokenService } from '@cls/sage'
import { getTokenService, sageConfig } from './gateway.server'

const STATE_TTL_MS = 10 * 60 * 1000

export function authorisationUrl(state: string): string {
  const config = sageConfig()
  if (!config.clientId || !config.redirectUri) {
    throw new SageError(
      'unconfigured',
      'SAGE_NOT_CONFIGURED',
      'Sage is enabled but SAGE_CLIENT_ID and SAGE_REDIRECT_URI are not set.',
    )
  }
  const url = new URL(config.authBaseUrl)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'full_access')
  url.searchParams.set('state', state)
  return url.toString()
}

export async function beginAuthorisation(requestedBy: string): Promise<string> {
  const config = sageConfig()
  const state = TokenService.newOauthState()
  const db = getDb()
  await db.insert(sageOauthStates).values({
    stateHash: sha256(state),
    environment: config.environment,
    requestedBy,
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  })
  return authorisationUrl(state)
}

export interface AuthorisationOutcome {
  connected: boolean
  businessId: string | null
  businesses: { id: string; name: string }[]
  message: string
}

export async function completeAuthorisation(input: {
  code: string
  state: string
  fetch?: typeof globalThis.fetch
}): Promise<AuthorisationOutcome> {
  const config = sageConfig()
  const db = getDb()

  // Single use: the update is the check, so a replayed state matches nothing.
  const consumed = await db
    .update(sageOauthStates)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(sageOauthStates.stateHash, sha256(input.state)),
        isNull(sageOauthStates.usedAt),
        gt(sageOauthStates.expiresAt, new Date()),
      ),
    )
    .returning({ environment: sageOauthStates.environment })
  if (consumed.length === 0) {
    throw new SageError(
      'auth',
      'SAGE_STATE_REJECTED',
      'That authorisation request expired or was already used. Start the connection again.',
    )
  }

  const tokens = getTokenService()
  await tokens.exchangeCode(input.code)

  const accessToken = await tokens.getAccessToken()
  const fetchImpl = input.fetch ?? globalThis.fetch
  const response = await fetchImpl(`${config.apiBaseUrl}/businesses`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
  })
  if (!response.ok) {
    throw new SageError(
      'retryable',
      'SAGE_BUSINESS_LOOKUP_FAILED',
      `Sage authorised the app but the business lookup answered ${response.status}.`,
    )
  }
  const body = (await response.json()) as { $items?: { id: string; name: string }[] }
  const businesses = body.$items ?? []

  if (businesses.length === 1 && businesses[0]) {
    await tokens.bindBusiness(businesses[0].id)
    return {
      connected: true,
      businessId: businesses[0].id,
      businesses,
      message: `Connected to ${businesses[0].name}.`,
    }
  }
  if (businesses.length === 0) {
    return {
      connected: false,
      businessId: null,
      businesses,
      message: 'Sage authorised the app but returned no businesses. Check the developer app permissions.',
    }
  }
  return {
    connected: false,
    businessId: null,
    businesses,
    message:
      'This app can reach more than one Sage business. Choose the one to post to before any invoice is issued.',
  }
}

/** Records the operator's choice when the tenant has more than one business. */
export async function selectBusiness(businessId: string): Promise<void> {
  await getTokenService().bindBusiness(businessId)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
