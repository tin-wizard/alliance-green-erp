/**
 * Quotes integration tests.
 *
 * Real Neon branch, transaction always rolled back. Seeds the app-backed site
 * and the legacy service-type/priority lookups the Work Orders conversion uses.
 */
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { getConfig } from '@cls/core/env.server'
import { ALL_PERMISSIONS, ForbiddenError, NotFoundError, ValidationError } from '@cls/core'
import { getDb, type Tx } from '@cls/db'
import {
  auditLog,
  customers,
  generatedDocuments,
  legacyWoPriority,
  legacyWoServtype,
  quotes,
  sites,
  users,
  workOrderNumberSeries,
  workOrders,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type { QuoteCreateInput } from '../types'
import { createQuoteCore } from './create.server'
import {
  deleteStandaloneQuoteCore,
  rejectQuoteCore,
  reviseQuoteCore,
  transitionQuote,
  transitionQuoteCore,
} from './lifecycle.server'
import { convertQuoteCore } from './convert.server'
import { getQuoteDetail } from './get.server'
import { queryQuotes } from './list.server'
import {
  createPackingSlipCore,
  regenerateGeneratedDocument,
  renderQuotePdfCore,
} from './pdf.server'

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

function adminSession(id = '00000000-0000-4000-8000-000000000001'): AuthSessionView {
  return {
    id: 'session-test',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id,
      email: 'admin@example.test',
      username: 'admin',
      displayName: 'Quote Admin',
      role: 'admin',
      subcontractorId: null,
      grants: ALL_PERMISSIONS.map((key) => ({ key, scopeSubcontractorId: null })),
    },
  }
}

function roleSession(
  role: 'technician' | 'subcontractor' | 'supplier',
  keys: string[],
): AuthSessionView {
  return {
    id: 'session-test',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id: '00000000-0000-4000-8000-000000000002',
      email: `${role}@example.test`,
      username: role,
      displayName: role,
      role,
      subcontractorId: role === 'subcontractor' ? 1 : null,
      grants: keys.map((key) => ({ key, scopeSubcontractorId: null })),
    },
  }
}

async function seedReference(tx: Tx): Promise<void> {
  await tx
    .insert(users)
    .values([
      {
        id: '00000000-0000-4000-8000-000000000001',
        email: 'admin@example.test',
        username: 'quote-admin',
        displayName: 'Quote Admin',
        role: 'admin',
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        email: 'role@example.test',
        username: 'quote-role',
        displayName: 'Quote Role',
        role: 'technician',
      },
    ])
    .onConflictDoNothing()
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
  await tx
    .insert(customers)
    .values({ id: 990001, name: 'Quote Customer' })
    .onConflictDoNothing()
  await tx
    .insert(sites)
    .values({
      id: 990001,
      customerId: 990001,
      name: 'Quote Site',
      street: '1 Quote Way',
      city: 'Toronto',
      province: 'ON',
      postalCode: 'M5V 0A1',
    })
    .onConflictDoNothing()
}

const baseQuote: QuoteCreateInput = {
  kind: 'customer',
  siteId: 990001,
  taxCode: 'ON',
  report: 'Replace the failed ballast.',
  notes: 'Quote integration',
  hours: [{ hours: '2', numTechs: 1, rate: '85.00' }],
  parts: [{ partNo: 'BALLAST-1', qty: 3, price: '12.99', costPrice: '8.00' }],
  specialParts: [],
}

