import { beforeEach, describe, expect, it } from 'vitest'
import { consumeRateLimit, resetRateLimit } from './rate-limit'

describe('consumeRateLimit', () => {
  beforeEach(() => resetRateLimit())

  it('allows up to the limit inside one window', () => {
    const options = { limit: 3, windowMs: 1000, now: 1_000 }
    expect(consumeRateLimit('k', options).allowed).toBe(true)
    expect(consumeRateLimit('k', options).allowed).toBe(true)
    expect(consumeRateLimit('k', options).allowed).toBe(true)
    const blocked = consumeRateLimit('k', options)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBe(1)
  })

  it('keeps separate counters per key', () => {
    const options = { limit: 1, windowMs: 1000, now: 1_000 }
    expect(consumeRateLimit('a', options).allowed).toBe(true)
    expect(consumeRateLimit('b', options).allowed).toBe(true)
    expect(consumeRateLimit('a', options).allowed).toBe(false)
  })

  it('resets after the window', () => {
    expect(consumeRateLimit('k', { limit: 1, windowMs: 1000, now: 1_000 }).allowed).toBe(true)
    expect(consumeRateLimit('k', { limit: 1, windowMs: 1000, now: 1_500 }).allowed).toBe(false)
    expect(consumeRateLimit('k', { limit: 1, windowMs: 1000, now: 2_001 }).allowed).toBe(true)
  })
})
