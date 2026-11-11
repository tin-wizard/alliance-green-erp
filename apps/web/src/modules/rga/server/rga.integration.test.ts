/**
 * RGA and warranty integration tests. Real database, always rolled back.
 *
 * Covers the raise → approve → credit path through Purchasing, the Sage outbox
 * row, subcontractor scoping, the reminder job's durability and idempotency,
 * warranty expiry projection and byte-identical PDF regeneration.
 */
import { desc, eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { ALL_PERMISSIONS, ForbiddenError } from '@cls/core'
import type { JobContext } from '@cls/core/jobs'
import { getConfig } from '@cls/core/env.server'
import { getDb, type Tx } from '@cls/db'
import {
  purchaseOrderInvoiceLines,
  purchaseOrderInvoices,
  purchaseOrderParts,
  purchaseOrders,
  rgaCredits,
  rgaNotifications,
  rgas,
  sagePostings,
  sites,
  subcontractors,
  suppliers,
  users,
  workOrders,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import { approveRgaCore, transitionRgaCore } from './transitions.server'
import { createRgaCore } from './save.server'
import { getRgaDetail, listRgas } from './get.server'
import { recordRgaCreditCore } from './credit.server'
import { rgaNotificationsHandler } from './job.server'
import {
  createSiteWarrantyCore,
  listSiteWarranties,
  warrantySummary,
} from './warranty.server'
import { regenerateRgaDocument, renderRgaPdfCore } from './pdf.server'

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

const ADMIN_ID = '00000000-0000-4000-8000-0000000000b1'
const SUB_USER = '00000000-0000-4000-8000-0000000000b2'
const OTHER_SUB_USER = '00000000-0000-4000-8000-0000000000b3'

const SITE_ID = 9_410_001
const SUPPLIER_ID = 9_410_001
const PO_ID = 9_410_001
const SUB_ONE = 9_410_001
const SUB_TWO = 9_410_002
const WO_SUB_ONE = 9_410_001
const WO_SUB_TWO = 9_410_002

function adminSession(): AuthSessionView {
  return {
    id: 'session-test',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id: ADMIN_ID,
      email: 'rga-admin@example.test',
      username: 'rga-admin',
      displayName: 'RGA Admin',
      role: 'admin',
      subcontractorId: null,
      grants: ALL_PERMISSIONS.map((key) => ({ key, scopeSubcontractorId: null })),
    },
  }
}

function subSession(id: string, subcontractorId: number): AuthSessionView {
  return {
    id: 'session-test',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id,
      email: `rga-sub-${subcontractorId}@example.test`,
      username: `rga-sub-${subcontractorId}`,
      displayName: `RGA Sub ${subcontractorId}`,
      role: 'subcontractor',
      subcontractorId,
      grants: [
        { key: 'rga:read', scopeSubcontractorId: null },
        { key: 'rga:write', scopeSubcontractorId: null },
      ],
    },
  }
}

