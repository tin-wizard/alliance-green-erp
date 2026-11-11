/**
 * Integration tests for the work-order server functions.
 *
 * Runs against the real Neon Postgres branch when DATABASE_URL is configured
 * (vitest loads the repo `.env`), inside a transaction that is always rolled
 * back. Master-data and reference rows are inserted for the test only; the
 * module never writes to those tables.
 *
 * Covers the primary path (create → dispatch → capture → complete → invoice
 * snapshot) and the authorization denials: subcontractor cross-tenant and
 * technician unassigned.
 */
import { eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'

// The Neon branch is remote; each test opens a transaction and runs several
// round trips. The default 5 s is a client timeout, not a product budget.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })
import { getConfig } from '@cls/core/env.server'
import { ALL_PERMISSIONS, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@cls/core'
import { getDb, type Db, type Tx } from '@cls/db'
import {
  legacyCustomer,
  legacySites,
  legacySubcontractor,
  legacySubcontractorWsibInsuranceDocuments,
  legacyWoPriority,
  legacyWoServtype,
  workOrderNumberSeries,
  workOrderRevisions,
  workOrders,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type { WorkOrderCreateInput } from '../types'
import { createWorkOrderCore } from './create.server'
import { transitionWorkOrderCore } from './transition.server'
import { captureHoursCore, capturePartsCore } from './capture.server'
import { updateWorkOrderCore } from './update.server'
import { buildInvoiceReadySnapshot } from './snapshot.server'
import { loadAccessibleWorkOrder, resolveScope } from './access.server'
import { queryWorkOrders } from './list.server'
import { allocateWorkOrderNumber } from './numbering.server'
import { setSageNumberCollisionSourceForTests } from './sage-collisions.server'
import { calculateSalesInvoice } from '@cls/pricing'

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

function session(overrides: Partial<AuthSessionView['user']> & { id: string }): AuthSessionView {
  return {
    id: 'session-test',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      email: `${overrides.id}@example.test`,
      username: overrides.id,
      displayName: overrides.displayName ?? 'Test User',
      role: 'admin',
      subcontractorId: null,
      grants: ALL_PERMISSIONS.map((key) => ({ key, scopeSubcontractorId: null })),
      ...overrides,
    },
  }
}

function scopedSession(
  id: string,
  role: 'subcontractor' | 'technician' | 'supplier',
  keys: string[],
  subcontractorId: number | null = null,
): AuthSessionView {
  return {
    id: 'session-test',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id,
      email: `${id}@example.test`,
      username: id,
      displayName: id,
      role,
      subcontractorId,
      grants: keys.map((key) => ({ key, scopeSubcontractorId: null })),
    },
  }
}

async function seedReference(tx: Tx): Promise<void> {
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
    .insert(legacyCustomer)
    .values({ id: 990001, name: 'Integration Customer' })
    .onConflictDoNothing()
  await tx
    .insert(legacySites)
    .values({
      id: 990001,
      custid: 990001,
      name: 'Integration Site',
      street: '1 Test Way',
      city: 'Toronto',
      province: 'ON',
      postalcode: 'M5V 0A1',
    })
    .onConflictDoNothing()
  await tx
    .insert(legacySubcontractor)
    .values([
      {
        id: 990001,
        name: 'Subcontractor A',
        street: '2 Test Way',
        city: 'Toronto',
        province: 'ON',
        postalcode: 'M5V 0A2',
        cname: 'A Contact',
        cnumber: '416-555-0001',
        cemail1: 'a@example.test',
      },
      {
        id: 990002,
        name: 'Subcontractor B',
        street: '3 Test Way',
        city: 'Toronto',
        province: 'ON',
        postalcode: 'M5V 0A3',
        cname: 'B Contact',
        cnumber: '416-555-0002',
        cemail1: 'b@example.test',
      },
    ])
    .onConflictDoNothing()
  await tx
    .insert(legacySubcontractorWsibInsuranceDocuments)
    .values({
      subid: 990001,
      documentType: 'WSIB',
      documentName: 'WSIB certificate',
      isExpired: 0,
      expirationDate: '2099-01-01',
    })
}

async function seedUser(tx: Tx): Promise<string> {
  const { users } = await import('@cls/db/schema')
  const [row] = await tx
    .insert(users)
    .values({
      email: 'integration@example.test',
      username: 'integration',
      displayName: 'Integration Admin',
      role: 'admin',
    })
    .returning({ id: users.id })
  return row!.id
}

const baseInput: Omit<WorkOrderCreateInput, 'siteId'> = {
  series: 1,
  serviceTypeId: 1,
  priorityId: 1,
  expectedCompletion: '2026-12-01',
  serviceRequired: 'Replace failed ballast and test circuit.',
  customerPo: 'PO-INT-1',
}

describe.skipIf(!databaseConfigured())('work order server functions', () => {
  test('create → dispatch → capture → complete → invoice-ready snapshot', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const adminId = await seedUser(tx)
      const admin = session({ id: adminId, displayName: 'Integration Admin' })

      const created = await createWorkOrderCore(
        tx,
        { ...baseInput, siteId: 990001, subcontractorId: 990001 },
        admin,
      )
      expect(created.id).toBeGreaterThan(0)

      const [counter] = await tx
        .select()
        .from(workOrderNumberSeries)
        .where(eq(workOrderNumberSeries.id, 1))
      expect(counter?.nextId).toBe(created.id + 1)

      const dispatched = await transitionWorkOrderCore(
        tx,
        { id: created.id, version: 1, to: 7 },
        admin,
      )
      expect(dispatched.status).toBe(7)

      await captureHoursCore(
        tx,
        {
          workOrderId: created.id,
          lines: [{ lineDate: '2026-11-10', hours: '2', rateCode: 1, hourlyRate: '85.00' }],
        },
        admin,
      )
      await capturePartsCore(
        tx,
        {
          workOrderId: created.id,
          lines: [{ partNo: 'P1', qty: '3', price: '12.99' }],
        },
        admin,
      )

      const [afterCapture] = await tx
        .select()
        .from(workOrders)
        .where(eq(workOrders.id, created.id))
      const completed = await transitionWorkOrderCore(
        tx,
        { id: created.id, version: afterCapture!.version, to: 2 },
        admin,
      )
      expect(completed.status).toBe(2)

      const snapshot = await buildInvoiceReadySnapshot(admin, created.id, tx as unknown as Db)
      expect(snapshot.calcType).toBe('sub')
      expect(snapshot.labour).toHaveLength(1)
      expect(snapshot.parts).toHaveLength(1)
      const expected = calculateSalesInvoice({
        taxProvince: 'ON',
        labour: [{ hours: '2', rate: '85.00' }],
        parts: [{ qty: '3', price: '12.99' }],
      })
      expect(snapshot.totals).toEqual({
        labour: expected.labour,
        material: expected.material,
        subtotal: expected.subtotal,
        tax: expected.tax,
        total: expected.total,
      })
      expect(snapshot.totals?.subtotal).toBe('208.97')
      expect(snapshot.totals?.tax).toBe('27.17')
      expect(snapshot.totals?.total).toBe('236.14')

      // A unique partial index guarantees exactly one chain end per work order.
      const revisionRows = await tx
        .select()
        .from(workOrderRevisions)
        .where(eq(workOrderRevisions.workOrderId, created.id))
      expect(revisionRows.length).toBeGreaterThan(0)
      expect(revisionRows.filter((row) => row.isLastRevision)).toHaveLength(1)
    })
  })

  test('subcontractor A cannot read subcontractor B work order', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const adminId = await seedUser(tx)
      const admin = session({ id: adminId })
      const created = await createWorkOrderCore(
        tx,
        { ...baseInput, siteId: 990001, subcontractorId: 990002, wsibOverride: true },
        admin,
      )

      const subA = scopedSession(
        'sub-a',
        'subcontractor',
        ['workorder:read', 'workorder:capture'],
        990001,
      )
      await expect(loadAccessibleWorkOrder(subA, created.id, tx)).rejects.toBeInstanceOf(
        NotFoundError,
      )

      const listA = await queryWorkOrders(
        {
          view: 'all',
          sort: 'newest',
          pageSize: 25,
        },
        resolveScope(subA),
        tx as unknown as Db,
      )
      expect(listA.rows.map((row) => row.id)).not.toContain(created.id)
    })
  })

  test('technician cannot read an unassigned work order', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const adminId = await seedUser(tx)
      const admin = session({ id: adminId })
      const created = await createWorkOrderCore(
        tx,
        { ...baseInput, siteId: 990001 },
        admin,
      )
      const tech = scopedSession('00000000-0000-4000-8000-000000000001', 'technician', [
        'workorder:read',
        'workorder:write',
        'workorder:capture',
      ])
      await expect(loadAccessibleWorkOrder(tech, created.id, tx)).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })
  })

  test('supplier has no work-order access', async () => {
    await inRollback(async (tx) => {
      const supplier = scopedSession('supplier-1', 'supplier', ['workorder:read'])
      await expect(loadAccessibleWorkOrder(supplier, 1, tx)).rejects.toBeInstanceOf(NotFoundError)

      const noGrant = scopedSession('supplier-2', 'supplier', [])
      await expect(loadAccessibleWorkOrder(noGrant, 1, tx)).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  test('illegal transition is rejected with a clear message', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const adminId = await seedUser(tx)
      const admin = session({ id: adminId })
      const created = await createWorkOrderCore(
        tx,
        { ...baseInput, siteId: 990001 },
        admin,
      )
      await expect(
        transitionWorkOrderCore(tx, { id: created.id, version: 1, to: 11 }, admin),
      ).rejects.toThrow(/Illegal status change/)
    })
  })

  test('WSIB gate blocks assignment without a valid document', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const adminId = await seedUser(tx)
      const admin = session({ id: adminId })
      await expect(
        createWorkOrderCore(
          tx,
          { ...baseInput, siteId: 990001, subcontractorId: 990002 },
          admin,
        ),
      ).rejects.toBeInstanceOf(ValidationError)

      const overridden = await createWorkOrderCore(
        tx,
        { ...baseInput, siteId: 990001, subcontractorId: 990002, wsibOverride: true },
        admin,
      )
      expect(overridden.id).toBeGreaterThan(0)
    })
  })

  test('stale version returns a conflict, not a silent overwrite', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const adminId = await seedUser(tx)
      const admin = session({ id: adminId })
      const created = await createWorkOrderCore(
        tx,
        { ...baseInput, siteId: 990001 },
        admin,
      )
      await updateWorkOrderCore(
        tx,
        { id: created.id, version: 1, customerPo: 'PO-CHANGED' },
        admin,
      )
      await expect(
        updateWorkOrderCore(
          tx,
          { id: created.id, version: 1, customerPo: 'PO-STALE' },
          admin,
        ),
      ).rejects.toBeInstanceOf(ConflictError)
    })
  })

  test('strict numbering skips an app-side collision and the counter persists', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const adminId = await seedUser(tx)
      const admin = session({ id: adminId })
      await tx.update(workOrderNumberSeries).set({ nextId: 900100 }).where(eq(workOrderNumberSeries.id, 1))
      const first = await createWorkOrderCore(
        tx,
        { ...baseInput, siteId: 990001 },
        admin,
      )
      expect(first.id).toBe(900100)

      // Force the counter back onto the used id, as a drifted legacy counter
      // would be, and ask for strict allocation inside the same transaction.
      await tx.update(workOrderNumberSeries).set({ nextId: 900100 }).where(eq(workOrderNumberSeries.id, 1))
      setSageNumberCollisionSourceForTests({
        has: async () => false,
        describe: () => 'test source',
      })
      try {
        const plan = await allocateWorkOrderNumber(tx, 1, { enforceAppCollisions: true })
        expect(plan.number).toBe(900101)
        expect(plan.skipped).toEqual([900100])
      } finally {
        setSageNumberCollisionSourceForTests(undefined)
      }
    })
  })
})
