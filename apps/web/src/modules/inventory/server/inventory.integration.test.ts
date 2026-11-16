/**
 * Inventory integration tests.
 *
 * Real Neon branch. Most tests roll back; the price-lock race commits two
 * transactions on purpose and cleans up after itself.
 */
import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { getConfig } from '@cls/core/env.server'
import { ALL_PERMISSIONS, ForbiddenError, ValidationError } from '@cls/core'
import { getDb, type Tx } from '@cls/db'
import {
  auditLog,
  inventoryMovements,
  partPriceHistory,
  partPriceLocks,
  partSupplierRates,
  parts,
  subStockMessages,
  subStockNotifications,
  users,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import {
  acquirePriceLockCore,
  getPartPriceEditor,
  releasePriceLockCore,
  savePartPricesCore,
} from './price.server'
import { listStockParts, movementReport, stockCounterDisagreements } from './reports.server'
import {
  adjustPartStockCore,
  excludeMovementFromStock,
  postPurchaseReceipt,
  postWorkOrderPartSale,
  softDeleteMovement,
} from './stock.server'
import {
  listSubStockPortal,
  markSubStockMessageReadCore,
  setSubStockSubscriptionCore,
} from './substock.server'

const ADMIN_A = '00000000-0000-4000-8000-00000000a001'
const ADMIN_B = '00000000-0000-4000-8000-00000000b001'
const TECH = '00000000-0000-4000-8000-00000000c001'
const SUB_USER = '00000000-0000-4000-8000-00000000d001'
const SUB_ID = 970101
const PART_SUPPLIER_ID = -970201

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

function session(
  id: string,
  role: 'admin' | 'technician' | 'subcontractor',
  keys: readonly string[],
  subcontractorId: number | null = null,
): AuthSessionView {
  return {
    id: `session-${id.slice(-4)}`,
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id,
      email: `${id.slice(-4)}@example.test`,
      username: `inv-${id.slice(-4)}`,
      displayName: `Inventory ${id.slice(-4)}`,
      role,
      subcontractorId,
      grants: keys.map((key) => ({ key, scopeSubcontractorId: null })),
    },
  }
}

const adminA = session(ADMIN_A, 'admin', ALL_PERMISSIONS)
const adminB = session(ADMIN_B, 'admin', ALL_PERMISSIONS)
const technician = session(TECH, 'technician', ['inventory:read'])
const subSession = session(SUB_USER, 'subcontractor', ['inventory:sub_stock'], SUB_ID)

async function seedUsers(tx: Tx): Promise<void> {
  await tx.insert(users).values([
    {
      id: ADMIN_A,
      email: 'inv-a@example.test',
      username: 'inv-a',
      displayName: 'Inventory A',
      role: 'admin',
    },
    {
      id: ADMIN_B,
      email: 'inv-b@example.test',
      username: 'inv-b',
      displayName: 'Inventory B',
      role: 'admin',
    },
    {
      id: TECH,
      email: 'inv-tech@example.test',
      username: 'inv-tech',
      displayName: 'Inventory Tech',
      role: 'technician',
    },
    {
      id: SUB_USER,
      email: 'inv-sub@example.test',
      username: 'inv-sub',
      displayName: 'Inventory Sub',
      role: 'subcontractor',
      subcontractorId: SUB_ID,
    },
  ])
}