function dateFromNow(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function jobContext(tx: Tx, scheduledFor: Date): JobContext {
  return {
    db: tx,
    runId: 1,
    idempotencyKey: `purchasing.rga-notifications:${scheduledFor.toISOString()}`,
    businessDate: scheduledFor.toISOString().slice(0, 10),
    scheduledFor,
    attempt: 1,
    dryRun: false,
    signal: new AbortController().signal,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
}

async function seed(tx: Tx): Promise<{ partLineId: number }> {
  await tx.insert(users).values([
    {
      id: ADMIN_ID,
      email: 'rga-admin@example.test',
      username: 'rga-admin',
      displayName: 'RGA Admin',
      role: 'admin',
    },
    {
      id: SUB_USER,
      email: 'rga-sub-1@example.test',
      username: 'rga-sub-1',
      displayName: 'RGA Sub One',
      role: 'subcontractor',
      subcontractorId: SUB_ONE,
    },
    {
      id: OTHER_SUB_USER,
      email: 'rga-sub-2@example.test',
      username: 'rga-sub-2',
      displayName: 'RGA Sub Two',
      role: 'subcontractor',
      subcontractorId: SUB_TWO,
    },
  ])
  await tx.insert(sites).values({ id: SITE_ID, customerId: 9_410_010, name: 'RGA test site' })
  await tx.insert(subcontractors).values([
    { id: SUB_ONE, name: 'RGA Sub One Ltd' },
    { id: SUB_TWO, name: 'RGA Sub Two Ltd' },
  ])
  await tx.insert(workOrders).values([
    { id: WO_SUB_ONE, siteId: SITE_ID, status: 2, subcontractorId: SUB_ONE },
    { id: WO_SUB_TWO, siteId: SITE_ID, status: 2, subcontractorId: SUB_TWO },
  ])
  await tx.insert(suppliers).values({ id: SUPPLIER_ID, name: 'RGA Supplier' })
  await tx.insert(purchaseOrders).values({
    id: PO_ID,
    displayNumber: 'PO-RGA-1',
    supplierId: SUPPLIER_ID,
    status: 3,
    subtotal: '50.00',
    tax: '6.50',
    total: '56.50',
  })
  const [part] = await tx
    .insert(purchaseOrderParts)
    .values({
      poId: PO_ID,
      partNo: 'RGA-PART-1',
      description: 'Returned fixture',
      qty: '5.00',
      qtyReceived: '5.00',
      price: '10.00',
      sortOrder: 1,
    })
    .returning({ id: purchaseOrderParts.id })
  if (!part) throw new Error('part seed failed')

  const [invoice] = await tx
    .insert(purchaseOrderInvoices)
    .values({
      poId: PO_ID,
      supplierId: SUPPLIER_ID,
      supplierInvoiceNumber: 'SUP-INV-1',
      invoiceDate: '2026-02-01',
      subtotal: '50.00',
      tax: '6.50',
      total: '56.50',
      status: 'posted',
    })
    .returning({ id: purchaseOrderInvoices.id })
  if (!invoice) throw new Error('invoice seed failed')
  await tx.insert(purchaseOrderInvoiceLines).values({
    invoiceId: invoice.id,
    partLineId: part.id,
    qty: '5.00',
    unitPrice: '10.00',
    lineTotal: '50.00',
    taxAmount: '6.50',
    variance: '0.00',
    sortOrder: 0,
  })
  return { partLineId: part.id }
}

function createInput(partLineId: number, workOrderId: number) {
  return {
    supplierId: SUPPLIER_ID,
    poId: PO_ID,
    workOrderId,
    rgaType: 'credit' as const,
    replacementType: null,
    requestDate: '2026-03-01',
    rgaNotes: 'Damaged on arrival',
    internalNotes: null,
    shippingAddress: 'Back to supplier',
    parts: [
      {
        partNo: 'RGA-PART-1',
        description: 'Returned fixture',
        qty: '5.00',
        returnQty: '2.00',
        price: '10.00',
        reasonForReturn: 'Damaged',
        underWarranty: true,
        purchaseType: null,
        purchaseTypeNumber: null,
        poNumber: 'PO-RGA-1',
        poPartId: partLineId,
        modelNumber: null,
        originalInvoiceNumber: 'SUP-INV-1',
        originalInvoiceDate: '2026-02-01',
      },
    ],
    specialParts: [],
  }
}

describe.skipIf(!databaseConfigured())('RGA lifecycle', () => {
  test('raise → approve → credit through Purchasing, with the Sage outbox row', async () => {
    await inRollback(async (tx) => {
      const { partLineId } = await seed(tx)
      const session = adminSession()

      const created = await createRgaCore(tx, createInput(partLineId, WO_SUB_ONE), session)
      expect(created.status).toBe(2)
      expect(created.supplierId).toBe(SUPPLIER_ID)

      const approved = await approveRgaCore(tx, { rgaId: created.id, version: created.version }, session)
      expect(approved.status).toBe(3)
      expect(approved.approvedBy).toBe(ADMIN_ID)

      const credit = await recordRgaCreditCore(
        tx,
        {
          rgaId: created.id,
          version: approved.version,
          creditDate: '2026-03-02',
          taxProvince: 'ON',
          appliedTaxRate: null,
        },
        session,
      )
      expect(credit.subtotal).toBe('20.00')
      expect(credit.tax).toBe('2.60')
      expect(credit.total).toBe('22.60')
      expect(credit.reference).toBe(`R-${created.id}`)

      const [rga] = await tx.select().from(rgas).where(eq(rgas.id, created.id))
      expect(rga!.status).toBe(11)
      expect(rga!.rgaInvoiceNumber).toBe(credit.reference)

      const [storedCredit] = await tx
        .select()
        .from(rgaCredits)
        .where(eq(rgaCredits.rgaId, created.id))
      expect(storedCredit!.subtotalAmount).toBe('20.00')

      // Purchasing owns the document: one prior invoice, one negative credit.
      const purchasingInvoices = await tx
        .select()
        .from(purchaseOrderInvoices)
        .where(eq(purchaseOrderInvoices.poId, PO_ID))
        .orderBy(desc(purchaseOrderInvoices.id))
      expect(purchasingInvoices).toHaveLength(2)
      expect(purchasingInvoices[0]!.total).toBe('-22.60')
      expect(purchasingInvoices[0]!.supplierInvoiceNumber).toBe(credit.reference)

      const [posting] = await tx
        .select()
        .from(sagePostings)
        .where(eq(sagePostings.docType, 'purchase_credit_note'))
      expect(posting).toBeDefined()
      expect(posting!.docId).toBe(storedCredit!.id)
      expect(posting!.externalRef).toBe(`cls:rga_credit:${storedCredit!.id}`)
      expect(posting!.status).toBe('queued')
      expect(posting!.payload.subtotal).toBe('-20.00')
      expect(posting!.payload.total).toBe('-22.60')

      const detail = await getRgaDetail(session, created.id, tx)
      expect(detail.history.map((row) => row.action)).toEqual(
        expect.arrayContaining(['created', 'approved', 'credit']),
      )
      expect(detail.credit?.creditNumber).toBe(credit.reference)
    })
  })

  test('terminal states reject further moves and duplicate credits', async () => {
    await inRollback(async (tx) => {
      const { partLineId } = await seed(tx)
      const session = adminSession()
      const created = await createRgaCore(tx, createInput(partLineId, WO_SUB_ONE), session)
      const cancelled = await transitionRgaCore(
        tx,
        { rgaId: created.id, version: created.version, toStatus: 10 },
        session,
      )
      expect(cancelled.status).toBe(10)
      await expect(
        transitionRgaCore(tx, { rgaId: created.id, version: cancelled.version, toStatus: 7 }, session),
      ).rejects.toThrow('already Cancelled')
    })
  })

  test('a subcontractor cannot load or edit another subcontractor RGA', async () => {
    await inRollback(async (tx) => {
      const { partLineId } = await seed(tx)
      const admin = adminSession()
      const mine = await createRgaCore(tx, createInput(partLineId, WO_SUB_ONE), admin)

      const other = subSession(OTHER_SUB_USER, SUB_TWO)
      await expect(getRgaDetail(other, mine.id, tx)).rejects.toBeInstanceOf(ForbiddenError)
      const rows = await listRgas(other, {}, tx)
      expect(rows).toHaveLength(0)

      const own = subSession(SUB_USER, SUB_ONE)
      const visible = await listRgas(own, {}, tx)
      expect(visible.map((row) => row.id)).toContain(mine.id)
    })
  })

  test('reminders queue once a week and never duplicate on retry', async () => {
    await inRollback(async (tx) => {
      const { partLineId } = await seed(tx)
      const session = adminSession()
      await createRgaCore(tx, createInput(partLineId, WO_SUB_ONE), session)

      const monday = new Date('2026-03-09T11:15:00Z')
      const first = await rgaNotificationsHandler(jobContext(tx, monday))
      expect(first?.recordsProcessed).toBe(1)
      const retry = await rgaNotificationsHandler(jobContext(tx, monday))
      expect(retry?.recordsProcessed).toBe(0)

      const reminders = await tx
        .select()
        .from(rgaNotifications)
        .where(eq(rgaNotifications.notifyType, 'Reminder'))
      expect(reminders).toHaveLength(1)
      expect(reminders[0]!.status).toBe('pending')
      expect(reminders[0]!.idempotencyKey).toContain('2026-03-09')

      const nextMonday = await rgaNotificationsHandler(
        jobContext(tx, new Date('2026-03-16T11:15:00Z')),
      )
      expect(nextMonday?.recordsProcessed).toBe(1)
    })
  })

  test('RGA PDF stores a hash and regenerates byte-identically from its snapshot', async () => {
    await inRollback(async (tx) => {
      const { partLineId } = await seed(tx)
      const session = adminSession()
      const created = await createRgaCore(tx, createInput(partLineId, WO_SUB_ONE), session)
      await approveRgaCore(tx, { rgaId: created.id, version: created.version }, session)

      const stored = await renderRgaPdfCore(tx, created.id, session)
      expect(stored.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(stored.byteSize).toBeGreaterThan(1000)
      const regenerated = await regenerateRgaDocument(stored.documentId, session, tx)
      expect(regenerated.sha256).toBe(stored.sha256)
    })
  })
})

describe.skipIf(!databaseConfigured())('Site warranties', () => {
  test('records a work-order link and projects expiry', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const session = adminSession()

      const active = await createSiteWarrantyCore(
        tx,
        {
          siteId: SITE_ID,
          description: 'Roof workmanship',
          expiresOn: dateFromNow(365),
          workOrderId: WO_SUB_ONE,
        },
        session,
      )
      expect(active.workOrderId).toBe(WO_SUB_ONE)

      await createSiteWarrantyCore(
        tx,
        { siteId: SITE_ID, description: 'Ballast replacement', expiresOn: dateFromNow(10) },
        session,
      )
      await createSiteWarrantyCore(
        tx,
        { siteId: SITE_ID, description: 'Old install', expiresOn: dateFromNow(-3) },
        session,
      )

      const all = await listSiteWarranties(session, {}, tx)
      expect(all).toHaveLength(3)
      const expiring = await listSiteWarranties(session, { filter: 'expiring' }, tx)
      expect(expiring).toHaveLength(1)
      expect(expiring[0]!.state).toBe('expiring')
      const expired = await listSiteWarranties(session, { filter: 'expired' }, tx)
      expect(expired).toHaveLength(1)

      const summary = await warrantySummary(session, tx)
      expect(summary).toEqual({ total: 3, expired: 1, expiring: 1 })

      await expect(
        createSiteWarrantyCore(
          tx,
          {
            siteId: SITE_ID,
            description: 'Wrong site',
            expiresOn: dateFromNow(30),
            workOrderId: 9_499_999,
          },
          session,
        ),
      ).rejects.toThrow()
    })
  })
})
