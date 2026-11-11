/**
 * Neon Auth (Managed Better Auth) client and JWT verification.
 *
 * SERVER ONLY. Uses the REST API rather than the browser SDK:
 *  - the LAN app is served over HTTP, where the SDK's Secure/SameSite=None
 *    session cookie is rejected by browsers on a LAN IP;
 *  - the server needs the raw JWT anyway to verify it against the JWKS.
 *
 * Identity and passwords live in `neon_auth` in the Neon Postgres database.
 * This module never stores a password or a password hash.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

export interface NeonAuthConfig {
  baseUrl: string
  jwksUrl?: string | undefined
  /** Public app origin; Better Auth requires it on state-changing requests. */
  origin?: string | undefined
  timeoutMs?: number
}

export interface NeonClaims extends JWTPayload {
  sub: string
  email?: string
  name?: string
  emailVerified?: boolean
}

export interface NeonUser {
  id: string
  email: string
  name: string | null
  emailVerified: boolean
}

export interface NeonSession {
  jwt: string
  claims: NeonClaims
  user: NeonUser
  /** `name=value` pair for the Neon session cookie, sent back verbatim. */
  cookie: string
}

export class NeonAuthError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 502) {
    super(message)
    this.name = 'NeonAuthError'
    this.code = code
    this.status = status
  }
}

interface SignInResponse {
  token?: string
  session?: { token?: string; access_token?: string }
  user?: { id?: string; email?: string; name?: string; emailVerified?: boolean }
}

const SESSION_COOKIE_HINT = 'session_token'

function sessionCookieFrom(response: Response): string | undefined {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';')
    if (pair && pair.includes(SESSION_COOKIE_HINT)) return pair
  }
  return undefined
}

function jwtFrom(response: Response, body: unknown): string | undefined {
  const header = response.headers.get('set-auth-jwt')
  if (header) return header
  const parsed = body as SignInResponse | null
  return parsed?.token ?? parsed?.session?.token ?? parsed?.session?.access_token
}

function mapUser(input: SignInResponse['user'], claims: NeonClaims): NeonUser {
  return {
    id: input?.id ?? claims.sub,
    email: input?.email ?? claims.email ?? '',
    name: input?.name ?? claims.name ?? null,
    emailVerified: input?.emailVerified ?? claims.emailVerified ?? false,
  }
}

export class NeonAuthClient {
  readonly baseUrl: string
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>
  private readonly issuer: string
  private readonly origin: string
  private readonly timeoutMs: number

  constructor(config: NeonAuthConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.issuer = new URL(config.baseUrl).origin
    this.origin = config.origin ?? this.issuer
    this.timeoutMs = config.timeoutMs ?? 8000
    const jwksUrl = config.jwksUrl ?? `${this.baseUrl}/.well-known/jwks.json`
    this.jwks = createRemoteJWKSet(new URL(jwksUrl), {
      timeoutDuration: this.timeoutMs,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60 * 1000,
    })
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`
  }

  /**
   * Verifies signature (EdDSA), issuer, audience and expiry. Both `iss` and
   * `aud` are the origin of the auth URL, per Neon's JWT documentation.
   */
  async verifyJwt(token: string): Promise<NeonClaims> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        algorithms: ['EdDSA'],
        issuer: this.issuer,
        audience: this.issuer,
        clockTolerance: 5,
      })
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new NeonAuthError('invalid_token', 'Token has no subject.', 401)
      }
      return payload as NeonClaims
    } catch (error) {
      if (error instanceof NeonAuthError) throw error
      throw new NeonAuthError(
        'invalid_token',
        error instanceof Error ? error.message : 'Token verification failed.',
        401,
      )
    }
  }

  /** Calls `/get-session` with the stored Neon session cookie. */
  async refreshSession(cookie: string): Promise<NeonSession> {
    const response = await fetch(this.url('/get-session'), {
      headers: { cookie, accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!response.ok) {
      throw new NeonAuthError(
        'session_expired',
        'The Neon Auth session is no longer valid.',
        response.status === 401 ? 401 : 502,
      )
    }
    const body = (await response.json()) as (SignInResponse & { session?: unknown }) | null
    if (!body) {
      throw new NeonAuthError('session_expired', 'No active Neon Auth session.', 401)
    }
    const jwt = jwtFrom(response, body)
    if (!jwt) {
      throw new NeonAuthError('invalid_token', 'Neon Auth returned no JWT for this session.', 502)
    }
    const claims = await this.verifyJwt(jwt)
    return { jwt, claims, user: mapUser(body.user, claims), cookie }
  }

  async signIn(email: string, password: string): Promise<NeonSession> {
    let response: Response
    try {
      response = await fetch(this.url('/sign-in/email'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          origin: this.origin,
        },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new NeonAuthError(
        'auth_unreachable',
        error instanceof Error ? error.message : 'Neon Auth is unreachable.',
        503,
      )
    }

    const body = (await response.json().catch(() => null)) as SignInResponse | null
    if (!response.ok) {
      const code = (body as { code?: string })?.code ?? 'sign_in_failed'
      throw new NeonAuthError(code, 'Invalid email or password.', 401)
    }

    const cookie = sessionCookieFrom(response)
    if (!cookie) {
      throw new NeonAuthError('no_session_cookie', 'Neon Auth did not return a session.', 502)
    }

    const jwt = jwtFrom(response, body)
    if (!jwt) {
      // Some deployments only expose the JWT on the session endpoint.
      return this.refreshSession(cookie)
    }

    const claims = await this.verifyJwt(jwt)
    return { jwt, claims, user: mapUser(body?.user, claims), cookie }
  }

  async signOut(cookie: string): Promise<void> {
    try {
      await fetch(this.url('/sign-out'), {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json',
          accept: 'application/json',
          origin: this.origin,
        },
        body: '{}',
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      // Best effort: the app cookie is cleared regardless.
    }
  }

  async health(): Promise<{ ok: boolean; keys: number; message: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/.well-known/jwks.json`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (!response.ok) return { ok: false, keys: 0, message: `JWKS returned ${response.status}` }
      const body = (await response.json()) as { keys?: unknown[] }
      const keys = Array.isArray(body.keys) ? body.keys.length : 0
      return { ok: keys > 0, keys, message: `Neon Auth JWKS advertises ${keys} key(s).` }
    } catch (error) {
      return {
        ok: false,
        keys: 0,
        message: error instanceof Error ? error.message : 'Neon Auth is unreachable',
      }
    }
  }
}
