import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { Role } from '@cls/core'
import { ServiceUnavailableError } from '@cls/core'
import { getConfig } from '@cls/core/env.server'
import { getDb } from '@cls/db'
import { rolePermissions, userPermissions, users } from '@cls/db/schema'
import { evaluatePermissions, type EffectiveGrant } from './permissions'
import { readCookie } from './session-token'
import { unsealSession } from './session-cookie'
import { NeonAuthClient, type NeonClaims } from './neon-auth'

/**
 * Session loading. SERVER ONLY.
 *
 * The Neon Auth JWT is verified on every request. If it has expired (the
 * provider issues 15-minute tokens), the stored Neon session cookie is used to
 * obtain a fresh one. A short in-memory cache avoids one provider call per
 * request; it holds no data of its own.
 */
export interface SessionUser {
  id: string
  email: string
  username: string
  displayName: string
  role: Role
  subcontractorId: number | null
  grants: EffectiveGrant[]
}

export interface AuthSession {
  id: string
  expiresAt: Date
  lastSeenAt: Date
  user: SessionUser
}

let neonClient: NeonAuthClient | undefined
let neonBaseUrl: string | undefined

export function isNeonAuthConfigured(): boolean {
  return Boolean(getConfig().neonAuth.baseUrl)
}

export function getNeonAuth(): NeonAuthClient {
  const config = getConfig().neonAuth
  if (!config.baseUrl) {
    throw new ServiceUnavailableError(
      'Neon Auth',
      'Neon Auth is not configured. Set NEON_AUTH_BASE_URL and NEON_AUTH_JWKS_URL.',
    )
  }
  if (!neonClient || neonBaseUrl !== config.baseUrl) {
    neonClient = new NeonAuthClient({
      baseUrl: config.baseUrl,
      jwksUrl: config.jwksUrl,
      origin: getConfig().appUrl,
    })
    neonBaseUrl = config.baseUrl
  }
  return neonClient
}

export function resetNeonAuthForTests(): void {
  neonClient = undefined
  neonBaseUrl = undefined
  refreshed.clear()
}

const REFRESH_TTL_MS = 10 * 60 * 1000
const refreshed = new Map<string, { jwt: string; claims: NeonClaims; at: number }>()

function cacheKey(cookie: string): string {
  // The cookie contains a session token; never use it as a map key verbatim.
  return createHash('sha256').update(cookie).digest('hex')
}

async function claimsFor(session: { cookie: string; jwt: string }): Promise<NeonClaims> {
  const client = getNeonAuth()
  try {
    return await client.verifyJwt(session.jwt)
  } catch {
    const key = cacheKey(session.cookie)
    const cached = refreshed.get(key)
    if (cached && Date.now() - cached.at < REFRESH_TTL_MS) return cached.claims

    const next = await client.refreshSession(session.cookie)
    refreshed.set(key, { jwt: next.jwt, claims: next.claims, at: Date.now() })
    return next.claims
  }
}

export async function loadEffectiveGrants(
  db: ReturnType<typeof getDb>,
  userId: string,
  role: Role,
): Promise<EffectiveGrant[]> {
  const [roleRows, userRows] = await Promise.all([
    db
      .select({ permissionKey: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(eq(rolePermissions.role, role)),
    db
      .select({
        permissionKey: userPermissions.permissionKey,
        isAllowed: userPermissions.isAllowed,
        expiresAt: userPermissions.expiresAt,
        scopeSubcontractorId: userPermissions.scopeSubcontractorId,
      })
      .from(userPermissions)
      .where(eq(userPermissions.userId, userId)),
  ])

  return evaluatePermissions({
    role,
    roleGrants: roleRows.map((row) => row.permissionKey),
    userGrants: userRows,
  })
}

export type AppUser = typeof users.$inferSelect

/**
 * Maps verified Neon claims to the application user.
 *
 * The provider owns identity; this table owns role, enablement and profile.
 * A user is linked by `neon_user_id`, or by email when an admin provisioned the
 * row before the person first signed in. An unknown email is not auto-created
 * here; provisioning is an explicit decision in `authenticate`.
 */
export async function resolveAppUser(claims: NeonClaims): Promise<AppUser | null> {
  const db = getDb()
  const byNeon = await db
    .select()
    .from(users)
    .where(eq(users.neonUserId, claims.sub))
    .limit(1)
  if (byNeon[0]) return byNeon[0]

  if (!claims.email) return null
  // Linking an invited row by email requires a verified address, otherwise
  // anyone who signs up with that address could claim the invitation.
  if (claims.emailVerified !== true) return null
  const byEmail = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${claims.email})`)
    .limit(1)
  const candidate = byEmail[0]
  if (!candidate) return null
  if (candidate.neonUserId && candidate.neonUserId !== claims.sub) return null

  const [linked] = await db
    .update(users)
    .set({
      neonUserId: claims.sub,
      lastLoginAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, candidate.id))
    .returning()
  return linked ?? null
}

export async function loadSessionFromRequest(request: Request): Promise<AuthSession | null> {
  const config = getConfig()
  const sealed = readCookie(request.headers.get('cookie'), config.session.cookieName)
  const session = unsealSession(config.session.secret, sealed)
  if (!session || session.expiresAt <= Date.now()) return null
  if (!isNeonAuthConfigured()) return null

  let claims: NeonClaims
  try {
    claims = await claimsFor(session)
  } catch {
    return null
  }

  const user = await resolveAppUser(claims)
  if (!user || !user.isEnabled) return null

  const grants = await loadEffectiveGrants(getDb(), user.id, user.role)

  return {
    id: claims.sub,
    expiresAt: new Date(session.expiresAt),
    lastSeenAt: new Date(),
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      subcontractorId: user.subcontractorId,
      grants,
    },
  }
}
