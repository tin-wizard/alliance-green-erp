/**
 * TJX subcontractor invoices. Real database, one transaction per test.
 */
import { and, eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { ALL_PERMISSIONS, ForbiddenError, NotFoundError, ValidationError } from '@cls/core'
import { getConfig } from '@cls/core/env.server'
import { getDb, type Tx } from '@cls/db'
import {
  customers,
  legacyWoPriority,
  legacyWoServtype,
  sagePostings,
  sites,
  subcontractorInvoices,
  subcontractors,
  tjxSubInvoiceDocuments,
  tjxSubcontractorRates,
  users,
  workOrderDocuments,
  workOrders,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type { TjxQuoteCreateInput } from '../types'
import { createQuoteCore, saveQuoteCore } from './quotes.server'
import { approveQuoteCore, submitQuoteCore } from './lifecycle.server'
import { convertQuoteCore } from './workorders.server'
import {
  approveSubInvoiceCore,
  getOrCreateSubInvoiceCore,
  rejectSubInvoiceCore,
  saveSubInvoiceCore,
  setSubInvoiceGateCore,
  submitSubInvoiceCore,
} from './subinvoices.server'

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

const ADMIN_ID = '00000000-0000-4000-8000-0000000000e1'
const OFFICE_ID = '00000000-0000-4000-8000-0000000000e2'
const SUB_USER_ID = '00000000-0000-4000-8000-0000000000e3'
const OTHER_SUB_USER_ID = '00000000-0000-4000-8000-0000000000e4'
const CUSTOMER_ID = 9_460_001
const SITE_ID = 9_460_001
const SUB_ID = 9_460_001
const OTHER_SUB_ID = 9_460_002

function adminSession(): AuthSessionView {
  return {
    id: 'session-tjx-sub-admin',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id: ADMIN_ID,
      email: 'tjx-sub-admin@example.test',
      username: 'tjx-sub-admin',
      displayName: 'TJX Sub Admin',
      role: 'admin',
      subcontractorId: null,
      grants: ALL_PERMISSIONS.map((key) => ({ key, scopeSubcontractorId: null })),
    },
  }
}

function officeSession(): AuthSessionView {
  return {
    id: 'session-tjx-sub-office',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id: OFFICE_ID,
      email: 'tjx-sub-office@example.test',
      username: 'tjx-sub-office',
      displayName: 'TJX Sub Office',
      role: 'technician',
      subcontractorId: null,
      grants: [
        { key: 'tjx:read', scopeSubcontractorId: null },
        { key: 'workorder:read', scopeSubcontractorId: null },
      ],
    },
  }
}

function subSession(id = SUB_USER_ID, subcontractorId = SUB_ID): AuthSessionView {
  return {
    id: `session-tjx-sub-${id}`,
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id,
      email: `${id}@example.test`,
      username: id,
      displayName: 'TJX Subcontractor',
      role: 'subcontractor',
      subcontractorId,
      grants: [{ key: 'workorder:capture', scopeSubcontractorId: subcontractorId }],
    },
  }
}

async function seed(tx: Tx): Promise<void> {
  await tx.insert(users).values([
    {
      id: ADMIN_ID,
      email: 'tjx-sub-admin@example.test',
      username: 'tjx-sub-admin',
      displayName: 'TJX Sub Admin',
      role: 'admin',
    },
    {
      id: OFFICE_ID,
      email: 'tjx-sub-office@example.test',
      username: 'tjx-sub-office',
      displayName: 'TJX Sub Office',
      role: 'technician',
    },
  ])
  await tx.insert(subcontractors).values([
    { id: SUB_ID, name: 'TJX Installer' },
    { id: OTHER_SUB_ID, name: 'Other Installer' },
  ])
  await tx.insert(users).values([
    {
      id: SUB_USER_ID,
      email: `${SUB_USER_ID}@example.test`,
      username: SUB_USER_ID,
      displayName: 'TJX Installer User',
      role: 'subcontractor',
      subcontractorId: SUB_ID,
    },
    {
      id: OTHER_SUB_USER_ID,
      email: `${OTHER_SUB_USER_ID}@example.test`,
      username: OTHER_SUB_USER_ID,
      displayName: 'Other Installer User',
      role: 'subcontractor',
      subcontractorId: OTHER_SUB_ID,
    },
  ])
  await tx.insert(customers).values({ id: CUSTOMER_ID, name: 'TJX Sub Customer' })
  await tx.insert(sites).values({
    id: SITE_ID,
    customerId: CUSTOMER_ID,
    name: 'TJX Sub Site',
    street: '4 Install Way',
    city: 'Toronto',
    province: 'ON',
    postalCode: 'M5V 1A4',
  })
  await tx
    .insert(legacyWoServtype)
    .values({ id: 1, name: 'Interior' })
    .onConflictDoNothing()
  await tx
    .insert(legacyWoPriority)
    .values({ id: 3, name: 'Normal' })
    .onConflictDoNothing()
  await tx.insert(tjxSubcontractorRates).values({
    subcontractorId: SUB_ID,
    partNo: 'WIN-100',
    installCostPerUnit: '5.00',
    updatedBy: ADMIN_ID,
  })
}