describe.skipIf(!databaseConfigured())('quote server functions', () => {
  test('customer quote reserves the work-order number, then converts to that WO', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const admin = adminSession()
      const created = await createQuoteCore(tx, baseQuote, admin)
      expect(created.workOrderNumber).toBeGreaterThan(0)

      const [counter] = await tx
        .select()
        .from(workOrderNumberSeries)
        .where(eq(workOrderNumberSeries.id, 1))
      expect(counter?.nextId).toBe(created.workOrderNumber! + 1)

      const detail = await getQuoteDetail(admin, created.id, tx)
      expect(detail.totals.subtotal).toBe('208.97')
      expect(detail.totals.tax).toBe('27.17')
      expect(detail.totals.total).toBe('236.14')
      expect(detail.totals.margin).toBe('184.97')

      const submitted = await transitionQuoteCore(
        tx,
        { id: created.id, version: detail.version, to: 3 },
        admin,
      )
      const approved = await transitionQuoteCore(
        tx,
        { id: created.id, version: submitted.version, to: 4 },
        admin,
      )
      expect(approved.status).toBe(4)

      const converted = await convertQuoteCore(tx, created.id, admin)
      expect(converted.workOrderId).toBe(created.workOrderNumber)
      const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, converted.workOrderId))
      expect(wo?.siteId).toBe(990001)

      const [quoteRow] = await tx.select().from(quotes).where(eq(quotes.id, created.id))
      expect(quoteRow?.convertedWorkOrderId).toBe(converted.workOrderId)

      await expect(convertQuoteCore(tx, created.id, admin)).rejects.toBeInstanceOf(ValidationError)
    })
  })

  test('quote PDF embeds fonts, records the snapshot and regenerates identically', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const admin = adminSession()
      const created = await createQuoteCore(tx, baseQuote, admin)
      const detail = await getQuoteDetail(admin, created.id, tx)
      const submitted = await transitionQuoteCore(
        tx,
        { id: created.id, version: detail.version, to: 3 },
        admin,
      )
      await transitionQuoteCore(tx, { id: created.id, version: submitted.version, to: 4 }, admin)

      const pdf = await renderQuotePdfCore(tx, created.id, admin)
      expect(pdf.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(pdf.pageCount).toBeGreaterThanOrEqual(1)

      const [row] = await tx
        .select()
        .from(generatedDocuments)
        .where(eq(generatedDocuments.id, pdf.documentId))
      expect(row?.schemaVersion).toBe(1)
      expect(row?.sha256).toBe(pdf.sha256)
      expect(row?.pageCount).toBe(pdf.pageCount)
      expect(row?.storageKey).toMatch(/^generated\/quote\/\d{4}\/\d{2}\//)

      const regenerated = await regenerateGeneratedDocument(pdf.documentId, admin, tx)
      expect(regenerated.sha256).toBe(pdf.sha256)

      const packing = await createPackingSlipCore(
        tx,
        {
          quoteId: created.id,
          notes: 'Left at the dock.',
          parts: [
            {
              quotePartId: detail.parts[0]?.id,
              partNo: detail.parts[0]?.partNo ?? 'BALLAST-1',
              actualQty: 3,
              shippedQty: 2,
              backorderQty: 1,
            },
          ],
          specialParts: [],
        },
        admin,
      )
      expect(packing.pdf.pageCount).toBeGreaterThanOrEqual(1)
      const [slipRow] = await tx
        .select()
        .from(generatedDocuments)
        .where(eq(generatedDocuments.id, packing.pdf.documentId))
      expect(slipRow?.kind).toBe('packing-slip')
      expect(slipRow?.entityType).toBe('quote_packing_slip')
    })
  })

  test('a revision points at its predecessor and moves the chain end', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const admin = adminSession()
      const created = await createQuoteCore(tx, baseQuote, admin)
      const detail = await getQuoteDetail(admin, created.id, tx)
      const submitted = await transitionQuoteCore(
        tx,
        { id: created.id, version: detail.version, to: 3 },
        admin,
      )
      await transitionQuoteCore(tx, { id: created.id, version: submitted.version, to: 4 }, admin)

      const revision = await reviseQuoteCore(tx, { id: created.id }, admin)
      expect(revision.revisionId).toBe('0.1')

      const [oldRow] = await tx.select().from(quotes).where(eq(quotes.id, created.id))
      const [newRow] = await tx.select().from(quotes).where(eq(quotes.id, revision.id))
      expect(oldRow?.isLastRevision).toBe(false)
      expect(newRow?.isLastRevision).toBe(true)
      expect(newRow?.revisionQuoteId).toBe(created.id)
      expect(newRow?.rootQuoteId).toBe(created.id)
      expect(newRow?.status).toBe(1)
      expect(newRow?.workOrderNumber).toBe(created.workOrderNumber)

      const newDetail = await getQuoteDetail(admin, revision.id, tx)
      expect(newDetail.totals.total).toBe('236.14')
    })
  })

  test('rejection is recorded and resubmission creates a waiting revision', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const admin = adminSession()
      const created = await createQuoteCore(tx, baseQuote, admin)
      const detail = await getQuoteDetail(admin, created.id, tx)
      const submitted = await transitionQuoteCore(
        tx,
        { id: created.id, version: detail.version, to: 3 },
        admin,
      )

      const rejected = await rejectQuoteCore(
        tx,
        {
          id: created.id,
          version: submitted.version,
          reason: 'Customer chose the alternate fixture.',
        },
        admin,
      )
      expect(rejected.status).toBe(5)

      const detailAfter = await getQuoteDetail(admin, created.id, tx)
      expect(detailAfter.rejections).toHaveLength(1)

      const resubmitted = await reviseQuoteCore(
        tx,
        { id: created.id, reason: 'Revised pricing.', submit: true },
        admin,
      )
      const [newRow] = await tx.select().from(quotes).where(eq(quotes.id, resubmitted.id))
      expect(newRow?.status).toBe(3)
      expect(newRow?.revisionId).toBe('0.1')
    })
  })

  test('standalone quotes keep Saved and soft delete hides them from list and detail', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const admin = adminSession()
      const created = await createQuoteCore(
        tx,
        {
          ...baseQuote,
          kind: 'standalone',
          saveAsSaved: true,
          createdFromLocal: true,
        },
        admin,
      )
      expect(created.workOrderNumber).toBeNull()

      const detail = await getQuoteDetail(admin, created.id, tx)
      expect(detail.status).toBe(2)
      expect(detail.createdFromLocal).toBe(true)

      await deleteStandaloneQuoteCore(tx, created.id, admin)
      await expect(getQuoteDetail(admin, created.id, tx)).rejects.toBeInstanceOf(NotFoundError)
      const list = await queryQuotes(admin, { kind: 'standalone' }, tx)
      expect(list.rows.some((row) => row.id === created.id)).toBe(false)
    })
  })

  test('illegal transitions are rejected with both statuses named', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const admin = adminSession()
      const created = await createQuoteCore(tx, baseQuote, admin)
      const detail = await getQuoteDetail(admin, created.id, tx)
      await expect(
        transitionQuoteCore(tx, { id: created.id, version: detail.version, to: 4 }, admin),
      ).rejects.toThrow(/In Progress → Approved/)
    })
  })

  test('subcontractor, technician approval and supplier are denied at the server boundary', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const admin = adminSession()
      const created = await createQuoteCore(tx, baseQuote, admin)

      await expect(
        getQuoteDetail(roleSession('subcontractor', ['quote:read']), created.id, tx),
      ).rejects.toBeInstanceOf(ForbiddenError)

      const technician = roleSession('technician', ['quote:read', 'quote:write'])
      const detail = await getQuoteDetail(technician, created.id, tx)
      const submitted = await transitionQuoteCore(
        tx,
        { id: created.id, version: detail.version, to: 3 },
        technician,
      )
      await expect(
        transitionQuoteCore(tx, { id: created.id, version: submitted.version, to: 4 }, technician),
      ).rejects.toBeInstanceOf(ForbiddenError)

      await expect(getQuoteDetail(roleSession('supplier', []), created.id, tx)).rejects.toBeInstanceOf(
        ForbiddenError,
      )
    })
  })
  test('concurrent saves reserve distinct numbers and cancellation returns none', async () => {
    const db = getDb()
    const suffix = randomUUID().slice(0, 8)
    const admin = adminSession(randomUUID())
    const email = `quote-concurrency-${suffix}@example.test`
    const siteId = 991001
    const createdIds: number[] = []
    let startingNext: number | null = null
    let lastReserved: number | null = null

    const create = () => db.transaction((tx) => createQuoteCore(tx, { ...baseQuote, siteId }, admin))

    try {
      await db.transaction(async (tx) => {
        await tx
          .insert(users)
          .values({
            id: admin.user.id,
            email,
            username: `quote-concurrency-${suffix}`,
            displayName: 'Concurrency Admin',
            role: 'admin',
          })
          .onConflictDoNothing()
        await tx
          .insert(customers)
          .values({ id: siteId, name: `Concurrency Customer ${suffix}` })
          .onConflictDoNothing()
        await tx
          .insert(sites)
          .values({
            id: siteId,
            customerId: siteId,
            name: `Concurrency Site ${suffix}`,
            street: '1 Concurrency Way',
            city: 'Toronto',
            province: 'ON',
            postalCode: 'M5V 0A1',
          })
          .onConflictDoNothing()
      })

      const [seriesRow] = await db
        .select()
        .from(workOrderNumberSeries)
        .where(eq(workOrderNumberSeries.id, 1))
      startingNext = seriesRow?.nextId ?? null

      const [first, second] = await Promise.all([create(), create()])
      createdIds.push(first.id, second.id)

      expect(first.workOrderNumber).not.toBeNull()
      expect(second.workOrderNumber).not.toBeNull()
      expect(first.workOrderNumber).not.toBe(second.workOrderNumber)
      const [low, high] = [first.workOrderNumber!, second.workOrderNumber!].sort((a, b) => a - b)
      expect(high! - low!).toBe(1)

      const firstDetail = await getQuoteDetail(admin, first.id, db)
      const cancelled = await transitionQuote(
        { id: first.id, version: firstDetail.version, to: 5 },
        admin,
        db,
      )
      expect(cancelled.status).toBe(5)
      const [afterCancel] = await db
        .select()
        .from(workOrderNumberSeries)
        .where(eq(workOrderNumberSeries.id, 1))
      // `Promise.all` does not promise completion order, so the counter is
      // asserted against the higher of the two numbers, not against `second`.
      expect(afterCancel?.nextId).toBe(high! + 1)

      const third = await create()
      createdIds.push(third.id)
      lastReserved = third.workOrderNumber
      expect(third.workOrderNumber).toBe(afterCancel!.nextId!)
    } finally {
      for (const id of createdIds) {
        await db.delete(auditLog).where(and(eq(auditLog.entityType, 'quote'), eq(auditLog.entityId, String(id))))
        await db.delete(generatedDocuments).where(eq(generatedDocuments.entityId, String(id)))
        await db.delete(quotes).where(eq(quotes.id, id))
      }
      await db.delete(users).where(eq(users.id, admin.user.id))
      await db.delete(sites).where(eq(sites.id, siteId))
      await db.delete(customers).where(eq(customers.id, siteId))
      if (startingNext !== null && lastReserved !== null) {
        await db
          .update(workOrderNumberSeries)
          .set({ nextId: startingNext })
          .where(
            and(
              eq(workOrderNumberSeries.id, 1),
              eq(workOrderNumberSeries.nextId, lastReserved + 1),
            ),
          )
      }
    }
  })

})
