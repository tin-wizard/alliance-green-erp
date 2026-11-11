import { describe, expect, it } from 'vitest'
import { decideLockAction, type LockDecisionInput } from './price-lock'

const now = new Date('2026-02-01T12:00:00.000Z')
const later = new Date('2026-02-01T12:15:00.000Z')
const earlier = new Date('2026-02-01T11:45:00.000Z')

function input(overrides: Partial<LockDecisionInput> = {}): LockDecisionInput {
  return {
    isLocked: true,
    holderId: 'user-a',
    holderName: 'Ada',
    expiresAt: later,
    userId: 'user-b',
    takeOver: false,
    reason: null,
    now,
    ...overrides,
  }
}

describe('price lock decisions (E5/E6)', () => {
  it('lets anyone take a free lock', () => {
    expect(decideLockAction(input({ isLocked: false, holderId: null })).action).toBe('acquire')
  })

  it('lets the holder re-enter or refresh without a takeover', () => {
    expect(decideLockAction(input({ userId: 'user-a' })).action).toBe('acquire')
  })

  it('blocks a second user while the TTL is live and names the holder and expiry', () => {
    const decision = decideLockAction(input())
    expect(decision.action).toBe('blocked')
    expect(decision.message).toContain('Ada')
    expect(decision.message).toContain(later.toISOString())
  })

  it('surfaces an expired lock instead of silently clearing it', () => {
    const decision = decideLockAction(input({ expiresAt: earlier }))
    expect(decision.action).toBe('blocked')
    expect(decision.message).toMatch(/expired/)
    expect(decision.message).toMatch(/not cleared automatically/)
  })

  it('requires a reason before taking over an expired lock', () => {
    expect(decideLockAction(input({ expiresAt: earlier, takeOver: true })).action).toBe(
      'takeover_needs_reason',
    )
  })

  it('takes over an expired lock with a reason', () => {
    expect(
      decideLockAction(input({ expiresAt: earlier, takeOver: true, reason: 'Ada went home' }))
        .action,
    ).toBe('takeover')
  })

  it('treats a lock row with no expiry as expired, not as held forever', () => {
    expect(decideLockAction(input({ expiresAt: null })).action).toBe('blocked')
    expect(
      decideLockAction(input({ expiresAt: null, takeOver: true, reason: 'repair' })).action,
    ).toBe('takeover')
  })

  it('resolves two simultaneous editors deterministically: one holder, one blocked', () => {
    const first = decideLockAction(input({ userId: 'user-b' }))
    const second = decideLockAction(
      input({ holderId: 'user-b', holderName: 'Bob', userId: 'user-c' }),
    )
    expect(first.action).toBe('blocked')
    expect(second.action).toBe('blocked')
  })
})
