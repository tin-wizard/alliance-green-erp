/**
 * The catalogue is the ADR 0012 table in code. These tests pin the entries the
 * rest of the system is written against, and the awaiting-handler contract.
 */
import { describe, expect, test, vi } from 'vitest'
import { JOB_CATALOGUE, registerCatalogueJobs } from './catalogue'
import { getJob, hasHandler, listJobs, resetRegistryForTests, runJob } from './registry'
import type { JobContext } from './types'

const TORONTO = 'America/Toronto'

/** Every job key in ADR 0012, in the order the ADR lists them. */
const ADR_KEYS = [
  'platform.notifications-drain',
  'pricing.expire-price-locks',
  'work-orders.extract-signoff',
  'sage.post-pending',
  // Sage operational jobs: the ADR names the postings push; these four keep the
  // connection alive and the books checked, and the probe runs once on consent.
  'sage.keepalive',
  'sage.quota-guard',
  'sage.poll-external',
  'sage.reconcile',
  'sage.probe',
  'purchasing.po-followup-reminders',
  'purchasing.rga-notifications',
  'compliance.document-expiry',
  'compliance.wsib-reminders',
  'quotes.quote-reminders',
  'finance.dunning-reminders',
  'dispatch.reminders',
  'master-data.import-parts',
  'master-data.import-sites',
  'master-data.import-subcontractors',
  'master-data.site-address-change-check',
  'master-data.site-mall-refresh',
  'inventory.subcontractor-stock',
  'platform.retention-activity-log',
]

function context(): JobContext {
  return {
    db: null,
    runId: 1,
    idempotencyKey: 'purchasing.rga-notifications:2026-11-16T12:15:00.000Z',
    businessDate: '2026-11-16',
    scheduledFor: new Date('2026-11-16T12:15:00Z'),
    attempt: 1,
    dryRun: false,
    signal: new AbortController().signal,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
}

describe('JOB_CATALOGUE', () => {
  test('covers every job in the ADR, and nothing else', () => {
    // Nothing else means: no schedule exists that is not accounted for here.
    expect(JOB_CATALOGUE.map((job) => job.key)).toEqual(ADR_KEYS)
  })

  test('every entry is Toronto, serialised, and has a bounded schedule', () => {
    for (const job of JOB_CATALOGUE) {
      expect(job.timezone).toBe(TORONTO)
      expect(job.concurrency).toBe(1)
      expect(job.maxAttempts).toBeGreaterThanOrEqual(1)
      expect(job.timeoutMs).toBeGreaterThan(0)
      expect(job.staleAfterMs).toBeGreaterThan(0)
      expect(job.schedule.split(' ')).toHaveLength(5)
    }
  })

  test('high-frequency jobs never catch up; daily and weekly ones catch up once', () => {
    const frequent = [
      'platform.notifications-drain',
      'pricing.expire-price-locks',
      'work-orders.extract-signoff',
      'sage.post-pending',
      'sage.quota-guard',
      'sage.poll-external',
    ]
    for (const job of JOB_CATALOGUE) {
      expect(job.catchUp).toBe(frequent.includes(job.key) ? 'never' : 'once')
    }
  })

  test('purchasing.rga-notifications is 07:15 on weekdays, handler registered', () => {
    const job = JOB_CATALOGUE.find((entry) => entry.key === 'purchasing.rga-notifications')
    expect(job).toBeDefined()
    expect(job?.schedule).toBe('15 7 * * 1-5')
    expect(job?.timezone).toBe(TORONTO)
    expect(job?.status).toBe('registered')
    expect(job?.replaces).toBe('cron_rga_notification.php')
  })
})

describe('registerCatalogueJobs', () => {
  test('registers every schedule and is safe to call twice', () => {
    resetRegistryForTests()
    registerCatalogueJobs()
    registerCatalogueJobs()
    expect(
      listJobs()
        .map((job) => job.key)
        .sort(),
    ).toEqual([...ADR_KEYS].sort())
  })

  test('the RGA and Sage plans ship with a handler; the rest still await theirs', () => {
    resetRegistryForTests()
    registerCatalogueJobs()
    // The RGA module registers its handler at app start, not in this pure test,
    // so the catalogue's own claim is the published status.
    const registered = JOB_CATALOGUE.filter((job) => job.status === 'registered').map((job) => job.key)
    expect(registered).toEqual([
      'sage.keepalive',
      'sage.quota-guard',
      'sage.poll-external',
      'sage.reconcile',
      'sage.probe',
      'purchasing.rga-notifications',
    ])
    expect(JOB_CATALOGUE.filter((job) => hasHandler(job.key))).toEqual([])
  })

  test('running a catalogue job before its handler exists records skipped', async () => {
    resetRegistryForTests()
    registerCatalogueJobs()

    const execution = await runJob('purchasing.rga-notifications', context())

    expect(execution.status).toBe('skipped')
    expect(execution.recordsProcessed).toBe(0)
    expect(execution.detail).toEqual({ reason: 'handler_not_registered' })
    expect(execution.error).toBeNull()
  })

  test('a registered catalogue definition keeps its schedule', () => {
    resetRegistryForTests()
    registerCatalogueJobs()
    expect(getJob('purchasing.rga-notifications')?.schedule).toBe('15 7 * * 1-5')
  })
})
