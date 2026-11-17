/**
 * Gateway contract tests.
 *
 * The invoicing worker (`processSagePosting`) is written against
 * `SageInvoiceGateway`. This file runs the same worker through both
 * implementations of that interface:
 *
 * - `FakeSageInvoiceGateway` — the consumer-tested default;
 * - `SageCloudAdapter` — the real client, over an in-memory Sage API that speaks
 *   the documented v3.1 shapes, including OAuth, contacts and tax rates.
 *
 * If the two diverge, the outbox will behave differently in production than in
 * every other test, which is exactly the failure this file exists to prevent.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { ALL_PERMISSIONS } from '@cls/core'
import { getConfig } from '@cls/core/env.server'
import { getDb, type Tx } from '@cls/db'
import {
  sageLinks,
  sagePostings,
  salesInvoices,
  sites,
  users,
  workOrderHours,
  workOrderTax,
  workOrders,
} from '@cls/db/schema'
import {
  FakeSageInvoiceGateway,
  buildHarness,
  setSageInvoiceGateway,
  type SageInvoiceGateway,
} from '@cls/sage'
import type { AuthSessionView } from '../../../server/auth.types'
import { createInvoiceFromSnapshotCore, issueInvoiceCore } from './sales.server'
import {
  SAGE_POSTING_MAX_ATTEMPTS,
  SAGE_POSTING_STALE_CLAIM_MS,
  claimSagePosting,
  processSagePosting,
} from './posting.server'

function databaseConfigured(): boolean {
  try {
    return Boolean(getConfig().databaseUrl)
  } catch {
    return false
  }
}

const ADMIN_ID = '00000000-0000-4000-8000-0000000000fd'

function adminSession(): AuthSessionView {
  return {
    id: 'session-contract',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id: ADMIN_ID,
      email: 'contract-admin@example.test',
      username: 'contract-admin',
      displayName: 'Contract Admin',
      role: 'admin',
      subcontractorId: null,
      grants: ALL_PERMISSIONS.map((key) => ({ key, scopeSubcontractorId: null })),
    },
  }
}

async function seed(tx: Tx): Promise<void> {
  await tx.insert(users).values({
    id: ADMIN_ID,
    email: 'contract-admin@example.test',
    username: 'contract-admin',
    displayName: 'Contract Admin',
    role: 'admin',
  })
  await tx.insert(sites).values({ id: 9_410_001, customerId: 9_410_010, name: 'Contract site' })
  await tx.insert(workOrders).values({
    id: 9_410_001,
    siteId: 9_410_001,
    status: 2,
    serviceRequired: 'Gateway contract',
    completedAt: new Date('2026-02-01T12:00:00Z'),
  })
  await tx.insert(workOrderHours).values({
    workOrderId: 9_410_001,
    lineDate: '2026-02-01',
    hours: '2.00',
    rateCode: 1,
    hourlyRate: '50.00',
    note: 'Contract labour',
  })
  await tx.insert(workOrderTax).values({ workOrderId: 9_410_001, taxProvince: 'ON' })
}

async function createAndQueue(tx: Tx): Promise<{ invoiceId: number; externalRef: string }> {
  const session = adminSession()
  const created = await createInvoiceFromSnapshotCore(tx, { workOrderId: 9_410_001 }, session)
  await issueInvoiceCore(
    tx,
    { invoiceId: created.invoiceId, version: created.version },
    session,
  )
  const [posting] = await tx
    .select()
    .from(sagePostings)
    .where(eq(sagePostings.docId, created.invoiceId))
  expect(posting!.status).toBe('queued')
  return { invoiceId: created.invoiceId, externalRef: posting!.externalRef }
}

interface GatewayCase {
  label: string
  install: () => {
    gateway: SageInvoiceGateway
    ledgerSize: () => number
    fail?: () => void
    recover?: () => void
  }
}

const CASES: GatewayCase[] = [
  {
    label: 'fake gateway',
    install: () => {
      const gateway = new FakeSageInvoiceGateway()
      setSageInvoiceGateway(gateway)
      // The fake keeps its own ledger private; the posting row and link are the
      // observable contract, so `ledgerSize` stays at zero for it.
      return {
        gateway,
        ledgerSize: () => 0,
        fail: () => gateway.setReachable(false),
        recover: () => gateway.setReachable(true),
      }
    },
  },
  {
    label: 'real-shape cloud adapter',
    install: () => {
      const harness = buildHarness({
        api: { contacts: [{ id: 'contact_c1', name: 'Customer 9410010' }] },
      })
      setSageInvoiceGateway(harness.adapter)
      return {
        gateway: harness.adapter,
        ledgerSize: () => harness.api.ledger.get('sales_invoices')?.length ?? 0,
        fail: () => harness.api.failNext(1, 500),
      }
    },
  },
]

describe.skipIf(!databaseConfigured())('SageInvoiceGateway contract', () => {
  for (const testCase of CASES) {
    describe(testCase.label, () => {
      test('a queued invoice posts once and links to the ledger', async () => {
        const installed = testCase.install()
        const { externalRef, postingId } = await freshInvoice()
        try {
          const result = await processSagePosting(postingId, null)
          expect(result.status).toBe('sent')
          expect(result.externalId).toBeTruthy()

          const db = getDb()
          const [link] = await db
            .select()
            .from(sageLinks)
            .where(eq(sageLinks.externalRef, externalRef))
          expect(link?.externalId).toBe(result.externalId)

          const found = await installed.gateway.findSalesInvoice(externalRef)
          expect(found).toBe(result.externalId)
          expect(installed.ledgerSize()).toBeLessThanOrEqual(1)
        } finally {
          await cleanup()
        }
      })

      test('draining twice does not create a second document', async () => {
        testCase.install()
        const { invoiceId, postingId } = await freshInvoice()
        try {
          const first = await processSagePosting(postingId, null)
          const second = await processSagePosting(postingId, null)
          expect({ status: first.status, error: first.error }).toEqual({ status: 'sent', error: null })
          expect(second.status).toBe('sent')
          expect(second.externalId).toBe(first.externalId)

          const links = await getDb()
            .select()
            .from(sageLinks)
            .where(eq(sageLinks.docId, invoiceId))
          expect(links).toHaveLength(1)
        } finally {
          await cleanup()
        }
      })

      test('a failed posting leaves the issued invoice intact and can be retried', async () => {
        const installed = testCase.install()
        installed.fail?.()
        const { invoiceId, postingId } = await freshInvoice()
        try {
          const failed = await processSagePosting(postingId, null)
          expect(failed.status).toBe('failed')
          expect(failed.error).toBeTruthy()

          const db = getDb()
          const [invoice] = await db
            .select()
            .from(salesInvoices)
            .where(eq(salesInvoices.id, invoiceId))
          expect(invoice?.status).toBe('issued')

          installed.recover?.()
          const retried = await processSagePosting(postingId, null)
          expect({ status: retried.status, error: retried.error }).toEqual({ status: 'sent', error: null })
        } finally {
          await cleanup()
        }
      })

      test('a poisoned posting stops retrying at the attempt cap', async () => {
        const installed = testCase.install()
        installed.fail?.()
        const { postingId } = await freshInvoice()
        try {
          const db = getDb()
          // One attempt short of the cap: the next failure must dead-letter it.
          await db
            .update(sagePostings)
            .set({ attempt: SAGE_POSTING_MAX_ATTEMPTS - 1 })
            .where(eq(sagePostings.id, postingId))

          const failed = await processSagePosting(postingId, null)
          expect(failed.status).toBe('dead_letter')

          const [row] = await db.select().from(sagePostings).where(eq(sagePostings.id, postingId))
          expect({ status: row?.status, attempt: row?.attempt }).toEqual({
            status: 'dead_letter',
            attempt: SAGE_POSTING_MAX_ATTEMPTS,
          })
          expect(row?.lastError).toBeTruthy()

          // Dead letters are not picked up again, so a poisoned row cannot burn
          // a Sage call every tick.
          const again = await processSagePosting(postingId, null)
          expect(again.status).toBe('dead_letter')
        } finally {
          await cleanup()
        }
      })

      test('an accepted document is linked, not re-posted, when the outcome write was lost', async () => {
        const installed = testCase.install()
        const { externalRef, postingId } = await freshInvoice()
        try {
          // Claim commits on its own; then Sage accepts and the process dies
          // before the outcome transaction runs.
          const claim = await getDb().transaction((tx) => claimSagePosting(tx, postingId))
          if (claim.kind !== 'claimed') throw new Error('expected the row to be claimable')
          const accepted = await installed.gateway.postSalesInvoice(claim.posting.payload as never)
          // Age the claim past the stale window, the way a real crash minutes
          // ago would look to the next tick.
          await getDb()
            .update(sagePostings)
            .set({ claimedAt: new Date(Date.now() - SAGE_POSTING_STALE_CLAIM_MS - 60_000) })
            .where(eq(sagePostings.id, postingId))

          const replay = await processSagePosting(postingId, null)
          expect({ status: replay.status, externalId: replay.externalId }).toEqual({
            status: 'sent',
            externalId: accepted.externalId,
          })

          const db = getDb()
          const [row] = await db.select().from(sagePostings).where(eq(sagePostings.id, postingId))
          expect((row?.response as { duplicate?: boolean } | null)?.duplicate).toBe(true)
          const [link] = await db
            .select()
            .from(sageLinks)
            .where(eq(sageLinks.externalRef, externalRef))
          expect(link?.externalId).toBe(accepted.externalId)
          expect(installed.ledgerSize()).toBeLessThanOrEqual(1)
        } finally {
          await cleanup()
        }
      })
    })
  }
})

const WORK_ORDER_ID = 9_410_001
const SITE_ID = 9_410_001

/** Leave the fixture committed, because the worker opens its own transactions. */
async function freshInvoice(): Promise<{
  invoiceId: number
  externalRef: string
  postingId: number
}> {
  await cleanup()
  return getDb().transaction(async (tx) => {
    await seed(tx)
    const created = await createAndQueue(tx)
    const postingId = await postingIdFor(tx, created.invoiceId)
    return { ...created, postingId }
  })
}

async function cleanup(): Promise<void> {
  const db = getDb()
  const invoices = await db
    .select({ id: salesInvoices.id })
    .from(salesInvoices)
    .where(eq(salesInvoices.workOrderId, WORK_ORDER_ID))
  const ids = invoices.map((row) => row.id)
  if (ids.length > 0) {
    await db
      .delete(sageLinks)
      .where(and(eq(sageLinks.docType, 'sales_invoice'), inArray(sageLinks.docId, ids)))
    await db
      .delete(sagePostings)
      .where(and(eq(sagePostings.docType, 'sales_invoice'), inArray(sagePostings.docId, ids)))
  }
  await db.delete(workOrders).where(eq(workOrders.id, WORK_ORDER_ID))
  await db.delete(sites).where(eq(sites.id, SITE_ID))
  await db.delete(users).where(eq(users.id, ADMIN_ID))
}

async function postingIdFor(tx: Tx, invoiceId: number): Promise<number> {
  const [posting] = await tx
    .select({ id: sagePostings.id })
    .from(sagePostings)
    .where(eq(sagePostings.docId, invoiceId))
  return posting!.id
}
