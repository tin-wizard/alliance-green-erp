/**
 * Server-only auth implementation.
 *
 * Password checking and session management belong to Neon Auth (Managed Better
 * Auth). This module verifies the returned JWT, maps it to an application user,
 * enforces enablement, seals the app cookie and writes audit rows.
 *
 * Imported dynamically from handler bodies in `auth.functions.ts`, so the
 * TanStack Start client build never includes the verifier or the database.
 */
import { eq, or, sql } from 'drizzle-orm'
import {
  AppError,
  ForbiddenError,
  ServiceUnavailableError,
  UnauthorizedError,
} from '@cls/core'
import { getConfig } from '@cls/core/env.server'
import { getDb } from '@cls/db'
import { users, type User } from '@cls/db/schema'
import {
  consumeRateLimit,
  getNeonAuth,
  NeonAuthError,
  sealSession,
  unsealSession,
  writeAudit,
} from '@cls/auth'
import { deleteCookie, getCookie, getRequestHeaders, setCookie } from '@tanstack/react-start/server'
import type { AuthSessionView, SessionView } from './auth.types'
import type { LoginInput } from './auth.schemas'

const RATE_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 }
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function clientContext() {
  const headers = getRequestHeaders()
  const forwarded = headers.get('x-forwarded-for')
  return {
    ip: forwarded ? (forwarded.split(',')[0]?.trim() ?? null) : headers.get('x-real-ip'),
    userAgent: headers.get('user-agent'),
  }
}

function neonFailure(error: unknown): never {
  if (error instanceof NeonAuthError && error.status === 401) {
    throw new UnauthorizedError('Invalid username or password.')
  }
  throw new ServiceUnavailableError(
    'Neon Auth',
    error instanceof Error ? error.message : 'Neon Auth is unavailable.',
  )
}

async function findByIdentifier(identifier: string): Promise<User | undefined> {
  const db = getDb()
  const rows = await db
    .select()
    .from(users)
    .where(
      or(
        eq(sql`lower(${users.username})`, identifier.toLowerCase()),
        eq(sql`lower(${users.email})`, identifier.toLowerCase()),
      ),
    )
    .limit(1)
  return rows[0]
}

export async function authenticate(input: LoginInput): Promise<void> {
  const config = getConfig()
  const db = getDb()
  const { ip, userAgent } = clientContext()
  const identifier = input.identifier.trim()

  const limit = consumeRateLimit(
    `login:${ip ?? 'unknown'}:${identifier.toLowerCase()}`,
    RATE_LIMIT,
  )
  if (!limit.allowed) {
    throw new AppError(
      'rate_limited',
      `Too many login attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
      429,
    )
  }

  const candidate = await findByIdentifier(identifier)
  const email = candidate?.email ?? (EMAIL_PATTERN.test(identifier) ? identifier : undefined)

  if (!email) {
    await writeAudit(db, {
      action: 'auth.login_failed',
      actorLabel: identifier,
      summary: 'No account matches that username',
      ip,
      userAgent,
    }).catch(() => undefined)
    throw new UnauthorizedError('Invalid username or password.')
  }

  if (candidate && !candidate.isEnabled) {
    await writeAudit(db, {
      action: 'auth.login_failed',
      actorUserId: candidate.id,
      actorLabel: candidate.username,
      actorRole: candidate.role,
      summary: 'Disabled account',
      ip,
      userAgent,
    }).catch(() => undefined)
    throw new ForbiddenError('This account is disabled. Contact an administrator.')
  }

  let session
  try {
    session = await getNeonAuth().signIn(email, input.password)
  } catch (error) {
    await writeAudit(db, {
      action: 'auth.login_failed',
      actorUserId: candidate?.id ?? null,
      actorLabel: identifier,
      actorRole: candidate?.role ?? null,
      summary: error instanceof NeonAuthError && error.status === 401 ? 'Bad credentials' : 'Auth provider error',
      ip,
      userAgent,
    }).catch(() => undefined)
    neonFailure(error)
  }

  const claims = session.claims
  let user = candidate

  // First sign-in for the bootstrap administrator: create the app row that
  // owns role and enablement. This is the only automatic provisioning path and
  // it requires an explicitly configured address plus a verified Neon email.
  const seedEmail = config.seedAdmin.email
  if (
    !user &&
    seedEmail &&
    email.toLowerCase() === seedEmail.toLowerCase() &&
    claims.emailVerified === true
  ) {
    const [created] = await db
      .insert(users)
      .values({
        neonUserId: claims.sub,
        email,
        username: config.seedAdmin.username,
        displayName: claims.name ?? config.seedAdmin.displayName,
        role: 'admin',
        lastLoginAt: new Date(),
      })
      .onConflictDoNothing()
      .returning()
    user =
      created ??
      (await db.select().from(users).where(eq(users.neonUserId, claims.sub)).limit(1))[0]
  }

  if (!user) {
    await writeAudit(db, {
      action: 'auth.login_denied',
      actorLabel: claims.email ?? email,
      summary: 'Authenticated with Neon Auth but not provisioned in the application',
      ip,
      userAgent,
    }).catch(() => undefined)
    throw new ForbiddenError(
      'You signed in, but this account is not provisioned. Ask an administrator to add you.',
    )
  }

  if (user.neonUserId && user.neonUserId !== claims.sub) {
    await writeAudit(db, {
      action: 'auth.login_denied',
      actorUserId: user.id,
      actorLabel: user.username,
      actorRole: user.role,
      summary: 'Neon identity does not match the linked application user',
      ip,
      userAgent,
    }).catch(() => undefined)
    throw new UnauthorizedError('This identity is already linked to another account.')
  }

  const [updated] = await db
    .update(users)
    .set({
      neonUserId: claims.sub,
      lastLoginAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id))
    .returning()

  const sealed = sealSession(config.session.secret, {
    cookie: session.cookie,
    jwt: session.jwt,
    expiresAt: Date.now() + config.session.ttlHours * 60 * 60 * 1000,
  })

  setCookie(config.session.cookieName, sealed, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.session.cookieSecure,
    path: '/',
    maxAge: config.session.ttlHours * 60 * 60,
  })

  await writeAudit(db, {
    action: 'auth.login',
    actorUserId: updated?.id ?? user.id,
    actorLabel: user.username,
    actorRole: user.role,
    entityType: 'session',
    summary: 'Signed in via Neon Auth',
    ip,
    userAgent,
  }).catch(() => undefined)
}

export async function endSession(session: AuthSessionView | null): Promise<void> {
  const config = getConfig()
  const { ip, userAgent } = clientContext()
  const sealed = getCookie(config.session.cookieName)
  const payload = unsealSession(config.session.secret, sealed)

  if (payload) {
    await getNeonAuth()
      .signOut(payload.cookie)
      .catch(() => undefined)

    await writeAudit(getDb(), {
      action: 'auth.logout',
      actorUserId: session?.user.id ?? null,
      actorLabel: session?.user.username ?? null,
      actorRole: session?.user.role ?? null,
      entityType: 'session',
      summary: 'Signed out',
      ip,
      userAgent,
    }).catch(() => undefined)
  }

  deleteCookie(config.session.cookieName, { path: '/' })
}

export function sessionView(session: AuthSessionView): SessionView {
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      username: session.user.username,
      displayName: session.user.displayName,
      role: session.user.role,
      subcontractorId: session.user.subcontractorId,
      grants: session.user.grants,
    },
    expiresAt: session.expiresAt.toISOString(),
  }
}
