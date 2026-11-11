/**
 * The reconciliation run, end to end over a real database and a stub Sage.
 *
 * What is being proved here is the part the pure checks cannot: that a run
 * writes one run row plus one row per finding, that a missing document is
 * reported rather than re-posted, and that a Sage outage is `error` — never a
 * green run. The HTTP client is injected, so no socket is opened.
 */
import { desc, eq, inArray, like, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

vi.stubEnv('SAGE_ENABLED', 'true')
vi.stubEnv('SAGE_CLIENT_ID', 'test-client')
vi.stubEnv('SAGE_CLIENT_SECRET', 'test-secret')
vi.stubEnv('SAGE_REDIRECT_URI', 'https://example.test/api/sage/oauth/callback')
vi.stubEnv('SAGE_TOKEN_ENC_KEY', Buffer.alloc(32, 7).toString('base64'))

import { getConfig } from '@cls/core/env.server'
import { getDb } from '@cls/db'
import {
  sageLinks,
  sagePostings,
  sageReconciliationFindings,
  sageReconciliationRuns,
  sageSyncState,
} from '@cls/db/schema'
import { SageError } from '@cls/sage'
import type { ReconcileHttp } from './reconcile.server'
import { pollResourceFeeds, runReconciliation } from './reconcile.server'

const REF = 'cls:test-recon:sales_invoice:990001'
const DOC_ID = 990_001
const API_ID = 'sdi-test-1'

function databaseConfigured(): boolean {
  try {
    return Boolean(getConfig().databaseUrl)
  } catch {
    return false
  }
}

const READY = databaseConfigured()

interface StubRoutes {
  /** Keyed by path without the query string. A `SageError` is thrown. */
  [path: string]: unknown | SageError | (() => unknown)
}

function stubHttp(routes: StubRoutes): ReconcileHttp {
  return {
    async request({ path }) {
      const key = path.split('?')[0]!
      // The balance check lists a contact's own invoices; answering it with the
      // change feed (same path prefix) would make every balance look mismatched.
      const handler = path.includes('contact_id=')
        ? { $items: [{ total_amount: '113.00', payments_allocations: [] }] }
        : routes[key]
      const json = typeof handler === 'function' ? (handler as () => unknown)() : handler
      if (json instanceof SageError) throw json
      return {
        status: 200,
        body: JSON.stringify(json),
        json: json ?? { $items: [] },
        headers: new Headers(),
      }
    },
  }
}

/** A document whose stored values match what was sent. */
function documentJson(overrides: Record<string, unknown> = {}) {
  return {
    id: API_ID,
    total_amount: '113.00',
    tax_amount: '13.00',
    net_amount: '100.00',
    contact_id: 'contact-test',
    date: '2026-11-10',
    reference: REF,
    ...overrides,
  }
}

async function clearRows(): Promise<void> {
  if (!READY) return
  const db = getDb()
  // Findings cascade from the run row, so deleting the runs is enough.
  await db.delete(sageReconciliationRuns).where(eq(sageReconciliationRuns.mode, 'manual'))
  await db.delete(sageLinks).where(like(sageLinks.externalRef, 'cls:test-recon:%'))
  await db.delete(sagePostings).where(like(sagePostings.externalRef, 'cls:test-recon:%'))
}

beforeAll(async () => {
  if (!READY) return
  await clearRows()
  await getDb().insert(sagePostings).values({
    docType: 'sales_invoice',
    docId: DOC_ID,
    externalRef: REF,
    status: 'sent',
    attempt: 1,
    payload: { subtotal: '100.00', tax: '13.00', total: '113.00' },
  })
  await getDb().insert(sageLinks).values({
    docType: 'sales_invoice',
    docId: DOC_ID,
    externalRef: REF,
    externalId: API_ID,
  })
})

afterAll(async () => {
  if (READY) {
    await clearRows()
    await getDb()
      .delete(sageSyncState)
      .where(inArray(sageSyncState.resource, ['sales_invoices', 'purchase_invoices', 'contact_payments']))
  }
  vi.unstubAllEnvs()
})

describe.skipIf(!READY)('runReconciliation', () => {
  test('a matching document passes and the run row records the money checked', async () => {
    const result = await runReconciliation({
      mode: 'manual',
      http: stubHttp({
        [`sales_invoices/${API_ID}`]: documentJson(),
        'sales_invoices': { $items: [] },
        'purchase_invoices': { $items: [] },
        'contact_payments': { $items: [] },
        'contacts/contact-test': { id: 'contact-test', outstanding_amount: '113.00' },
      }),
    })

    expect(result.status).toBe('passed')
    expect(result.findings).toBe(0)
    expect(result.runId).not.toBeNull()

    const [run] = await getDb()
      .select()
      .from(sageReconciliationRuns)
      .where(eq(sageReconciliationRuns.id, result.runId!))
    expect(run?.status).toBe('passed')
    expect(run?.error).toBeNull()
    expect(run?.docCount).toBeGreaterThanOrEqual(1)
    expect(run?.moneyTotal).toBe('113.00')
  })

  test('a tampered amount fails the run and both values are on the finding', async () => {
    const result = await runReconciliation({
      mode: 'manual',
      http: stubHttp({
        [`sales_invoices/${API_ID}`]: documentJson({ total_amount: '112.99' }),
        'sales_invoices': { $items: [] },
        'purchase_invoices': { $items: [] },
        'contact_payments': { $items: [] },
        'contacts/contact-test': { id: 'contact-test', outstanding_amount: '113.00' },
      }),
    })

    expect(result.status).toBe('failed')
    expect(result.blockers).toBe(1)

    const findings = await getDb()
      .select()
      .from(sageReconciliationFindings)
      .where(eq(sageReconciliationFindings.runId, result.runId!))
    const amounts = findings.filter((finding) => finding.code === 'AMOUNT_MISMATCH')
    expect(amounts).toHaveLength(1)
    expect(amounts[0]?.expected).toBe('113.00')
    expect(amounts[0]?.actual).toBe('112.99')
    expect(amounts[0]?.decision).toBe('open')
  })

  test('a document deleted in Sage is reported, and nothing is re-posted', async () => {
    const result = await runReconciliation({
      mode: 'manual',
      http: stubHttp({
        [`sales_invoices/${API_ID}`]: new SageError('permanent', 'SAGE_REJECTED', '404 not found', {
          status: 404,
        }),
        'sales_invoices': { $items: [] },
        'purchase_invoices': { $items: [] },
        'contact_payments': { $items: [] },
      }),
    })

    const findings = await getDb()
      .select()
      .from(sageReconciliationFindings)
      .where(eq(sageReconciliationFindings.runId, result.runId!))
    expect(findings.map((finding) => finding.code)).toContain('DELETED_IN_SAGE')

    // The outbox row is untouched: a deletion is finance's decision, not ours.
    const [posting] = await getDb()
      .select()
      .from(sagePostings)
      .where(eq(sagePostings.externalRef, REF))
    expect(posting?.status).toBe('sent')
    const queued = await getDb()
      .select({ id: sagePostings.id })
      .from(sagePostings)
      .where(eq(sagePostings.status, 'queued'))
    expect(queued.some((row) => row.id === posting?.id)).toBe(false)
  })

  test('a Sage outage is error with the reason, never passed', async () => {
    const result = await runReconciliation({
      mode: 'manual',
      http: stubHttp({
        [`sales_invoices/${API_ID}`]: new SageError('retryable', 'SAGE_SERVER', '503 Service Unavailable', {
          status: 503,
        }),
      }),
    })

    expect(result.status).toBe('error')
    expect(result.reason).toContain('503')

    const [run] = await getDb()
      .select()
      .from(sageReconciliationRuns)
      .where(eq(sageReconciliationRuns.id, result.runId!))
    expect(run?.status).toBe('error')
  })

  test('dry run computes without writing a run row', async () => {
    const before = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(sageReconciliationRuns)
    const result = await runReconciliation({
      mode: 'manual',
      dryRun: true,
      http: stubHttp({
        [`sales_invoices/${API_ID}`]: documentJson(),
        'sales_invoices': { $items: [] },
        'purchase_invoices': { $items: [] },
        'contact_payments': { $items: [] },
        'contacts/contact-test': { id: 'contact-test', outstanding_amount: '113.00' },
      }),
    })
    expect(result.runId).toBeNull()
    expect(result.status).toBe('passed')
    const after = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(sageReconciliationRuns)
    expect(after[0]?.count).toBe(before[0]?.count)
  })
})

describe.skipIf(!READY)('pollResourceFeeds', () => {
  test('an orphan keeps the watermark still so the next poll reports it again', async () => {
    const before = await getDb()
      .select()
      .from(sageSyncState)
      .where(eq(sageSyncState.resource, 'sales_invoices'))
      .orderBy(desc(sageSyncState.lastRunAt))
      .limit(1)

    const now = new Date('2026-11-11T12:00:00Z')
    const first = await pollResourceFeeds(
      stubHttp({
        sales_invoices: { $items: [{ id: 'sdi-orphan', reference: 'cls:test-recon:orphan' }] },
        purchase_invoices: { $items: [] },
        contact_payments: { $items: [] },
      }),
      now,
      false,
    )
    expect(first.events.some((event) => event.kind === 'orphan')).toBe(true)

    const [afterFirst] = await getDb()
      .select()
      .from(sageSyncState)
      .where(eq(sageSyncState.resource, 'sales_invoices'))
    // The watermark did not move, so the orphan cannot be lost by a later run.
    expect(afterFirst?.watermark?.getTime() ?? null).toBe(before[0]?.watermark?.getTime() ?? null)

    const clean = await pollResourceFeeds(
      stubHttp({
        sales_invoices: { $items: [] },
        purchase_invoices: { $items: [] },
        contact_payments: { $items: [] },
      }),
      now,
      false,
    )
    expect(clean.events).toEqual([])
    const [afterClean] = await getDb()
      .select()
      .from(sageSyncState)
      .where(eq(sageSyncState.resource, 'sales_invoices'))
    expect(afterClean?.watermark?.getTime()).toBe(now.getTime())
  })
})
