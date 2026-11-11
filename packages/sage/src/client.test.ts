import { describe, expect, test } from 'vitest'
import { createSealer, connectionAad, parseKey, tokenFingerprint } from './crypto'
import { MemoryPauseStore, PauseGovernor } from './pause'
import { MemoryQuotaStore, MinuteBucket, QuotaGovernor, utcDayKey } from './quota'
import { MemoryConnectionRepository, TEST_KEY, buildHarness } from './testing/harness'
import { createFakeSageApi } from './testing/fake-api'
import { TokenService } from './auth/tokens'

const KEY = Buffer.alloc(32, 3).toString('base64')

describe('token custody', () => {
  test('seals and opens with the connection as additional data', () => {
    const sealer = createSealer(KEY)
    const sealed = sealer.seal('access-token', connectionAad('sandbox', 'business_1'))
    expect(sealed).not.toContain('access-token')
    expect(sealer.open(sealed, connectionAad('sandbox', 'business_1'))).toBe('access-token')
  })

  test('fails closed across environments and businesses', () => {
    const sealer = createSealer(KEY)
    const sealed = sealer.seal('token', connectionAad('sandbox', 'business_1'))
    expect(() => sealer.open(sealed, connectionAad('production', 'business_1'))).toThrow()
    expect(() => sealer.open(sealed, connectionAad('sandbox', 'business_2'))).toThrow()
  })

  test('rejects a key that is not 32 bytes', () => {
    expect(() => parseKey('short')).toThrow(/32 bytes/)
  })

  test('fingerprints are stable and never the token', () => {
    expect(tokenFingerprint('abc')).toBe(tokenFingerprint('abc'))
    expect(tokenFingerprint('abc')).not.toContain('abc')
  })
})

describe('quota accounting', () => {
  test('the minute bucket admits its capacity, then refuses until it refills', () => {
    let now = 0
    const bucket = new MinuteBucket({ capacity: 3, refillMs: 60_000, now: () => now })
    expect(bucket.tryTake()).toBe(true)
    expect(bucket.tryTake()).toBe(true)
    expect(bucket.tryTake()).toBe(true)
    expect(bucket.tryTake()).toBe(false)
    now = 60_000
    expect(bucket.tryTake()).toBe(true)
  })

  test('a 429 drains the bucket', () => {
    const bucket = new MinuteBucket({ capacity: 5, now: () => 0 })
    bucket.drain()
    expect(bucket.available()).toBe(0)
  })

  test('reserves per class and reports the day counter', async () => {
    const store = new MemoryQuotaStore()
    const governor = new QuotaGovernor({
      store,
      limit: 2500,
      minute: new MinuteBucket({ capacity: 100, now: () => 0 }),
      now: () => new Date('2026-11-11T10:00:00Z'),
    })
    const decision = await governor.reserve('posting')
    expect(decision.allowed).toBe(true)
    const snapshot = await governor.snapshot()
    expect(snapshot.used).toBe(1)
    expect(utcDayKey(new Date('2026-11-11T23:59:00Z'))).toBe('2026-11-11')
  })

  test('at 90% only posting continues; at 98% posting stops too', async () => {
    const store = new MemoryQuotaStore()
    const now = new Date('2026-11-11T10:00:00Z')
    await store.save({
      day: utcDayKey(now),
      used: 2250,
      byClass: { posting: 1400, sync: 400, payment_poll: 200, reconcile: 200, probe: 50 },
    })
    const governor = new QuotaGovernor({
      store,
      limit: 2500,
      minute: new MinuteBucket({ capacity: 100, now: () => now.getTime() }),
      now: () => now,
    })
    expect((await governor.reserve('posting')).allowed).toBe(true)
    expect((await governor.reserve('sync')).allowed).toBe(false)

    await store.save({
      day: utcDayKey(now),
      used: 2450,
      byClass: { posting: 1400, sync: 500, payment_poll: 300, reconcile: 200, probe: 50 },
    })
    const refusal = await governor.reserve('posting')
    expect(refusal.allowed).toBe(false)
    expect(refusal.threshold).toBe('exhausted')
  })

  test('the counter is per day, so a new day starts clean', async () => {
    const store = new MemoryQuotaStore()
    let now = new Date('2026-11-11T23:00:00Z')
    const governor = new QuotaGovernor({
      store,
      limit: 10,
      minute: new MinuteBucket({ capacity: 100, now: () => now.getTime() }),
      now: () => now,
    })
    for (let call = 0; call < 9; call += 1) await governor.reserve('posting')
    expect((await governor.reserve('posting')).allowed).toBe(true)
    now = new Date('2026-11-12T00:05:00Z')
    expect((await governor.snapshot()).used).toBe(0)
  })
})

