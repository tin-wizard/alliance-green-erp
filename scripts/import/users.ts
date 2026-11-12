/**
 * User migration, from `plan/CUTOVER-AND-MIGRATION.md` §6.
 *
 * Two paths, deliberately unequal:
 * - everyone with a controlled email is force-reset with a hashed, single-use,
 *   72-hour invitation;
 * - active subcontractor field staff may, for a bounded window, prove a legacy
 *   MD5 password once and have it rehashed by the provider. Nothing from the
 *   legacy credential is stored in Neon.
 *
 * The planner segments 339 subcontractor accounts before any of that, because a
 * blanket invite is how dispatch gets locked out.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Db } from '@cls/db'
import { migrationUserInvites } from '@cls/db/schema'

export const INVITE_TTL_HOURS = 72
export const BRIDGE_WINDOW_MINUTES = 15
export const BRIDGE_MAX_ATTEMPTS = 5
export const BRIDGE_LIFETIME_DAYS = 60

export type UserCohort =
  | 'unique-email'
  | 'shared-email'
  | 'no-email'
  | 'disabled'
  | 'duplicate-username'
  | 'orphan-vendor'

export type InviteState = 'pending' | 'ready' | 'sent' | 'claimed' | 'disabled' | 'blocked'

export interface StagedUser {
  legacyId: number
  username: string | null
  email: string | null
  enabled: boolean
  subid: number | null
  /** The legacy username appears more than once, case-insensitively. */
  duplicateUsername: boolean
  /** `subid` names a vendor row that exists in staging. */
  vendorExists: boolean
  /** Normalised email is used by more than one non-disabled account. */
  sharedEmail: boolean
}

export interface UserPlanRow {
  legacyId: number
  cohort: UserCohort
  state: InviteState
  emailHash: string | null
  note: string
}

export function normaliseEmail(email: string | null): string | null {
  const trimmed = (email ?? '').trim().toLowerCase()
  return trimmed === '' ? null : trimmed
}

export function emailHash(email: string | null): string | null {
  const normalised = normaliseEmail(email)
  return normalised === null ? null : createHash('sha256').update(normalised, 'utf8').digest('hex')
}

/**
 * The order matters: disabled wins over everything (no credential, no invite),
 * then duplicates (no credential until resolved), then the vendor link (a wrong
 * scope is a security defect), then the email cohorts.
 */
export function classifyCohort(user: StagedUser): UserCohort {
  if (!user.enabled) return 'disabled'
  if (user.duplicateUsername) return 'duplicate-username'
  if (user.subid !== null && !user.vendorExists) return 'orphan-vendor'
  if (normaliseEmail(user.email) === null) return 'no-email'
  if (user.sharedEmail) return 'shared-email'
  return 'unique-email'
}

export function stateForCohort(cohort: UserCohort): InviteState {
  switch (cohort) {
    case 'unique-email':
      return 'ready'
    case 'disabled':
      return 'disabled'
    case 'shared-email':
      return 'pending'
    default:
      return 'blocked'
  }
}

export function planRow(user: StagedUser): UserPlanRow {
  const cohort = classifyCohort(user)
  const notes: Record<UserCohort, string> = {
    'unique-email': 'Force reset: invite with a hashed single-use link.',
    'shared-email': 'Office-assisted onboarding: never a shared password.',
    'no-email': 'Identity verified by phone, one-time code from the office.',
    disabled: 'Migrated disabled. No credential and no invite.',
    'duplicate-username': 'Resolve the duplicate before any invite; one canonical account.',
    'orphan-vendor': 'No vendor row for subid. Resolve with Sage before inviting.',
  }
  return {
    legacyId: user.legacyId,
    cohort,
    state: stateForCohort(cohort),
    emailHash: emailHash(user.email),
    note: notes[cohort],
  }
}

/**
 * Planner over staging. It never selects a password column: the query lists the
 * columns it wants, and `guardNoPasswordColumns` fails the test suite if a
 * password column ever appears in that list.
 */
