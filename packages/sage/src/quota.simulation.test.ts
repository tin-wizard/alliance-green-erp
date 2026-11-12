/**
 * The month-end day, simulated against the real governor.
 *
 * `SAGE-RECONCILIATION.md` §10 asks for proof that a day of live posting plus
 * the daily run and the conversion batch stays inside 2,500 calls, and that the
 * pause guards trip where they should. This file models the day with the call
 * volume each operation actually costs, reserves every call through
 * `QuotaGovernor`, and asserts both the totals and the guard boundaries.
 *
 * The numbers are modelled, not measured from a tenant: they exist so the plan
 * is not arithmetic that nobody has run. The assumptions are named in
 * `MONTH_END_DAY` and asserted, so changing a budget forces a decision here.
 */
import { describe, expect, test } from 'vitest'
import { MemoryQuotaStore, MinuteBucket, QuotaGovernor, utcDayKey } from './quota'
import { CLASS_BUDGETS, DAILY_LIMIT } from './quota'

/**
 * A month-end day in the cloud ledger.
 *
 * - 400 live invoices is the busiest day in the legacy's own reporting; each is
 *   one POST, plus a contact search for the 35% of documents with a customer the
 *   adapter has not seen in the last hour, plus tax-rate lookups (one per rate
 *   per hour) and a 1% 409 retry that turns into a search.
 * - 300 historical documents are the cutover conversion's daily batch during the
 *   overlap, one POST each plus a 10% search before create (a restarted batch).
 * - the daily reconciliation reads 50 documents, 20 contacts (two calls each)
 *   and six change-feed calls.
 * - the 30-minute change-feed poll, 29 times in a 06:00-20:00 day, two calls
 *   per resource and three resources: 174 calls, all `sync`.
 * - the weekly probe (six reads) and the daily keep-alive, charged where they
 *   belong.
 */
const MONTH_END_DAY = {
  liveDocuments: 400,
  contactSearches: 140,
  taxLookups: 6,
  conflictRetries: 4,
  convertedDocuments: 300,
  conversionSearches: 30,
  reconcileDocumentReads: 50,
  reconcileContactCalls: 40,
  reconcileFeedCalls: 6,
  pollCalls: 174,
  probeCalls: 6,
  keepaliveCalls: 1,
} as const

const postingCalls =
  MONTH_END_DAY.liveDocuments +
  MONTH_END_DAY.contactSearches +
  MONTH_END_DAY.taxLookups +
  MONTH_END_DAY.conflictRetries +
  MONTH_END_DAY.convertedDocuments +
  MONTH_END_DAY.conversionSearches
const reconcileCalls =
  MONTH_END_DAY.reconcileDocumentReads +
  MONTH_END_DAY.reconcileContactCalls +
  MONTH_END_DAY.reconcileFeedCalls
const syncCalls = MONTH_END_DAY.pollCalls
const probeCalls = MONTH_END_DAY.probeCalls + MONTH_END_DAY.keepaliveCalls
const dayTotal = postingCalls + reconcileCalls + syncCalls + probeCalls

function clock(iso = '2026-11-30T13:00:00Z') {
  let now = Date.parse(iso)
  return {
    now: () => now,
    date: () => new Date(now),
    advance: (ms: number) => {
      now += ms
    },
  }
}

function governor(time: ReturnType<typeof clock>) {
  return new QuotaGovernor({
    store: new MemoryQuotaStore(),
    now: time.date,
    // Paced like a real worker: calls are spread out, so the minute bucket is
    // never the thing under test here.
    minute: new MinuteBucket({ now: time.now, capacity: 90, refillMs: 60_000 }),
  })
}

describe('month-end day inside the daily limit', () => {
  test('posting, reconciliation, polling and the conversion batch fit in 2,500 calls', () => {
    // The budget arithmetic, in the one place a reader can check it.
    expect(postingCalls).toBe(880)
    expect(reconcileCalls).toBe(96)
    expect(syncCalls).toBe(174)
    expect(probeCalls).toBe(7)
    expect(dayTotal).toBe(1_157)
    expect(dayTotal).toBeLessThanOrEqual(DAILY_LIMIT)
    // Headroom is deliberate: a re-run of the conversion batch must fit too.
    expect(DAILY_LIMIT - dayTotal).toBeGreaterThanOrEqual(postingCalls / 2)
  })

  test('each operation fits its own class budget', () => {
    expect(postingCalls).toBeLessThanOrEqual(CLASS_BUDGETS.posting)
    expect(reconcileCalls).toBeLessThanOrEqual(CLASS_BUDGETS.reconcile)
    expect(syncCalls).toBeLessThanOrEqual(CLASS_BUDGETS.sync)
    expect(probeCalls).toBeLessThanOrEqual(CLASS_BUDGETS.probe)
  })

  test('every one of those calls is granted by the governor, in that order', async () => {
    const time = clock()
    const quota = governor(time)

    async function spend(klass: keyof typeof CLASS_BUDGETS, calls: number): Promise<number> {
      let granted = 0
      for (let index = 0; index < calls; index += 1) {
        // One call every two seconds: inside the 90/minute bucket.
        time.advance(2_000)
        const decision = await quota.reserve(klass)
        if (!decision.allowed) break
        granted += 1
      }
      return granted
    }

    // Live posting and the conversion batch interleave during the overlap.
    expect(await spend('posting', MONTH_END_DAY.liveDocuments)).toBe(400)
    expect(await spend('posting', MONTH_END_DAY.contactSearches)).toBe(140)
    expect(await spend('posting', MONTH_END_DAY.taxLookups)).toBe(6)
    expect(await spend('posting', MONTH_END_DAY.conflictRetries)).toBe(4)
    expect(await spend('posting', MONTH_END_DAY.convertedDocuments)).toBe(300)
    expect(await spend('posting', MONTH_END_DAY.conversionSearches)).toBe(30)

    // 06:00-20:00 polling, charged to sync.
    expect(await spend('sync', syncCalls)).toBe(174)
    // The 06:00 reconciliation run.
    expect(await spend('reconcile', reconcileCalls)).toBe(96)
    // The weekly probe and the daily keep-alive.
    expect(await spend('probe', MONTH_END_DAY.probeCalls)).toBe(6)
    expect(await spend('probe', MONTH_END_DAY.keepaliveCalls)).toBe(1)

    const snapshot = await quota.snapshot()
    expect(snapshot.used).toBe(dayTotal)
    expect(snapshot.used).toBe(1_157)
    // 46% of the day: the other 54% absorbs a second conversion batch.
    expect(Math.round((snapshot.used / snapshot.limit) * 100)).toBe(46)
  })
})

