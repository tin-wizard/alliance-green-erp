/**
 * TJX work-order conversion and links. Real database, rolled back.
 */
import { desc, eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { ALL_PERMISSIONS, ForbiddenError, ValidationError } from '@cls/core'
import { getConfig } from '@cls/core/env.server'
import { getDb, type Tx } from '@cls/db'
import {
  auditLog,
  customers,
  legacyWoPriority,
  legacyWoServtype,
  sites,
  tjxQuoteWorkOrders,
  tjxQuotes,
  users,
  workOrders,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type { TjxQuoteCreateInput, TjxQuoteSaveInput } from '../types'
import { createQuoteCore, saveQuoteCore } from './quotes.server'
import { approveQuoteCore, submitQuoteCore } from './lifecycle.server'
import {
  convertQuoteCore,
  linkWorkOrderCore,
  unlinkWorkOrderCore,
} from './workorders.server'
import { createWorkOrderCore } from '../../work-orders/server/create.server'

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

const ADMIN_ID = '00000000-0000-4000-8000-0000000000f1'
const WRITER_ID = '00000000-0000-4000-8000-0000000000f2'
const CUSTOMER_ID = 9_450_001
const SITE_ID = 9_450_001

function adminSession(): AuthSessionView {
  return {
    id: 'session-tjx-workorders',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id: ADMIN_ID,
      email: 'tjx-workorders-admin@example.test',
      username: 'tjx-workorders-admin',
      displayName: 'TJX Work Orders Admin',
      role: 'admin',
      subcontractorId: null,
      grants: ALL_PERMISSIONS.map((key) => ({ key, scopeSubcontractorId: null })),
    },
  }
}

function writerSession(): AuthSessionView {
  return {
    id: 'session-tjx-workorders-writer',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id: WRITER_ID,
      email: 'tjx-workorders-writer@example.test',
      username: 'tjx-workorders-writer',
      displayName: 'TJX Work Orders Writer',
      role: 'technician',
      subcontractorId: null,
      grants: [
        { key: 'tjx:read', scopeSubcontractorId: null },
        { key: 'tjx:write', scopeSubcontractorId: null },
        { key: 'workorder:read', scopeSubcontractorId: null },
      ],
    },
  }
}

async function seed(tx: Tx): Promise<void> {
  await tx.insert(users).values([
    {
      id: ADMIN_ID,
      email: 'tjx-workorders-admin@example.test',
      username: 'tjx-workorders-admin',
      displayName: 'TJX Work Orders Admin',
      role: 'admin',
    },
    {
      id: WRITER_ID,
      email: 'tjx-workorders-writer@example.test',
      username: 'tjx-workorders-writer',
      displayName: 'TJX Work Orders Writer',
      role: 'technician',
    },
  ])
  await tx.insert(customers).values({ id: CUSTOMER_ID, name: 'TJX WO Customer' })
  await tx.insert(sites).values({
    id: SITE_ID,
    customerId: CUSTOMER_ID,
    name: 'TJX WO Site',
    street: '3 Work Order Way',
    city: 'Toronto',
    province: 'ON',
    postalCode: 'M5V 1A3',
  })
  await tx
    .insert(legacyWoServtype)
    .values([
      { id: 1, name: 'Interior' },
      { id: 2, name: 'Exterior' },
    ])
    .onConflictDoNothing()
  await tx
    .insert(legacyWoPriority)
    .values([
      { id: 1, name: 'High' },
      { id: 3, name: 'Normal' },
    ])
    .onConflictDoNothing()
}

function createInput(): TjxQuoteCreateInput {
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
    shipProvince: null,
    shipPostalCode: null,
    shipPhone: null,
    shippingAddress: null,
    notes: 'Convert me',
    pdfNotes: null,
  }
}

async function approvedQuote(tx: Tx) {
  const created = await createQuoteCore(tx, createInput(), adminSession())
  const input: TjxQuoteSaveInput = {
    ...createInput(),
    id: created.id,
    version: created.version,
    revisionNotes: null,
    rooms: [],
    specialParts: [{ name: 'Freight', quantity: '1', unitPrice: '10.00' }],
    priceOverrides: [],
  }
  const saved = await saveQuoteCore(tx, input, adminSession())
  const submitted = await submitQuoteCore(
    tx,
    { id: saved.id, version: saved.version },
    adminSession(),
  )
  return approveQuoteCore(tx, { id: submitted.id, version: submitted.version }, adminSession())
}

const CONVERT = {
  serviceTypeId: 1,
  priorityId: 3,
  categoryId: null,
  serviceRequired: 'Install TJX fixtures',
}