function quoteInput(): TjxQuoteCreateInput {
  return {
    siteId: SITE_ID,
    quoteType: 'Gen 1',
    ceilingGridType: 2,
    isTypeMaintenance: false,
    paymentTermsCode: 4,
    dueDate: null,
    taxProvince: 'ON',
    appliedTaxRate: null,
    shipToType: null,
    shipContactName: null,
    shipCompany: null,
    shipStreet1: null,
    shipStreet2: null,
    shipCity: null,
    shipProvince: 'ON',
    shipPostalCode: null,
    shipPhone: null,
    shippingAddress: null,
    notes: 'Sub invoice quote',
    pdfNotes: null,
  }
}

async function approvedTjxWorkOrder(tx: Tx): Promise<{ workOrderId: number; quoteId: number }> {
  const created = await createQuoteCore(tx, quoteInput(), adminSession())
  const saved = await saveQuoteCore(
    tx,
    {
      ...quoteInput(),
      id: created.id,
      version: created.version,
      revisionNotes: null,
      rooms: [
        {
          roomId: null,
          roomName: 'Sales Floor',
          fixtures: [
            {
              fixtureId: null,
              fixtureName: 'Troffer 2x4',
              quantity: '10',
              parts: [
                { partNo: 'WIN-100', partType: 'Ballast', markup: '2', ratioPerFixture: '1' },
              ],
            },
          ],
        },
      ],
      specialParts: [],
      priceOverrides: [{ partNo: 'WIN-100', price: '20.00' }],
    },
    adminSession(),
  )
  const submitted = await submitQuoteCore(
    tx,
    { id: saved.id, version: saved.version },
    adminSession(),
  )
  const approved = await approveQuoteCore(
    tx,
    { id: submitted.id, version: submitted.version },
    adminSession(),
  )
  const converted = await convertQuoteCore(
    tx,
    {
      quoteId: approved.id,
      version: approved.version,
      serviceTypeId: 1,
      priorityId: 3,
      categoryId: null,
      serviceRequired: 'Install TJX fixtures',
    },
    adminSession(),
  )
  await tx
    .update(workOrders)
    .set({ subcontractorId: SUB_ID, status: 2 })
    .where(eq(workOrders.id, converted.workOrderId))
  return { workOrderId: converted.workOrderId, quoteId: approved.id }
}

async function addDocument(tx: Tx, workOrderId: number, filename: string): Promise<string> {
  const [row] = await tx
    .insert(workOrderDocuments)
    .values({
      workOrderId,
      kind: 'document',
      storageKey: `test/tjx/${workOrderId}/${filename}`,
      filename,
      contentType: 'application/pdf',
      sizeBytes: 10,
      uploadedBy: SUB_USER_ID,
    })
    .returning()
  return row!.id
}

async function setGate(
  tx: Tx,
  workOrderId: number,
  version: number,
  kind: 'post_project_fc_reading' | 'post_project_photos' | 'signed_work_order',
  documentId: string | null,
) {
  return setSubInvoiceGateCore(
    tx,
    { workOrderId, version, kind, checked: Boolean(documentId), documentId },
    subSession(),
  )
}