export async function loadStagedUsers(db: Db, dumpId: string): Promise<StagedUser[]> {
  const rows = (await db.execute(sql`
    select
      u."id" as legacy_id,
      u."username" as username,
      u."email" as email,
      coalesce(u."is_enabled", '1') as is_active,
      u."subid" as subid
    from migration."stg_users" u
    where u."_dump_id" = ${dumpId}
    order by u."_row_no"
  `)) as unknown as Array<{
    legacy_id: string | null
    username: string | null
    email: string | null
    is_active: string | null
    subid: string | null
  }>

  const usernames = new Map<string, number>()
  for (const row of rows) {
    const key = (row.username ?? '').trim().toLowerCase()
    if (key === '') continue
    usernames.set(key, (usernames.get(key) ?? 0) + 1)
  }
  const emails = new Map<string, number>()
  for (const row of rows) {
    if (row.is_active === '0') continue
    const key = normaliseEmail(row.email)
    if (key === null) continue
    emails.set(key, (emails.get(key) ?? 0) + 1)
  }

  const vendorIds = new Set(
    ((await db.execute(sql`
      select "id" from migration."stg_subcontractor" where "_dump_id" = ${dumpId}
    `)) as unknown as Array<{ id: string | null }>).map((row) => row.id ?? ''),
  )

  return rows.map((row) => {
    const username = (row.username ?? '').trim().toLowerCase()
    const email = normaliseEmail(row.email)
    const subid = row.subid === null || row.subid.trim() === '' ? null : Number(row.subid)
    return {
      legacyId: Number(row.legacy_id ?? 0),
      username: row.username,
      email: row.email,
      enabled: row.is_active !== '0',
      subid,
      duplicateUsername: username !== '' && (usernames.get(username) ?? 0) > 1,
      vendorExists: subid !== null && vendorIds.has(String(subid)),
      sharedEmail: email !== null && (emails.get(email) ?? 0) > 1,
    }
  })
}

export function guardNoPasswordColumns(columns: string[]): void {
  const forbidden = /password/i
  const found = columns.filter((column) => forbidden.test(column))
  if (found.length > 0) {
    throw new Error(`user migration read password columns: ${found.join(', ')}`)
  }
}

export async function planUserInvites(db: Db, dumpId: string): Promise<UserPlanRow[]> {
  guardNoPasswordColumns([
    'id',
    'username',
    'email',
    'is_enabled',
    'subid',
  ])
  const users = await loadStagedUsers(db, dumpId)
  const plans = users.map(planRow)

  for (const plan of plans) {
    await db
      .insert(migrationUserInvites)
      .values({
        legacyId: plan.legacyId,
        cohort: plan.cohort,
        state: plan.state,
        emailHash: plan.emailHash,
        note: plan.note,
      })
      .onConflictDoUpdate({
        target: migrationUserInvites.legacyId,
        set: {
          cohort: sql`excluded.cohort`,
          emailHash: sql`excluded.email_hash`,
          note: sql`excluded.note`,
          // A sent or claimed invitation is never reset by a rerun.
          state: sql`case when ${migrationUserInvites.state} in ('sent', 'claimed') then ${migrationUserInvites.state} else excluded.state end`,
          updatedAt: new Date(),
        },
      })
  }

  return plans
}

export interface InviteSender {
  send(input: {
    email: string
    displayName: string
    link: string
    expiresAt: Date
  }): Promise<void>
}

export interface IssueResult {
  sent: number
  skipped: number
  failed: Array<{ legacyId: number; error: string }>
}

/**
 * Sends invitations for the `ready` cohort only. The token exists in memory and
 * in the provider's link; the database keeps its hash.
 */