async function resetLock(tx: Tx): Promise<void> {
  await tx
    .insert(partPriceLocks)
    .values({ id: 1 })
    .onConflictDoNothing({ target: partPriceLocks.id })
  await tx
    .update(partPriceLocks)
    .set({
      isLocked: false,
      lockedBy: null,
      lockedByName: null,
      lockTime: null,
      heartbeatAt: null,
      expiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(partPriceLocks.id, 1))
}

function adjustment(partNo: string, key: string, qty = '5.00') {
  return {
    partNo,
    qty,
    adjustmentType: 'global' as const,
    notes: 'integration test',
    idempotencyKey: key,
  }
}

describe.skipIf(!databaseConfigured())('inventory integration', () => {
  test('adjustment changes the counter once and is idempotent on replay', async () => {
    await inRollback(async (tx) => {
      await seedUsers(tx)
      const first = await adjustPartStockCore(tx, adjustment('INV-ADJ-1', 'adj-test-key-1'), adminA)
      expect(first.replay).toBe(false)
      expect(first.currentQuantity).toBe('5.00')

      const replay = await adjustPartStockCore(
        tx,
        adjustment('INV-ADJ-1', 'adj-test-key-1', '99.00'),
        adminA,
      )
      expect(replay.replay).toBe(true)
      expect(replay.adjustmentId).toBe(first.adjustmentId)
      expect(replay.currentQuantity).toBe('5.00')

      const movement = await tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.partNo, 'INV-ADJ-1'))
      expect(movement).toHaveLength(1)
      expect(movement[0]?.transactionType).toBe('Adjustment')
      expect(movement[0]?.adjustmentType).toBe('global')
      expect(movement[0]?.isIncludedInStockManagement).toBe(true)
    })
  })

  test('under-stocked adjustment goes negative and is still authoritative', async () => {
    await inRollback(async (tx) => {
      await seedUsers(tx)
      const result = await adjustPartStockCore(
        tx,
        adjustment('INV-ADJ-NEG', 'adj-negative-key', '-4.25'),
        adminA,
      )
      expect(result.currentQuantity).toBe('-4.25')
      const [row] = await tx.select().from(parts).where(eq(parts.partNumber, 'INV-ADJ-NEG'))
      expect(row?.currentQuantity).toBe('-4.25')
    })
  })

  test('a purchase receipt increments purchase and current once per line', async () => {
    await inRollback(async (tx) => {
      await seedUsers(tx)
      const input = {
        poId: 880001,
        receiptId: 880002,
        lines: [{ receiptLineId: 880003, partNo: 'INV-PO-1', qty: '3.00' }],
        session: adminA,
      }
      expect(await postPurchaseReceipt(tx, input)).toBe(1)
      expect(await postPurchaseReceipt(tx, input)).toBe(0)
      const [row] = await tx.select().from(parts).where(eq(parts.partNumber, 'INV-PO-1'))
      expect(row?.purchasedQuantity).toBe('3.00')
      expect(row?.currentQuantity).toBe('3.00')
      expect(row?.soldQuantity).toBe('0.00')
      const [movement] = await tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.partNo, 'INV-PO-1'))
      expect(movement?.transactionType).toBe('Purchase')
      expect(movement?.documentType).toBe('purchase_order')
      expect(movement?.poId).toBe(880001)
    })
  })

  test('a work-order sale duplicates the work-order id and decrements current stock', async () => {
    await inRollback(async (tx) => {
      await seedUsers(tx)
      await adjustPartStockCore(tx, adjustment('INV-SALE-1', 'sale-seed-key', '4.00'), adminA)
      const sale = await postWorkOrderPartSale(
        tx,
        {
          workOrderId: 700001,
          workOrderLineId: 700002,
          partNo: 'INV-SALE-1',
          qty: '1.50',
          price: '12.00',
        },
        adminA,
      )
      expect(sale.posted).toBe(true)
      expect(sale.currentQuantity).toBe('2.50')
      const [movement] = await tx
        .select()
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.partNo, 'INV-SALE-1'),
            eq(inventoryMovements.transactionType, 'Sale'),
          ),
        )
      expect(movement?.woidPoid).toBe(700001)
      expect(movement?.invoiceNumber).toBe('700001')
      expect(movement?.invoiceId).toBe(700001)
      expect(movement?.documentType).toBe('work_order')

      const retry = await postWorkOrderPartSale(
        tx,
        { workOrderId: 700001, workOrderLineId: 700002, partNo: 'INV-SALE-1', qty: '1.50' },
        adminA,
      )
      expect(retry.posted).toBe(false)
      expect(retry.currentQuantity).toBe('2.50')
    })
  })

  test('soft-deleting ledger history reports a difference and never rewrites the counter (E4)', async () => {
    await inRollback(async (tx) => {
      await seedUsers(tx)
      await adjustPartStockCore(tx, adjustment('INV-E4-1', 'e4-seed-key', '5.00'), adminA)
      const [movement] = await tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.partNo, 'INV-E4-1'))
      await softDeleteMovement(tx, movement!.id, adminA)
      const [row] = await tx.select().from(parts).where(eq(parts.partNumber, 'INV-E4-1'))
      expect(row?.currentQuantity).toBe('5.00')
      const stock = await listStockParts(adminA, { search: 'INV-E4-1' }, tx)
      expect(stock.rows[0]?.currentQuantity).toBe('5.00')
      expect(stock.rows[0]?.ledgerQuantity).toBe('0')
      expect(stock.rows[0]?.difference).toBe('5.00')
      const disagreements = await stockCounterDisagreements(adminA, tx)
      expect(disagreements.map((row) => row.partNumber)).toContain('INV-E4-1')
    })
  })

  test('excluding a movement from stock management leaves counters alone', async () => {
    await inRollback(async (tx) => {
      await seedUsers(tx)
      await adjustPartStockCore(tx, adjustment('INV-EXCL-1', 'excl-seed-key', '2.00'), adminA)
      const [movement] = await tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.partNo, 'INV-EXCL-1'))
      await excludeMovementFromStock(tx, movement!.id, adminA)
      const [row] = await tx.select().from(parts).where(eq(parts.partNumber, 'INV-EXCL-1'))
      expect(row?.currentQuantity).toBe('2.00')
      const report = await movementReport(adminA, { kind: 'complete', search: 'INV-EXCL-1' }, tx)
      expect(report[0]?.isIncludedInStockManagement).toBe(false)
    })
  })

  test('technicians can read stock but cannot adjust it', async () => {
    await inRollback(async (tx) => {
      await seedUsers(tx)
      await expect(
        adjustPartStockCore(tx, adjustment('INV-DENY-1', 'deny-adjust-key'), technician),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  test('prices cannot be written without the lock, and every write is in the same transaction as history', async () => {
    await inRollback(async (tx) => {
      await seedUsers(tx)
      await resetLock(tx)
      await tx.insert(parts).values({ id: -970301, partNumber: 'INV-PRICE-1', name: 'Price part' })
      await expect(
        savePartPricesCore(tx, { partId: -970301, fields: { cost: '9.99' } }, adminA),
      ).rejects.toBeInstanceOf(ForbiddenError)

      const lock = await acquirePriceLockCore(tx, adminA)
      expect(lock.heldByMe).toBe(true)
      expect(lock.remainingSeconds).toBeGreaterThan(0)

      await expect(acquirePriceLockCore(tx, adminB)).rejects.toBeInstanceOf(ValidationError)

      const result = await savePartPricesCore(
        tx,
        { partId: -970301, fields: { cost: '10.50', sellPrice: '14.00' } },
        adminA,
      )
      expect(result.changed).toBe(2)
      const history = await tx
        .select()
        .from(partPriceHistory)
        .where(eq(partPriceHistory.partId, -970301))
      expect(history.map((row) => row.fieldName).sort()).toEqual(['cost', 'sellPrice'])
      expect(history.every((row) => row.changedBy === ADMIN_A)).toBe(true)

      const editor = await getPartPriceEditor(adminA, -970301, tx)
      expect(editor.part.cost).toBe('10.50')
      expect(editor.history).toHaveLength(2)
    })
  })

  test('rate-card changes use the same price path and history', async () => {
    await inRollback(async (tx) => {
      await seedUsers(tx)
      await resetLock(tx)
      await tx
        .insert(parts)
        .values({ id: -970302, partNumber: 'INV-PRICE-RATE', name: 'Rate part' })
      const [rate] = await tx
        .insert(partSupplierRates)
        .values({ partId: -970302, supplierId: PART_SUPPLIER_ID, costPrice: '5.00' })
        .returning()
      await acquirePriceLockCore(tx, adminA)
      const result = await savePartPricesCore(
        tx,
        { partId: -970302, supplierRates: [{ id: rate!.id, costPrice: '6.25' }] },
        adminA,
      )
      expect(result.changed).toBe(1)
      const [history] = await tx
        .select()
        .from(partPriceHistory)
        .where(eq(partPriceHistory.partId, -970302))
      expect(history?.fieldName).toContain('supplierRates')
      const [updated] = await tx
        .select()
        .from(partSupplierRates)
        .where(eq(partSupplierRates.id, rate!.id))
      expect(updated?.costPrice).toBe('6.25')
    })
  })

  test('an expired lock is surfaced and only a reasoned takeover can claim it', async () => {
    await inRollback(async (tx) => {
      await seedUsers(tx)
      await resetLock(tx)
      await acquirePriceLockCore(tx, adminA)
      await tx
        .update(partPriceLocks)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(partPriceLocks.id, 1))

      await expect(acquirePriceLockCore(tx, adminB)).rejects.toThrow(/expired/)
      await expect(acquirePriceLockCore(tx, adminB, { takeOver: true })).rejects.toThrow(/reason/)
      const taken = await acquirePriceLockCore(tx, adminB, {
        takeOver: true,
        reason: 'Admin A left for the day',
      })
      expect(taken.heldByMe).toBe(true)
      expect(taken.lockedBy).toBe(ADMIN_B)
      const [audit] = await tx
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, 'inventory.price_lock_takeover'))
      expect(audit?.actorUserId).toBe(ADMIN_B)
    })
  })

  test('the holder refreshes the TTL; release frees the lock', async () => {
    await inRollback(async (tx) => {
      await seedUsers(tx)
      await resetLock(tx)
      const first = await acquirePriceLockCore(tx, adminA)
      const { refreshPriceLockCore } = await import('./price.server')
      const refreshed = await refreshPriceLockCore(tx, adminA)
      expect(refreshed.version).toBeGreaterThan(first.version)
      const released = await releasePriceLockCore(tx, adminA)
      expect(released.isLocked).toBe(false)
      expect((await acquirePriceLockCore(tx, adminB)).heldByMe).toBe(true)
    })
  })

  test('sub-stock portal hides parts marked subignore and scopes messages', async () => {
    await inRollback(async (tx) => {
      await seedUsers(tx)
      await tx.insert(parts).values([
        { id: -970311, partNumber: 'INV-SUB-VISIBLE', name: 'Visible', currentQuantity: '2.00' },
        { id: -970312, partNumber: 'INV-SUB-HIDDEN', name: 'Hidden', subignore: true },
      ])
      await tx.insert(subStockMessages).values({
        subcontractorId: SUB_ID,
        userId: SUB_USER,
        userType: 'admin',
        username: 'inv-a',
        subject: 'Stock count',
        message: 'Please count the shelves.',
      })

      // The portal lists the first 100 parts of the real catalogue, so search for ours.
      const portal = await listSubStockPortal(subSession, { search: 'INV-SUB' }, tx)
      expect(portal.parts.map((part) => part.partNumber)).toContain('INV-SUB-VISIBLE')
      expect(portal.parts.map((part) => part.partNumber)).not.toContain('INV-SUB-HIDDEN')
      expect(portal.unread).toBe(1)

      const message = portal.messages.find((row) => row.subject === 'Stock count')!
      await markSubStockMessageReadCore(tx, { id: message.id }, subSession)
      const after = await listSubStockPortal(subSession, {}, tx)
      expect(after.unread).toBe(0)

      const subscription = await setSubStockSubscriptionCore(tx, { containStock: true }, subSession)
      expect(subscription.containStock).toBe(true)
      const [stored] = await tx
        .select()
        .from(subStockNotifications)
        .where(eq(subStockNotifications.id, subscription.id))
      expect(stored?.subcontractorId).toBe(SUB_ID)
    })
  })

  test('a subcontractor cannot mark another subcontractor message read', async () => {
    await inRollback(async (tx) => {
      await seedUsers(tx)
      const [message] = await tx
        .insert(subStockMessages)
        .values({
          subcontractorId: SUB_ID + 1,
          message: 'Private',
        })
        .returning()
      await expect(
        markSubStockMessageReadCore(tx, { id: message!.id }, subSession),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })
})

describe.skipIf(!databaseConfigured())('price lock concurrency', () => {
  test('two simultaneous acquire attempts leave exactly one holder', async () => {
    const db = getDb()
    const keyA = '00000000-0000-4000-8000-00000000a101'
    const keyB = '00000000-0000-4000-8000-00000000b101'
    const first = session(keyA, 'admin', ALL_PERMISSIONS)
    const second = session(keyB, 'admin', ALL_PERMISSIONS)
    try {
      await db.transaction(async (tx) => {
        await tx
          .insert(users)
          .values([
            {
              id: keyA,
              email: 'inv-race-a@example.test',
              username: 'inv-race-a',
              displayName: 'Race A',
              role: 'admin',
            },
            {
              id: keyB,
              email: 'inv-race-b@example.test',
              username: 'inv-race-b',
              displayName: 'Race B',
              role: 'admin',
            },
          ])
          .onConflictDoNothing()
        await resetLock(tx)
      })

      const attempts = await Promise.allSettled([
        db.transaction((tx) => acquirePriceLockCore(tx, first)),
        db.transaction((tx) => acquirePriceLockCore(tx, second)),
      ])
      const fulfilled = attempts.filter((row) => row.status === 'fulfilled')
      expect(fulfilled).toHaveLength(1)

      const [lock] = await db.select().from(partPriceLocks).where(eq(partPriceLocks.id, 1))
      expect(lock?.isLocked).toBe(true)
      expect([keyA, keyB]).toContain(lock?.lockedBy)

      // Both then try to save; only the current holder succeeds.
      await db.transaction(async (tx) => {
        await tx
          .insert(parts)
          .values({ id: -970401, partNumber: 'INV-RACE-1', name: 'Race part' })
          .onConflictDoNothing()
        await resetLock(tx)
      })
      await db.transaction((tx) => acquirePriceLockCore(tx, first))
      const saves = await Promise.allSettled([
        db.transaction((tx) =>
          savePartPricesCore(tx, { partId: -970401, fields: { cost: '1.00' } }, first),
        ),
        db.transaction((tx) =>
          savePartPricesCore(tx, { partId: -970401, fields: { cost: '2.00' } }, second),
        ),
      ])
      expect(saves.filter((row) => row.status === 'fulfilled')).toHaveLength(1)
      expect(saves.filter((row) => row.status === 'rejected')).toHaveLength(1)
    } finally {
      await db.transaction(async (tx) => {
        await tx.delete(partPriceHistory).where(eq(partPriceHistory.partId, -970401))
        await tx.delete(parts).where(eq(parts.id, -970401))
        await tx.delete(auditLog).where(sql`${auditLog.actorUserId} in (${keyA}, ${keyB})`)
        await resetLock(tx)
        await tx.delete(users).where(sql`${users.id} in (${keyA}, ${keyB})`)
      })
    }
  })
})