describe('the guards trip where they should', () => {
  test('the class budgets add up to the daily limit, and the last 2% is never spent', () => {
    const sum = Object.values(CLASS_BUDGETS).reduce((total, budget) => total + budget, 0)
    expect(sum).toBe(DAILY_LIMIT)
    // The guard stops at 98%, so the reachable ceiling is 2,450 calls even though
    // the class budgets could name 2,500. The last 2% is deliberate headroom for
    // a retry that is already in flight when the counter crosses.
    const ceiling = Math.floor(DAILY_LIMIT * 0.98)
    expect(ceiling).toBe(2_450)
    expect(ceiling).toBeLessThanOrEqual(sum)
  })

  test('spending the posting budget stops posting but leaves reconciliation its class', async () => {
    const time = clock()
    const quota = governor(time)
    let granted = 0
    for (let index = 0; index < CLASS_BUDGETS.posting + 10; index += 1) {
      time.advance(1_000)
      if ((await quota.reserve('posting')).allowed) granted += 1
    }
    expect(granted).toBe(CLASS_BUDGETS.posting)

    const refusedPosting = await quota.reserve('posting')
    expect(refusedPosting.allowed).toBe(false)
    expect(refusedPosting.reason).toContain('Class budget for posting')

    // 1,500 of 2,500 is 60%: reconciliation still has its own budget and the day
    // has headroom, so it runs.
    expect((await quota.reserve('reconcile')).allowed).toBe(true)
    expect((await quota.reserve('probe')).allowed).toBe(true)
  })

  test('a full day: non-posting classes pause at 90%, and posting carries on alone to 98%', async () => {
    const time = clock('2026-11-30T09:00:00Z')
    const quota = governor(time)

    async function spend(klass: keyof typeof CLASS_BUDGETS, calls: number): Promise<number> {
      let granted = 0
      for (let index = 0; index < calls; index += 1) {
        time.advance(1_000)
        if ((await quota.reserve(klass)).allowed) granted += 1
      }
      return granted
    }

    // The day's non-posting work first: polling, payment checks, the run, probes.
    expect(await spend('sync', CLASS_BUDGETS.sync)).toBe(500)
    expect(await spend('payment_poll', CLASS_BUDGETS.payment_poll)).toBe(300)
    expect(await spend('reconcile', CLASS_BUDGETS.reconcile)).toBe(150)
    expect(await spend('probe', CLASS_BUDGETS.probe)).toBe(50)
    expect((await quota.snapshot()).used).toBe(1_000)

    // Posting to 2,250 (90%): still inside the posting budget (1,250 of 1,500).
    expect(await spend('posting', 1_250)).toBe(1_250)
    const atNinety = await quota.snapshot()
    expect(atNinety.used).toBe(2_250)

    // Every non-posting class is now paused, whatever budget it has left.
    const sync = await quota.reserve('sync')
    expect(sync.allowed).toBe(false)
    expect(sync.threshold).toBe('near_limit')
    expect(sync.reason).toContain('near its limit')
    expect((await quota.reserve('reconcile')).allowed).toBe(false)

    // Posting alone has the last 10%, for documents already in flight.
    expect(await spend('posting', 200)).toBe(200)
    expect((await quota.snapshot()).used).toBe(2_450)

    const exhausted = await quota.reserve('posting')
    expect(exhausted.allowed).toBe(false)
    expect(exhausted.threshold).toBe('exhausted')
    expect(exhausted.reason).toContain('exhausted')
    expect((await quota.reserve('sync')).allowed).toBe(false)
  })

  test('a new UTC day restores the full allowance and every class budget', async () => {
    // 22:00, so spending the day's allowance does not itself cross midnight.
    const time = clock('2026-11-30T22:00:00Z')
    const quota = governor(time)
    while ((await quota.snapshot()).used < Math.floor(DAILY_LIMIT * 0.98)) {
      time.advance(1_000)
      for (const klass of ['sync', 'payment_poll', 'reconcile', 'probe', 'posting'] as const) {
        const decision = await quota.reserve(klass)
        if (decision.allowed) break
      }
    }
    expect((await quota.snapshot()).used).toBe(2_450)
    expect((await quota.reserve('posting')).allowed).toBe(false)

    time.advance(120 * 60_000) // past midnight
    const snapshot = await quota.snapshot()
    expect(snapshot.used).toBe(0)
    expect(utcDayKey(time.date())).toBe('2026-12-01')
    expect((await quota.reserve('posting')).allowed).toBe(true)
    expect((await quota.reserve('reconcile')).allowed).toBe(true)
  })
})
