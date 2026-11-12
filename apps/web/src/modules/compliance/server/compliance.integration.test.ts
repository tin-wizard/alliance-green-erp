/**
 * Compliance integration tests. Real database, always rolled back.
 *
 * Pins the WSIB/insurance status projection, the 30/14/7/1/0 windows, blocked
 * open work orders, override grants and audit reasons, warranty expiry, and
 * both reminder handlers.
 */
import { eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { getConfig } from '@cls/core/env.server'
import { getDb, type Tx } from '@cls/db'
import {
  auditLog,
  complianceReminders,
  customers,
  siteWarranties,
  sites,
  subcontractorDocuments,
  subcontractors,
  userPermissions,
  users,
  workOrders,
} from '@cls/db/schema'
import { catalogueEntry } from '@cls/core/jobs'
import { getComplianceOverview } from './compliance.server'
import {
  complianceDocumentExpiryHandler,
  complianceWsibRemindersHandler,
  registerComplianceJobs,
} from './jobs.server'

function databaseConfigured(): boolean {
  try {
    return Boolean(getConfig().databaseUrl)
  } catch {
    return false
  }
}

class Rollback extends Error {}

async function inRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await getDb().transaction(async (tx) => {
      await fn(tx)
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
}

const TODAY = '2026-06-15'
const ADMIN_ID = '00000000-0000-4000-8000-0000000000c1'
const suffix = 300_000 + Math.floor(Math.random() * 300_000)
const CUSTOMER_ID = 790_000_000 + suffix
const SITE_ID = 690_000_000 + suffix
const SUB_VALID = 590_000_000 + suffix
const SUB_BLOCKED = 490_000_000 + suffix
const SUB_EMPTY = 390_000_000 + suffix
const SUB_EXPIRING = 290_000_000 + suffix
const WO_BLOCKED = 190_000_000 + suffix
const WO_VALID = 180_000_000 + suffix

async function seed(tx: Tx): Promise<void> {
  await tx.insert(users).values({
    id: ADMIN_ID,
    email: `compliance-${suffix}@example.test`,
    username: `compliance-${suffix}`,
    displayName: 'Compliance Admin',
    role: 'admin',
  })
  await tx.insert(customers).values({ id: CUSTOMER_ID, name: `Compliance Customer ${suffix}` })
  await tx.insert(sites).values({
    id: SITE_ID,
    customerId: CUSTOMER_ID,
    name: `Compliance Site ${suffix}`,
  })
  await tx.insert(subcontractors).values([
    { id: SUB_VALID, name: `Valid Sub ${suffix}` },
    { id: SUB_BLOCKED, name: `Blocked Sub ${suffix}` },
    { id: SUB_EMPTY, name: `Empty Sub ${suffix}` },
    { id: SUB_EXPIRING, name: `Expiring Sub ${suffix}` },
  ])
  await tx.insert(subcontractorDocuments).values([
    {
      subcontractorId: SUB_VALID,
      kind: 'wsib',
      fileName: 'valid.pdf',
      expiresOn: '2026-08-01',
      isExpired: false,
    },
    {
      subcontractorId: SUB_BLOCKED,
      kind: 'wsib',
      fileName: 'expired.pdf',
      expiresOn: '2026-05-01',
      isExpired: true,
    },
    {
      subcontractorId: SUB_EXPIRING,
      kind: 'wsib',
      fileName: 'wsib-window.pdf',
      expiresOn: '2026-06-22',
      isExpired: false,
    },
    {
      subcontractorId: SUB_EXPIRING,
      kind: 'insurance',
      fileName: 'insurance-window.pdf',
      expiresOn: '2026-07-15',
      isExpired: false,
    },
  ])
  await tx.insert(workOrders).values([
    {
      id: WO_BLOCKED,
      siteId: SITE_ID,
      subcontractorId: SUB_BLOCKED,
      status: 1,
      dateTaken: '2026-06-01',
    },
    {
      id: WO_VALID,
      siteId: SITE_ID,
      subcontractorId: SUB_VALID,
      status: 7,
      dateTaken: '2026-06-02',
    },
  ])
  await tx.insert(userPermissions).values({
    userId: ADMIN_ID,
    permissionKey: 'workorder:override_wsib_hold',
    isAllowed: true,
    scopeSubcontractorId: SUB_BLOCKED,
    note: 'Emergency callout approved by the operations manager',
  })
  await tx.insert(auditLog).values({
    actorUserId: ADMIN_ID,
    actorLabel: 'Compliance Admin',
    action: 'workorder.update',
    entityType: 'work_order',
    entityId: String(WO_BLOCKED),
    summary: 'Work order updated; subcontractor assigned with a WSIB/insurance override.',
  })
  await tx.insert(siteWarranties).values({
    siteId: SITE_ID,
    description: 'Fixture warranty',
    expiresOn: '2026-06-20',
    workOrderId: WO_VALID,
  })
}

function context(tx: Tx, dryRun = false) {
  return {
    db: tx,
    runId: 1,
    idempotencyKey: `compliance:${TODAY}`,
    businessDate: TODAY,
    scheduledFor: new Date(`${TODAY}T11:30:00Z`),
    attempt: 1,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    dryRun,
    signal: new AbortController().signal,
  }
}

describe.skipIf(!databaseConfigured())('compliance', () => {
  test('projects WSIB and insurance states, windows, blocked work and warranties', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const overview = await getComplianceOverview(TODAY, tx)

      const valid = overview.subcontractors.find((row) => row.id === SUB_VALID)
      expect(valid?.wsib?.state).toBe('valid')
      expect(valid?.insurance).toBeNull()
      expect(valid?.gateValid).toBe(true)

      const blocked = overview.subcontractors.find((row) => row.id === SUB_BLOCKED)
      expect(blocked?.wsib?.state).toBe('expired')
      expect(blocked?.gateValid).toBe(false)

      const empty = overview.subcontractors.find((row) => row.id === SUB_EMPTY)
      expect(empty?.wsib).toBeNull()
      expect(empty?.gateValid).toBe(false)

      const expiring = overview.subcontractors.find((row) => row.id === SUB_EXPIRING)
      expect(expiring?.wsib?.window).toBe(7)
      expect(expiring?.insurance?.window).toBe(30)

      expect(overview.missingWsibWorkOrders.map((row) => row.id)).toEqual([WO_BLOCKED])
      expect(overview.totals.openWorkOrdersBlocked).toBe(1)
      expect(overview.overrideGrants[0]?.note).toContain('Emergency callout')
      expect(overview.overrideUses[0]?.reason).toContain('WSIB/insurance override')
      expect(overview.warranties[0]?.state).toBe('expiring')
      expect(overview.totals.warrantyExpiring30).toBe(1)
    })
  })

  test('reminder handlers run through the job registry and dedupe per window', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      registerComplianceJobs()
      registerComplianceJobs()
      expect(catalogueEntry('compliance.document-expiry')?.status).toBe('registered')
      expect(catalogueEntry('compliance.wsib-reminders')?.status).toBe('registered')

      const first = (await complianceDocumentExpiryHandler(context(tx))) as {
        recordsProcessed?: number
      }
      expect(first.recordsProcessed).toBeGreaterThan(0)
      const second = (await complianceDocumentExpiryHandler(context(tx))) as {
        recordsProcessed?: number
      }
      expect(second.recordsProcessed).toBe(0)

      const wsib = (await complianceWsibRemindersHandler(context(tx))) as {
        detail?: Record<string, unknown>
      }
      expect(wsib.detail?.warning).toBe(1)
      expect(wsib.detail?.expired).toBe(1)

      const rows = await tx
        .select({ windowDays: complianceReminders.windowDays })
        .from(complianceReminders)
        .innerJoin(
          subcontractorDocuments,
          eq(subcontractorDocuments.id, complianceReminders.documentId),
        )
        .where(eq(subcontractorDocuments.subcontractorId, SUB_EXPIRING))
      expect(new Set(rows.map((row) => row.windowDays))).toEqual(new Set([7, 30]))
    })
  })
})
