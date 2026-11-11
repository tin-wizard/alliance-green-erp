/**
 * Invoicing integration tests. Real database, always rolled back.
 *
 * Covers the snapshot-created lifecycle, rejection/resubmission, payments,
 * stock-posting immutability, the Sage outbox, PDF regeneration and
 * subcontractor scoping.
 */
import { eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'

// 180 s, not 90: the lifecycle test takes ~18 s alone but shares one database
// with the purchasing, RGA and job-runner suites, and the whole `pnpm test` run
// legitimately queues behind them.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })

import { getConfig } from '@cls/core/env.server'
import { ALL_PERMISSIONS, NotFoundError, ValidationError } from '@cls/core'
import { getDb, type Tx } from '@cls/db'
import {
  invoiceLabourLines,
  sageLinks,
  sagePostings,
  salesInvoices,
  sites,
  subcontractorInvoices,
  subcontractors,
  users,
  workOrderHours,
  workOrderTax,
  workOrders,
} from '@cls/db/schema'
import { resetSageInvoiceGateway } from '@cls/sage'
import type { AuthSessionView } from '../../../server/auth.types'
import {
  createInvoiceFromSnapshotCore,
  issueInvoiceCore,
  recordInvoicePaymentCore,
  rejectInvoiceCore,
  resubmitInvoiceCore,
  saveInvoiceDraftCore,
} from './sales.server'
import { getInvoiceDetail } from './get.server'
import {
  processSagePostingCore,
  recordStockPostingCore,
} from './posting.server'
import { regenerateInvoiceDocument, renderInvoicePdfCore } from './pdf.server'
import {
  approveSubcontractorInvoiceCore,
  createSubcontractorInvoiceCore,
  getSubcontractorInvoiceDetail,
  recordSubcontractorPaymentCore,
} from './subcontractor.server'

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

const ADMIN_ID = '00000000-0000-4000-8000-0000000000a1'
const SUB_USER = '00000000-0000-4000-8000-0000000000a2'
const OTHER_SUB_USER = '00000000-0000-4000-8000-0000000000a3'

function adminSession(): AuthSessionView {
  return {
    id: 'session-test',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id: ADMIN_ID,
      email: 'invoice-admin@example.test',
      username: 'invoice-admin',
      displayName: 'Invoice Admin',
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
      email: `sub-${subcontractorId}@example.test`,
      username: `sub-${subcontractorId}`,
      displayName: `Sub ${subcontractorId}`,
      role: 'subcontractor',
      subcontractorId,
      grants: [{ key: 'invoice:read', scopeSubcontractorId: null }],
    },
  }
}

async function seed(tx: Tx): Promise<void> {
  await tx.insert(users).values([
    {
      id: ADMIN_ID,
      email: 'invoice-admin@example.test',
      username: 'invoice-admin',
      displayName: 'Invoice Admin',
      role: 'admin',
    },
    {
      id: SUB_USER,
      email: 'sub-1@example.test',
      username: 'sub-1',
      displayName: 'Sub One',
      role: 'subcontractor',
      subcontractorId: 9_400_001,
    },
    {
      id: OTHER_SUB_USER,
      email: 'sub-2@example.test',
      username: 'sub-2',
      displayName: 'Sub Two',
      role: 'subcontractor',
      subcontractorId: 9_400_002,
    },
  ])
  await tx.insert(sites).values({ id: 9_400_001, customerId: 9_400_010, name: 'Invoice test site' })
  await tx.insert(subcontractors).values([
    { id: 9_400_001, name: 'Sub One Ltd' },
    { id: 9_400_002, name: 'Sub Two Ltd' },
  ])
  await tx.insert(workOrders).values([
    {
      id: 9_400_001,
      siteId: 9_400_001,
      status: 2,
      serviceRequired: 'Invoice lifecycle',
      completedAt: new Date('2026-02-01T12:00:00Z'),
    },
    {
      id: 9_400_002,
      siteId: 9_400_001,
      status: 2,
      serviceRequired: 'Immutable invoice',
    },
    {
      id: 9_400_003,
      siteId: 9_400_001,
      status: 2,
      serviceRequired: 'Subcontractor work',
      subcontractorId: 9_400_001,
    },
    {
      id: 9_400_004,
      siteId: 9_400_001,
      status: 2,
      serviceRequired: 'Other subcontractor work',
      subcontractorId: 9_400_002,
    },
  ])
  await tx.insert(workOrderHours).values([
    {
      workOrderId: 9_400_001,
      lineDate: '2026-02-01',
      hours: '2.00',
      rateCode: 1,
      hourlyRate: '50.00',
      note: 'Service labour',
    },
  ])
  await tx.insert(workOrderTax).values({
    workOrderId: 9_400_001,
    taxProvince: 'ON',
  })
  await tx.insert(workOrderHours).values({
    workOrderId: 9_400_003,
    lineDate: '2026-02-01',
    hours: '1.00',
    rateCode: 1,
    hourlyRate: '80.00',
    note: 'Subcontractor labour',
  })
  await tx.insert(workOrderHours).values({
    workOrderId: 9_400_002,
    lineDate: '2026-02-01',
    hours: '1.00',
    rateCode: 1,
    hourlyRate: '20.00',
    note: 'Immutable labour',
  })
  await tx.insert(workOrderTax).values({
    workOrderId: 9_400_002,
    taxProvince: 'ON',
  })
  await tx.insert(workOrderTax).values({
    workOrderId: 9_400_003,
    taxProvince: 'ON',
  })
}