describe('pause conditions', () => {
  test('three consecutive server errors pause for the cooldown, then lift', async () => {
    let now = new Date('2026-11-11T10:00:00Z')
    const governor = new PauseGovernor({ store: new MemoryPauseStore(), now: () => now })
    await governor.noteServerError()
    await governor.noteServerError()
    expect((await governor.report()).paused).toBe(false)
    await governor.noteServerError()
    expect((await governor.report()).reason).toBe('server_errors')
    now = new Date(now.getTime() + 31 * 60 * 1000)
    expect((await governor.report()).paused).toBe(false)
  })

  test('a success resets the server-error streak', async () => {
    const governor = new PauseGovernor({ store: new MemoryPauseStore() })
    await governor.noteServerError()
    await governor.noteServerError()
    await governor.noteSuccess()
    await governor.noteServerError()
    expect((await governor.report()).paused).toBe(false)
  })

  test('a rejection rate above 5% pauses until a human acts', async () => {
    const governor = new PauseGovernor({ store: new MemoryPauseStore() })
    for (let attempt = 0; attempt < 5; attempt += 1) await governor.noteRejection()
    const report = await governor.report()
    expect(report.reason).toBe('rejections')
    await governor.resume()
    expect((await governor.report()).paused).toBe(false)
  })
})

describe('token service', () => {
  test('refreshes once when the access token is close to expiry, and rotates', async () => {
    const clock = new Date('2026-11-11T15:00:00Z')
    const h = buildHarness({ now: clock })
    const initial = h.repository.current!
    initial.accessExpiresAt = new Date(clock.getTime() + 100_000)

    const token = await h.tokens.getAccessToken()
    expect(token).toBe('fake_access_1')
    expect(h.repository.current?.accessTokenSealed).not.toBe(initial.accessTokenSealed)
    // The rotated pair is stored before the token is handed out.
    const stored = await h.repository.load()
    expect(stored?.refreshExpiresAt.getTime()).toBeGreaterThan(clock.getTime())
    expect(h.repository.saveAttempts).toBe(1)
  })

  test('two concurrent callers share one refresh', async () => {
    const h = buildHarness()
    h.repository.current!.accessExpiresAt = new Date(h.clock.now.getTime() + 1000)
    const before = h.api.calls.filter((call) => call.path.endsWith('token')).length
    await Promise.all([h.tokens.getAccessToken(), h.tokens.getAccessToken()])
    const after = h.api.calls.filter((call) => call.path.endsWith('token')).length
    expect(after - before).toBe(1)
  })

  test('a rejected refresh marks needs_reauth and keeps the outbox intact', async () => {
    const h = buildHarness()
    h.repository.current!.accessExpiresAt = new Date(h.clock.now.getTime() + 1000)
    h.api.killRefreshToken()
    await expect(h.tokens.getAccessToken()).rejects.toThrow(/refresh token/i)
    expect(h.repository.current?.state).toBe('needs_reauth')
  })

  test('a 14-day-old token is degraded; a 21-day-old token blocks posting', async () => {
    const clock = new Date('2026-11-11T15:00:00Z')
    const fresh = buildHarness({ now: clock })
    fresh.repository.current!.lastRefreshAt = new Date(clock.getTime() - 15 * 24 * 60 * 60 * 1000)
    const degraded = await fresh.tokens.status()
    expect(degraded.state).toBe('degraded')
    expect(degraded.daysSinceRefresh).toBe(15)

    const stale = buildHarness({ now: clock })
    stale.repository.current!.lastRefreshAt = new Date(clock.getTime() - 22 * 24 * 60 * 60 * 1000)
    const blocked = await stale.tokens.status()
    expect(blocked.state).toBe('needs_reauth')
    expect(blocked.message).toMatch(/authorised again/)
  })

  test('the keep-alive refreshes and writes a health sample', async () => {
    const h = buildHarness()
    const result = await h.tokens.keepAlive()
    expect(result.state).toBe('verified')
    expect(h.repository.samples).toHaveLength(1)
    expect(h.repository.samples[0]?.state).toBe('verified')
  })

  test('a failed keep-alive flips the state the same day', async () => {
    const h = buildHarness()
    h.api.killRefreshToken()
    h.repository.current!.accessExpiresAt = new Date(h.clock.now.getTime() + 1000)
    const result = await h.tokens.keepAlive()
    expect(result.state).toBe('needs_reauth')
    expect(h.repository.current?.state).toBe('needs_reauth')
  })

  test('exchanging a code stores a connection with no business until one is chosen', async () => {
    const clock = new Date('2026-11-11T15:00:00Z')
    const api = createFakeSageApi()
    const repository = new MemoryConnectionRepository(null)
    const tokens = new TokenService({
      environment: 'sandbox',
      tokenUrl: 'https://oauth.example/token',
      clientId: 'client',
      clientSecret: 'secret',
      redirectUri: 'https://app.example/api/sage/oauth/callback',
      sealer: createSealer(TEST_KEY),
      repository,
      fetch: api.fetch,
      now: () => clock,
    })

    await tokens.exchangeCode('authorisation-code')
    expect(repository.current?.businessId).toBeNull()
    expect(repository.current?.state).toBe('verified')

    await tokens.bindBusiness('business_1')
    expect(repository.current?.businessId).toBe('business_1')
    // Re-sealed under the business-bound AAD, so the token still opens.
    const access = await tokens.getAccessToken()
    expect(access).toBe('fake_access_1')
  })
})