describe.skipIf(!databaseConfigured())('TJX work orders', () => {
  test('converts an approved quote once and links the primary work order', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const quote = await approvedQuote(tx)

      const result = await convertQuoteCore(
        tx,
        { quoteId: quote.id, version: quote.version, ...CONVERT },
        adminSession(),
      )
      expect(result.created).toBe(true)
      expect(result.workOrderId).toBeGreaterThan(0)
      expect(result.quote.workOrders).toHaveLength(1)
      expect(result.quote.workOrders[0]).toMatchObject({
        workOrderId: result.workOrderId,
        isPrimary: true,
      })

      const [row] = await tx.select().from(workOrders).where(eq(workOrders.id, result.workOrderId))
      expect(row!.siteId).toBe(SITE_ID)
      expect(row!.isProject).toBe(true)
      expect(row!.isTjxQuote).toBe(true)
      expect(row!.serviceRequired).toBe('Install TJX fixtures')

      const retry = await convertQuoteCore(
        tx,
        { quoteId: quote.id, version: quote.version, ...CONVERT },
        adminSession(),
      )
      expect(retry.created).toBe(false)
      expect(retry.workOrderId).toBe(result.workOrderId)

      const links = await tx
        .select()
        .from(tjxQuoteWorkOrders)
        .where(eq(tjxQuoteWorkOrders.quoteId, quote.id))
      expect(links).toHaveLength(1)

      const audits = await tx
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, 'tjx.quote.convert'))
        .orderBy(desc(auditLog.id))
      expect(audits[0]?.entityId).toBe(String(quote.id))
    })
  })

  test('refuses a draft quote and a session without workorder:create', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const created = await createQuoteCore(tx, createInput(), adminSession())
      await expect(
        convertQuoteCore(
          tx,
          { quoteId: created.id, version: created.version, ...CONVERT },
          adminSession(),
        ),
      ).rejects.toBeInstanceOf(ValidationError)

      const quote = await approvedQuote(tx)
      await expect(
        convertQuoteCore(
          tx,
          { quoteId: quote.id, version: quote.version, ...CONVERT },
          writerSession(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  test('refuses a quote with no site', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const quote = await approvedQuote(tx)
      await tx.update(tjxQuotes).set({ siteId: null }).where(eq(tjxQuotes.id, quote.id))

      await expect(
        convertQuoteCore(
          tx,
          { quoteId: quote.id, version: quote.version, ...CONVERT },
          adminSession(),
        ),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  test('links and unlinks extra work orders, but never unlinks the primary', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const quote = await approvedQuote(tx)
      const converted = await convertQuoteCore(
        tx,
        { quoteId: quote.id, version: quote.version, ...CONVERT },
        adminSession(),
      )

      const extra = await createWorkOrderCore(
        tx,
        {
          siteId: SITE_ID,
          serviceTypeId: 1,
          priorityId: 3,
          serviceRequired: 'Extra TJX work',
        },
        adminSession(),
      )

      const linked = await linkWorkOrderCore(
        tx,
        { quoteId: quote.id, version: converted.quote.version, workOrderId: extra.id },
        writerSession(),
      )
      expect(linked.workOrders).toHaveLength(2)
      expect(linked.workOrders.filter((row) => row.isPrimary)).toHaveLength(1)

      const unlinked = await unlinkWorkOrderCore(
        tx,
        { quoteId: quote.id, version: linked.version, workOrderId: extra.id },
        writerSession(),
      )
      expect(unlinked.workOrders).toHaveLength(1)

      await expect(
        unlinkWorkOrderCore(
          tx,
          {
            quoteId: quote.id,
            version: unlinked.version,
            workOrderId: converted.workOrderId,
          },
          writerSession(),
        ),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  test('a session without workorder:read cannot link', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const quote = await approvedQuote(tx)
      const converted = await convertQuoteCore(
        tx,
        { quoteId: quote.id, version: quote.version, ...CONVERT },
        adminSession(),
      )
      const extra = await createWorkOrderCore(
        tx,
        {
          siteId: SITE_ID,
          serviceTypeId: 1,
          priorityId: 3,
          serviceRequired: 'Extra TJX work',
        },
        adminSession(),
      )
      const session = {
        ...writerSession(),
        user: {
          ...writerSession().user,
          grants: [
            { key: 'tjx:read', scopeSubcontractorId: null },
            { key: 'tjx:write', scopeSubcontractorId: null },
          ],
        },
      }
      await expect(
        linkWorkOrderCore(
          tx,
          { quoteId: quote.id, version: converted.quote.version, workOrderId: extra.id },
          session,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})