describe.skipIf(!databaseConfigured())('Invoicing lifecycle', () => {
  test('snapshot create → edit → issue → reject → resubmit → payments', async () => {
    resetSageInvoiceGateway()
    await inRollback(async (tx) => {
      await seed(tx)
      const session = adminSession()

      const created = await createInvoiceFromSnapshotCore(tx, { workOrderId: 9_400_001 }, session)
      expect(created.existing).toBe(false)
      const [row] = await tx
        .select()
        .from(salesInvoices)
        .where(eq(salesInvoices.id, created.invoiceId))
      expect(row!.status).toBe('draft')
      expect(row!.labourAmount).toBe('100.00')
      expect(row!.taxAmount).toBe('13.00')
      expect(row!.totalAmount).toBe('113.00')

      const detail = await getInvoiceDetail(session, created.invoiceId, tx)
      expect(detail.labour).toHaveLength(1)
      expect(detail.invoice.invoiceNumber).toBe('INV-9400001')

      const saved = await saveInvoiceDraftCore(
        tx,
        {
          invoiceId: created.invoiceId,
          version: created.version,
          taxProvince: 'ON',
          appliedTaxRate: null,
          appliedTaxRatePst: null,
          manualTaxAmount: null,
          manualSubtotalAmount: null,
          notes: 'Edited snapshot',
          labour: [
            {
              date: '2026-02-01',
              hours: '3.00',
              rateCode: 1,
              hourlyRate: '50.00',
              description: 'Service labour',
            },
          ],
          parts: [],
          specialParts: [],
          totals: {
            labour: '150.00',
            material: '0.00',
            subtotal: '150.00',
            tax: '19.50',
            total: '169.50',
          },
        },
        session,
      )
      expect(saved.version).toBe(created.version + 1)
      const [edited] = await tx
        .select()
        .from(salesInvoices)
        .where(eq(salesInvoices.id, created.invoiceId))
      expect(edited!.totalAmount).toBe('169.50')
      const editedLines = await tx
        .select()
        .from(invoiceLabourLines)
        .where(eq(invoiceLabourLines.invoiceId, created.invoiceId))
      expect(editedLines).toHaveLength(1)
      expect(editedLines[0]!.amount).toBe('150.00')

      const issued = await issueInvoiceCore(
        tx,
        { invoiceId: created.invoiceId, version: saved.version },
        session,
      )
      expect(issued.status).toBe('issued')
      expect(issued.documentId).toBeTruthy()
      const [queued] = await tx
        .select()
        .from(sagePostings)
        .where(eq(sagePostings.docId, created.invoiceId))
      expect(queued!.status).toBe('queued')
      expect(queued!.externalRef).toBe(`cls:sales_invoice:${created.invoiceId}`)

      const rejected = await rejectInvoiceCore(
        tx,
        { invoiceId: created.invoiceId, reason: 'Customer disputing labour hours' },
        session,
      )
      expect(rejected.status).toBe('rejected')
      const afterReject = await getInvoiceDetail(session, created.invoiceId, tx)
      expect(afterReject.rejections[0]?.reason).toBe('Customer disputing labour hours')

      const resubmitted = await resubmitInvoiceCore(tx, { invoiceId: created.invoiceId }, session)
      expect(resubmitted.status).toBe('draft')

      const issuedAgain = await issueInvoiceCore(
        tx,
        { invoiceId: created.invoiceId, version: resubmitted.version },
        session,
      )
      expect(issuedAgain.status).toBe('issued')

      const partial = await recordInvoicePaymentCore(
        tx,
        {
          invoiceId: created.invoiceId,
          amount: '50.00',
          idempotencyKey: 'test-payment-0001',
        },
        session,
      )
      expect(partial.status).toBe('partially_paid')
      const replay = await recordInvoicePaymentCore(
        tx,
        {
          invoiceId: created.invoiceId,
          amount: '50.00',
          idempotencyKey: 'test-payment-0001',
        },
        session,
      )
      expect(replay.replay).toBe(true)
      expect(replay.paidAmount).toBe('50.00')
      const paid = await recordInvoicePaymentCore(
        tx,
        {
          invoiceId: created.invoiceId,
          amount: '119.50',
          idempotencyKey: 'test-payment-0002',
        },
        session,
      )
      expect(paid.status).toBe('paid')
      expect(paid.paidAmount).toBe('169.50')
    })
  })

  test('stock posting locks the invoice and issue is idempotent in Sage', async () => {
    resetSageInvoiceGateway()
    await inRollback(async (tx) => {
      await seed(tx)
      const session = adminSession()
      const created = await createInvoiceFromSnapshotCore(tx, { workOrderId: 9_400_002 }, session)
      await recordStockPostingCore(
        tx,
        { invoiceId: created.invoiceId, reference: 'test-stock', movementCount: 2 },
        session,
      )
      await expect(
        saveInvoiceDraftCore(
          tx,
          {
            invoiceId: created.invoiceId,
            version: created.version,
            taxProvince: 'ON',
            labour: [
              {
                date: '2026-02-01',
                hours: '1.00',
                rateCode: 1,
                hourlyRate: '10.00',
                description: null,
              },
            ],
            parts: [],
            specialParts: [],
            totals: { labour: '10.00', material: '0.00', subtotal: '10.00', tax: '1.30', total: '11.30' },
          },
          session,
        ),
      ).rejects.toBeInstanceOf(ValidationError)

      // A second invoice proves the Sage outbox is idempotent by external ref.
      const second = await createInvoiceFromSnapshotCore(tx, { workOrderId: 9_400_003 }, session)
      const issued = await issueInvoiceCore(
        tx,
        { invoiceId: second.invoiceId, version: second.version },
        session,
      )
      expect(issued.status).toBe('issued')
      const [posting] = await tx
        .select()
        .from(sagePostings)
        .where(eq(sagePostings.docId, second.invoiceId))
      const first = await processSagePostingCore(tx, posting!.id, session)
      expect(first.status).toBe('sent')
      const again = await processSagePostingCore(tx, posting!.id, session)
      expect(again.status).toBe('sent')
      expect(again.externalId).toBe(first.externalId)
      const links = await tx
        .select()
        .from(sageLinks)
        .where(eq(sageLinks.externalRef, `cls:sales_invoice:${second.invoiceId}`))
      expect(links).toHaveLength(1)
    })
  })

  test('PDF regeneration is byte-identical from the stored snapshot', async () => {
    resetSageInvoiceGateway()
    await inRollback(async (tx) => {
      await seed(tx)
      const session = adminSession()
      const created = await createInvoiceFromSnapshotCore(tx, { workOrderId: 9_400_001 }, session)
      const first = await renderInvoicePdfCore(tx, created.invoiceId, session)
      const regenerated = await regenerateInvoiceDocument(first.documentId, session, tx)
      expect(regenerated.sha256).toBe(first.sha256)
      expect(regenerated.byteSize).toBe(first.byteSize)
    })
  })

  test('subcontractor submit/approve/pay and cross-subcontractor denial', async () => {
    resetSageInvoiceGateway()
    await inRollback(async (tx) => {
      await seed(tx)
      const admin = adminSession()
      const subOne = subSession(SUB_USER, 9_400_001)
      const subTwo = subSession(OTHER_SUB_USER, 9_400_002)

      const submitted = await createSubcontractorInvoiceCore(
        tx,
        {
          workOrderId: 9_400_003,
          invoiceNumber: 'SUB-1001',
          invoiceDate: '2026-02-02',
          taxProvince: 'ON',
          notes: 'February work',
          lines: [
            { kind: 'labour', description: 'Install', qty: '2', rate: '100.00' },
          ],
        },
        subOne,
      )
      expect(submitted.status).toBe('submitted')
      const [invoice] = await tx
        .select()
        .from(subcontractorInvoices)
        .where(eq(subcontractorInvoices.id, submitted.invoiceId))
      expect(invoice!.totalAmount).toBe('226.00')

      await expect(
        getSubcontractorInvoiceDetail(subTwo, submitted.invoiceId, tx),
      ).rejects.toBeInstanceOf(NotFoundError)
      await expect(
        createSubcontractorInvoiceCore(
          tx,
          {
            workOrderId: 9_400_004,
            invoiceNumber: 'SUB-1001',
            invoiceDate: '2026-02-02',
            taxProvince: 'ON',
            lines: [{ kind: 'labour', qty: '1', rate: '10.00' }],
          },
          subTwo,
        ),
      ).resolves.toBeTruthy()

      const approved = await approveSubcontractorInvoiceCore(
        tx,
        { invoiceId: submitted.invoiceId, version: submitted.version },
        admin,
      )
      expect(approved.status).toBe('approved')
      const payment = await recordSubcontractorPaymentCore(
        tx,
        {
          invoiceId: submitted.invoiceId,
          amount: '226.00',
          idempotencyKey: 'sub-payment-0001',
        },
        admin,
      )
      expect(payment.status).toBe('paid')
    })
  })
})
