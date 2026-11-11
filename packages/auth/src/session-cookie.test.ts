import { describe, expect, it } from 'vitest'
import { sealSession, unsealSession } from './session-cookie'

const SECRET = 'test-secret-that-is-long-enough-for-hkdf'
const payload = {
  cookie: '__Secure-neon-auth.session_token=abc',
  jwt: 'header.payload.signature',
  expiresAt: Date.now() + 60_000,
}

describe('sealSession', () => {
  it('round-trips the session payload', () => {
    const sealed = sealSession(SECRET, payload)
    expect(sealed).not.toContain('header.payload.signature')
    expect(unsealSession(SECRET, sealed)).toEqual(payload)
  })

  it('rejects a value sealed with another secret', () => {
    const sealed = sealSession(SECRET, payload)
    expect(unsealSession('another-secret-that-is-long-enough', sealed)).toBeNull()
  })

  it('rejects a tampered value', () => {
    const sealed = sealSession(SECRET, payload)
    const parts = sealed.split('.')
    parts[3] = `${parts[3]?.slice(0, -2)}aa`
    expect(unsealSession(SECRET, parts.join('.'))).toBeNull()
  })

  it('returns null for missing or malformed values', () => {
    expect(unsealSession(SECRET, undefined)).toBeNull()
    expect(unsealSession(SECRET, 'nonsense')).toBeNull()
    expect(unsealSession(SECRET, 'v1.a.b')).toBeNull()
  })
})
