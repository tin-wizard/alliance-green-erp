import { afterAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '@cls/db'
import {
  BRIDGE_MAX_ATTEMPTS,
  BRIDGE_WINDOW_MINUTES,
  EMPTY_BRIDGE_STATE,
  bridgeAvailability,
  classifyCohort,
  guardNoPasswordColumns,
  md5Hex,
  planUserInvites,
  recordBridgeAttempt,
  verifyLegacyPassword,
  type BridgeState,
  type StagedUser,
} from './users'
import { stagedUsersDump } from './users.test-support'
import { databaseConfigured } from './testing'

const db = getDb()
const DUMP_ID = `sha256:users-test-${Date.now()}`

function user(overrides: Partial<StagedUser> = {}): StagedUser {
  return {
    legacyId: 1,
    username: 'gene',
    email: 'gene@example.com',
    enabled: true,
    subid: null,
    duplicateUsername: false,
    vendorExists: true,
    sharedEmail: false,
    ...overrides,
  }
}

describe('classifyCohort', () => {
  it('puts a disabled account first, even with a duplicate name and no email', () => {
    expect(
      classifyCohort(user({ enabled: false, duplicateUsername: true, email: null })),
    ).toBe('disabled')
  })

  it('quarantines a duplicate username before considering email', () => {
    expect(classifyCohort(user({ duplicateUsername: true }))).toBe('duplicate-username')
  })

  it('quarantines a subcontractor whose vendor row is missing', () => {
    expect(classifyCohort(user({ subid: 42, vendorExists: false }))).toBe('orphan-vendor')
  })

  it('marks shared mailbox accounts for office-assisted onboarding', () => {
    expect(classifyCohort(user({ sharedEmail: true }))).toBe('shared-email')
  })

  it('marks a blank or missing email as no-email', () => {
    expect(classifyCohort(user({ email: '  ' }))).toBe('no-email')
    expect(classifyCohort(user({ email: null }))).toBe('no-email')
  })

  it('invites a unique, active, controlled email', () => {
    expect(classifyCohort(user())).toBe('unique-email')
  })
})

describe('password columns', () => {
  it('refuses to run when a password column is in the read list', () => {
    expect(() => guardNoPasswordColumns(['username', 'password'])).toThrow(/password/)
    expect(() => guardNoPasswordColumns(['username', 'cls_mailing_password'])).toThrow()
    expect(() => guardNoPasswordColumns(['username', 'email'])).not.toThrow()
  })
})

describe('legacy MD5 bridge', () => {
  const start = new Date('2026-11-01T00:00:00Z')
  const password = 'legacy-pass'
  const hash = md5Hex(password)

  it('accepts the matching password and rejects another', () => {
    expect(verifyLegacyPassword(password, hash)).toBe(true)
    expect(verifyLegacyPassword(password, hash.toUpperCase())).toBe(true)
    expect(verifyLegacyPassword('wrong', hash)).toBe(false)
    expect(verifyLegacyPassword(password, 'not-a-hash')).toBe(false)
  })

  it('never opens for a disabled or duplicate account', () => {
    const now = new Date('2026-11-02T00:00:00Z')
    expect(
      bridgeAvailability({
        enabled: false,
        cohort: 'unique-email',
        state: EMPTY_BRIDGE_STATE,
        bridgeStartedAt: start,
        now,
      }).reason,
    ).toBe('disabled')
    expect(
      bridgeAvailability({
        enabled: true,
        cohort: 'disabled',
        state: EMPTY_BRIDGE_STATE,
        bridgeStartedAt: start,
        now,
      }).reason,
    ).toBe('disabled')
  })

  it('locks after five failures in the window', () => {
    let state: BridgeState = EMPTY_BRIDGE_STATE
    const now = new Date('2026-11-02T00:00:00Z')
    for (let attempt = 1; attempt <= BRIDGE_MAX_ATTEMPTS; attempt += 1) {
      state = recordBridgeAttempt(state, 'failure', now)
    }
    expect(state.attempts).toBe(BRIDGE_MAX_ATTEMPTS)
    expect(state.lockedUntil).not.toBeNull()
    expect(
      bridgeAvailability({
        enabled: true,
        cohort: 'unique-email',
        state,
        bridgeStartedAt: start,
        now,
      }).reason,
    ).toBe('locked')
  })

  it('resets the window after the lockout period', () => {
    let state: BridgeState = EMPTY_BRIDGE_STATE
    const now = new Date('2026-11-02T00:00:00Z')
    for (let attempt = 1; attempt <= BRIDGE_MAX_ATTEMPTS; attempt += 1) {
      state = recordBridgeAttempt(state, 'failure', now)
    }
    const later = new Date(now.getTime() + BRIDGE_WINDOW_MINUTES * 60_000 + 1)
    state = recordBridgeAttempt(state, 'failure', later)
    expect(state.attempts).toBe(1)
  })

  it('burns on success, permanently', () => {
    const now = new Date('2026-11-02T00:00:00Z')
    const state = recordBridgeAttempt(EMPTY_BRIDGE_STATE, 'success', now)
    expect(state.burned).toBe(true)
    expect(
      bridgeAvailability({
        enabled: true,
        cohort: 'unique-email',
        state,
        bridgeStartedAt: start,
        now: new Date('2026-11-03T00:00:00Z'),
      }).reason,
    ).toBe('burned')
  })

  it('expires after sixty days', () => {
    const now = new Date('2027-01-15T00:00:00Z')
    expect(
      bridgeAvailability({
        enabled: true,
        cohort: 'unique-email',
        state: EMPTY_BRIDGE_STATE,
        bridgeStartedAt: start,
        now,
      }).reason,
    ).toBe('expired')
  })
})

describe.skipIf(!databaseConfigured())('planUserInvites', () => {
  afterAll(async () => {
    await db.execute(sql`delete from migration.user_invites where note is not null and legacy_id between 9001 and 9010`)
    await db.execute(sql`delete from migration."stg_users" where "_dump_id" = ${DUMP_ID}`)
    await db.execute(sql`delete from migration."stg_subcontractor" where "_dump_id" = ${DUMP_ID}`)
  })

  it('segments the cohort and writes one invite row per legacy account', async () => {
    await stagedUsersDump(db, DUMP_ID)
    const plans = await planUserInvites(db, DUMP_ID)
    const byLegacy = new Map(plans.map((plan) => [plan.legacyId, plan]))

    expect(byLegacy.get(9001)?.cohort).toBe('unique-email')
    expect(byLegacy.get(9001)?.state).toBe('ready')
    expect(byLegacy.get(9002)?.cohort).toBe('disabled')
    expect(byLegacy.get(9002)?.state).toBe('disabled')
    expect(byLegacy.get(9003)?.cohort).toBe('duplicate-username')
    expect(byLegacy.get(9004)?.cohort).toBe('no-email')
    expect(byLegacy.get(9005)?.cohort).toBe('shared-email')
    expect(byLegacy.get(9006)?.cohort).toBe('orphan-vendor')
    expect(byLegacy.get(9007)?.cohort).toBe('unique-email')
    expect(byLegacy.get(9009)?.cohort).toBe('duplicate-username')
    expect(byLegacy.get(9008)?.cohort).toBe('shared-email')

    const rows = (await db.execute(
      sql`select legacy_id, cohort, state from migration.user_invites where legacy_id between 9001 and 9010 order by legacy_id`,
    )) as unknown as Array<{ legacy_id: number; cohort: string; state: string }>
    expect(rows).toHaveLength(9)

    // Re-planning is idempotent.
    const again = await planUserInvites(db, DUMP_ID)
    expect(again).toHaveLength(9)
    const rowsAgain = (await db.execute(
      sql`select count(*)::int as value from migration.user_invites where legacy_id between 9001 and 9010`,
    )) as unknown as Array<{ value: number }>
    expect(Number(rowsAgain[0]?.value)).toBe(9)
  }, 60_000)
})