export async function issueInvites(
  db: Db,
  options: {
    baseUrl: string
    sender: InviteSender
    usersByLegacyId: Map<number, { email: string; displayName: string }>
    now?: Date
    ttlHours?: number
  },
): Promise<IssueResult> {
  const now = options.now ?? new Date()
  const ttlHours = options.ttlHours ?? INVITE_TTL_HOURS
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000)

  const ready = (await db.execute(sql`
    select legacy_id from migration.user_invites where state = 'ready' order by legacy_id
  `)) as unknown as Array<{ legacy_id: number }>

  const result: IssueResult = { sent: 0, skipped: 0, failed: [] }
  for (const row of ready) {
    const user = options.usersByLegacyId.get(Number(row.legacy_id))
    if (!user) {
      result.skipped += 1
      continue
    }
    const token = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex')
    try {
      await options.sender.send({
        email: user.email,
        displayName: user.displayName,
        link: `${options.baseUrl.replace(/\/$/, '')}/set-password?token=${token}`,
        expiresAt,
      })
      await db
        .update(migrationUserInvites)
        .set({ state: 'sent', tokenHash, expiresAt, updatedAt: new Date() })
        .where(sql`legacy_id = ${row.legacy_id}`)
      result.sent += 1
    } catch (error) {
      result.failed.push({
        legacyId: Number(row.legacy_id),
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// The narrow subcontractor bridge. Pure functions: no database, no network, so
// the rate limit and the burn are testable without a provider.
// ---------------------------------------------------------------------------

export interface BridgeState {
  attempts: number
  windowStartedAt: number | null
  lockedUntil: number | null
  burned: boolean
  burnedAt: number | null
}

export const EMPTY_BRIDGE_STATE: BridgeState = {
  attempts: 0,
  windowStartedAt: null,
  lockedUntil: null,
  burned: false,
  burnedAt: null,
}

export interface BridgeAvailability {
  available: boolean
  reason: 'ok' | 'disabled' | 'burned' | 'expired' | 'locked'
}

export function bridgeAvailability(input: {
  enabled: boolean
  cohort: string
  state: BridgeState
  bridgeStartedAt: Date
  now: Date
}): BridgeAvailability {
  if (!input.enabled || input.cohort === 'disabled') return { available: false, reason: 'disabled' }
  if (input.state.burned) return { available: false, reason: 'burned' }
  const ageDays = (input.now.getTime() - input.bridgeStartedAt.getTime()) / 86_400_000
  if (ageDays > BRIDGE_LIFETIME_DAYS) return { available: false, reason: 'expired' }
  if (input.state.lockedUntil !== null && input.state.lockedUntil > input.now.getTime()) {
    return { available: false, reason: 'locked' }
  }
  return { available: true, reason: 'ok' }
}

export function md5Hex(password: string): string {
  return createHash('md5').update(password, 'utf8').digest('hex')
}

/** Constant-time comparison of a submitted password against the frozen snapshot. */
export function verifyLegacyPassword(submitted: string, storedMd5: string): boolean {
  const computed = Buffer.from(md5Hex(submitted), 'utf8')
  const stored = Buffer.from(storedMd5.trim().toLowerCase(), 'utf8')
  if (computed.length !== stored.length) return false
  return timingSafeEqual(computed, stored)
}

/**
 * The attempt counter, its 15-minute window and the lockout. A success burns the
 * bridge permanently; a failure that exhausts the window locks it.
 */
export function recordBridgeAttempt(
  state: BridgeState,
  outcome: 'success' | 'failure',
  now: Date,
): BridgeState {
  const nowMs = now.getTime()
  if (outcome === 'success') {
    return { ...state, burned: true, burnedAt: nowMs, attempts: 0, lockedUntil: null, windowStartedAt: null }
  }
  const windowExpired =
    state.windowStartedAt === null || nowMs - state.windowStartedAt > BRIDGE_WINDOW_MINUTES * 60_000
  const attempts = windowExpired ? 1 : state.attempts + 1
  const windowStartedAt = windowExpired ? nowMs : state.windowStartedAt
  const lockedUntil =
    attempts >= BRIDGE_MAX_ATTEMPTS ? nowMs + BRIDGE_WINDOW_MINUTES * 60_000 : state.lockedUntil
  return { ...state, attempts, windowStartedAt, lockedUntil, burned: false, burnedAt: null }
}