async function readyInvoice(tx: Tx) {
  const { workOrderId } = await approvedTjxWorkOrder(tx)
  let invoice = await getOrCreateSubInvoiceCore(tx, workOrderId, subSession())
  const kinds = [
    'post_project_fc_reading',
    'post_project_photos',
    'signed_work_order',
  ] as const
  for (const kind of kinds) {
    invoice = await setGate(tx, workOrderId, invoice.version, kind, await addDocument(tx, workOrderId, `${kind}.pdf`))
  }
  invoice = await saveSubInvoiceCore(
    tx,
    {
      workOrderId,
      version: invoice.version,
      invoiceNumber: 'SUB-100',
      invoiceDate: '2026-11-01',
      taxProvince: 'ON',
      notes: 'Installation complete',
      subNotes: null,
      fixtures: invoice.fixtures.map((fixture) => ({
        quoteFixtureId: fixture.quoteFixtureId,
        roomName: fixture.roomName,
        fixtureName: fixture.fixtureName,
        quotedQuantity: fixture.quotedQuantity,
        installedQuantity: '8',
        discrepancyNotes: null,
        sortOrder: fixture.sortOrder,
      })),
    },
    subSession(),
  )
  return { workOrderId, invoice }
}

describe.skipIf(!databaseConfigured())('TJX subcontractor invoices', () => {
  test('copies the quote fixtures, expands parts and resolves the server rate', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const { workOrderId } = await approvedTjxWorkOrder(tx)
      const invoice = await getOrCreateSubInvoiceCore(tx, workOrderId, subSession())
      expect(invoice.status).toBe('draft')
      expect(invoice.fixtures).toHaveLength(1)
      expect(invoice.fixtures[0]!.quotedQuantity).toBe('10.000')
      expect(invoice.parts).toHaveLength(1)
      expect(invoice.parts[0]).toMatchObject({
        partNo: 'WIN-100',
        quantity: '10.000',
        unitRate: '5.00',
        lineSubtotal: '50.00',
        rateSource: 'quoted_part',
      })
      expect(invoice.subtotal).toBe('50.00')
      expect(invoice.tax).toBe('6.50')
      expect(invoice.total).toBe('56.50')

      const saved = await saveSubInvoiceCore(
        tx,
        {
          workOrderId,
          version: invoice.version,
          invoiceNumber: 'SUB-100',
          invoiceDate: '2026-11-01',
          taxProvince: 'ON',
          notes: null,
          subNotes: null,
          fixtures: invoice.fixtures.map((fixture) => ({
            quoteFixtureId: fixture.quoteFixtureId,
            roomName: fixture.roomName,
            fixtureName: fixture.fixtureName,
            quotedQuantity: fixture.quotedQuantity,
            installedQuantity: '8',
            discrepancyNotes: 'Two damaged',
            sortOrder: fixture.sortOrder,
          })),
        },
        subSession(),
      )
      expect(saved.parts[0]!.quantity).toBe('8.000')
      expect(saved.parts[0]!.lineSubtotal).toBe('40.00')
      expect(saved.total).toBe('45.20')
    })
  })

  test('rejects a missing rate with the part list', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      await tx.delete(tjxSubcontractorRates).where(eq(tjxSubcontractorRates.subcontractorId, SUB_ID))
      const { invoice } = await readyInvoice(tx)
      expect(invoice.missingRates).toContain('WIN-100')
      await expect(
        submitSubInvoiceCore(
          tx,
          { workOrderId: invoice.workOrderId, version: invoice.version },
          subSession(),
        ),
      ).rejects.toThrow(/No install rate for: WIN-100/)
    })
  })

  for (const kind of [
    'post_project_fc_reading',
    'post_project_photos',
    'signed_work_order',
  ] as const) {
    test(`refuses submission when ${kind} has a flag but no document`, async () => {
      await inRollback(async (tx) => {
        await seed(tx)
        const { invoice } = await readyInvoice(tx)
        await tx
          .delete(tjxSubInvoiceDocuments)
          .where(
            and(
              eq(tjxSubInvoiceDocuments.subInvoiceId, invoice.id),
              eq(tjxSubInvoiceDocuments.kind, kind),
            ),
          )
        await expect(
          submitSubInvoiceCore(
            tx,
            { workOrderId: invoice.workOrderId, version: invoice.version },
            subSession(),
          ),
        ).rejects.toThrow(/has no linked document/)
      })
    })
  }

  test('submits the standard invoice, approves it once and queues a Sage posting', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const { workOrderId, invoice } = await readyInvoice(tx)
      const submitted = await submitSubInvoiceCore(
        tx,
        { workOrderId, version: invoice.version },
        subSession(),
      )
      expect(submitted.status).toBe('submitted')
      expect(submitted.invoiceNumber).toBe('SUB-100')
      expect(submitted.subcontractorInvoiceId).toBeGreaterThan(0)
      expect(submitted.submissions[0]).toMatchObject({ revisionNo: 1, outcome: 'submitted' })

      const [standard] = await tx
        .select()
        .from(subcontractorInvoices)
        .where(eq(subcontractorInvoices.id, submitted.subcontractorInvoiceId!))
      expect(standard!.invoiceNumber).toBe('SUB-100')
      expect(standard!.totalAmount).toBe('45.20')

      const approved = await approveSubInvoiceCore(
        tx,
        { workOrderId, version: submitted.version },
        adminSession(),
      )
      expect(approved.status).toBe('approved')
      expect(approved.submissions[0]!.outcome).toBe('approved')

      const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, workOrderId))
      expect(wo!.status).toBe(4)
      const postings = await tx
        .select()
        .from(sagePostings)
        .where(
          and(
            eq(sagePostings.docType, 'subcontractor_invoice'),
            eq(sagePostings.docId, standard!.id),
          ),
        )
      expect(postings).toHaveLength(1)
    })
  })

  test('rejects, then creates a new standard invoice on each resubmission', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const { workOrderId, invoice } = await readyInvoice(tx)
      let current = await submitSubInvoiceCore(
        tx,
        { workOrderId, version: invoice.version },
        subSession(),
      )
      const firstId = current.subcontractorInvoiceId!

      current = await rejectSubInvoiceCore(
        tx,
        { workOrderId, version: current.version, reason: 'Photos are blurry.' },
        adminSession(),
      )
      expect(current.status).toBe('rejected')
      expect(current.rejectedCount).toBe(1)
      expect(current.invoiceNumber).toBe('SUB-100')

      current = await submitSubInvoiceCore(
        tx,
        { workOrderId, version: current.version },
        subSession(),
      )
      const secondId = current.subcontractorInvoiceId!
      expect(secondId).not.toBe(firstId)

      current = await rejectSubInvoiceCore(
        tx,
        { workOrderId, version: current.version, reason: 'Still blurry.' },
        adminSession(),
      )
      expect(current.rejectedCount).toBe(2)
      current = await submitSubInvoiceCore(
        tx,
        { workOrderId, version: current.version },
        subSession(),
      )
      const thirdId = current.subcontractorInvoiceId!
      expect(new Set([firstId, secondId, thirdId]).size).toBe(3)

      const standards = await tx
        .select()
        .from(subcontractorInvoices)
        .where(eq(subcontractorInvoices.workOrderId, workOrderId))
        .orderBy(subcontractorInvoices.id)
      expect(standards.map((row) => row.invoiceNumber)).toEqual([
        'SUB-100',
        'SUB-100-R2',
        'SUB-100-R3',
      ])
      expect(current.invoiceNumber).toBe('SUB-100')
      expect(current.rejectedCount).toBe(2)
      expect(current.submissions.map((row) => row.revisionNo)).toEqual([3, 2, 1])
    })
  })

  test('scopes subcontractor access and keeps office approval behind invoice:write', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const { workOrderId, invoice } = await readyInvoice(tx)
      const submitted = await submitSubInvoiceCore(
        tx,
        { workOrderId, version: invoice.version },
        subSession(),
      )

      await expect(
        getOrCreateSubInvoiceCore(tx, workOrderId, subSession(OTHER_SUB_USER_ID, OTHER_SUB_ID)),
      ).rejects.toBeInstanceOf(NotFoundError)

      const read = await getOrCreateSubInvoiceCore(tx, workOrderId, officeSession())
      expect(read.total).toBe('45.20')
      await expect(
        approveSubInvoiceCore(
          tx,
          { workOrderId, version: submitted.version },
          officeSession(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  test('refuses to edit a submitted invoice', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const { workOrderId, invoice } = await readyInvoice(tx)
      const submitted = await submitSubInvoiceCore(
        tx,
        { workOrderId, version: invoice.version },
        subSession(),
      )
      await expect(
        saveSubInvoiceCore(
          tx,
          {
            workOrderId,
            version: submitted.version,
            invoiceNumber: 'SUB-100',
            invoiceDate: '2026-11-01',
            taxProvince: 'ON',
            notes: null,
            subNotes: null,
            fixtures: [],
          },
          subSession(),
        ),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })
})
