/**
 * TJX subcontractor rates. Real database, always rolled back.
 *
 * The rate screen is the only TJX write path for install cost. It must never
 * touch the mirrored part price fields.
 */
import { and, desc, eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { ALL_PERMISSIONS, ForbiddenError } from '@cls/core'
import { getConfig } from '@cls/core/env.server'
import { getDb, type Tx } from '@cls/db'
import { auditLog, parts, subcontractors, users } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import { listRates, saveRatesCore } from './rates.server'

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

const ADMIN_ID = '00000000-0000-4000-8000-0000000000d1'
const READER_ID = '00000000-0000-4000-8000-0000000000d2'
const SUB_ID = 9_430_001
const PART_ONE = 9_430_001
const PART_TWO = 9_430_002

function adminSession(): AuthSessionView {
  return {
    id: 'session-tjx-rates',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id: ADMIN_ID,
      email: 'tjx-rates-admin@example.test',
      username: 'tjx-rates-admin',
      displayName: 'TJX Rates Admin',
      role: 'admin',
      subcontractorId: null,
      grants: ALL_PERMISSIONS.map((key) => ({ key, scopeSubcontractorId: null })),
    },
  }
}

function readOnlySession(): AuthSessionView {
  return {
    id: 'session-tjx-rates-reader',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id: READER_ID,
      email: 'tjx-rates-reader@example.test',
      username: 'tjx-rates-reader',
      displayName: 'TJX Rates Reader',
      role: 'technician',
      subcontractorId: null,
      grants: [{ key: 'tjx:read', scopeSubcontractorId: null }],
    },
  }
}

async function seed(tx: Tx): Promise<void> {
  await tx.insert(users).values([
    {
      id: ADMIN_ID,
      email: 'tjx-rates-admin@example.test',
      username: 'tjx-rates-admin',
      displayName: 'TJX Rates Admin',
      role: 'admin',
    },
    {
      id: READER_ID,
      email: 'tjx-rates-reader@example.test',
      username: 'tjx-rates-reader',
      displayName: 'TJX Rates Reader',
      role: 'technician',
    },
  ])
  await tx.insert(parts).values([
    {
      id: PART_ONE,
      partNumber: 'WIN-RATE-1',
      name: 'Rate part one',
      sellPrice: '11.00',
      installCostPerUnit: '9.99',
    },
    {
      id: PART_TWO,
      partNumber: 'WIN-RATE-2',
      name: 'Rate part two',
      sellPrice: '22.00',
      installCostPerUnit: '8.88',
    },
  ])
  await tx.insert(subcontractors).values({ id: SUB_ID, name: 'TJX Rate Sub' })
}

describe.skipIf(!databaseConfigured())('TJX subcontractor rates', () => {
  test('bulk save creates rates and a later save replaces the set', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const first = await saveRatesCore(
        tx,
        {
          subcontractorId: SUB_ID,
          rates: [
            { partNo: 'win-rate-1', installCostPerUnit: '1.25' },
            { partNo: 'WIN-RATE-2', installCostPerUnit: '2.50' },
          ],
        },
        adminSession(),
      )
      expect(first).toEqual([
        expect.objectContaining({ partNo: 'WIN-RATE-1', installCostPerUnit: '1.25' }),
        expect.objectContaining({ partNo: 'WIN-RATE-2', installCostPerUnit: '2.50' }),
      ])

      const second = await saveRatesCore(
        tx,
        { subcontractorId: SUB_ID, rates: [{ partNo: 'WIN-RATE-1', installCostPerUnit: '3.75' }] },
        adminSession(),
      )
      expect(second).toEqual([
        expect.objectContaining({ partNo: 'WIN-RATE-1', installCostPerUnit: '3.75' }),
      ])
      expect(await listRates(tx, { subcontractorId: SUB_ID })).toHaveLength(1)
    })
  })

  test('duplicate and unknown parts are rejected before writing', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      await expect(
        saveRatesCore(
          tx,
          {
            subcontractorId: SUB_ID,
            rates: [
              { partNo: 'WIN-RATE-1', installCostPerUnit: '1.00' },
              { partNo: 'win-rate-1', installCostPerUnit: '2.00' },
            ],
          },
          adminSession(),
        ),
      ).rejects.toThrow(/more than once/i)

      await expect(
        saveRatesCore(
          tx,
          {
            subcontractorId: SUB_ID,
            rates: [{ partNo: 'MISSING-RATE', installCostPerUnit: '1.00' }],
          },
          adminSession(),
        ),
      ).rejects.toThrow(/Unknown part number: MISSING-RATE/)
    })
  })

  test('an invalid rate string is rejected', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      await expect(
        saveRatesCore(
          tx,
          {
            subcontractorId: SUB_ID,
            rates: [{ partNo: 'WIN-RATE-1', installCostPerUnit: '1.234' }],
          },
          adminSession(),
        ),
      ).rejects.toThrow(/at most 2 decimals/i)
    })
  })

  test('saving rates leaves the mirrored part price fields unchanged', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const before = await tx.select().from(parts).where(eq(parts.id, PART_ONE))
      await saveRatesCore(
        tx,
        { subcontractorId: SUB_ID, rates: [{ partNo: 'WIN-RATE-1', installCostPerUnit: '99.99' }] },
        adminSession(),
      )
      const after = await tx.select().from(parts).where(eq(parts.id, PART_ONE))
      expect(after[0]?.sellPrice).toBe(before[0]?.sellPrice)
      expect(after[0]?.installCostPerUnit).toBe(before[0]?.installCostPerUnit)
      expect(after[0]?.cost).toBe(before[0]?.cost)
    })
  })

  test('a read-only session cannot save rates', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      expect(await listRates(tx, { subcontractorId: SUB_ID })).toEqual([])
      await expect(
        saveRatesCore(
          tx,
          { subcontractorId: SUB_ID, rates: [{ partNo: 'WIN-RATE-1', installCostPerUnit: '1.00' }] },
          readOnlySession(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  test('the bulk save is audited with the before and after maps', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      await saveRatesCore(
        tx,
        { subcontractorId: SUB_ID, rates: [{ partNo: 'WIN-RATE-1', installCostPerUnit: '1.50' }] },
        adminSession(),
      )
      await saveRatesCore(
        tx,
        { subcontractorId: SUB_ID, rates: [{ partNo: 'WIN-RATE-1', installCostPerUnit: '2.50' }] },
        adminSession(),
      )
      const [audit] = await tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, 'tjx.rates.save'),
            eq(auditLog.entityId, String(SUB_ID)),
          ),
        )
        .orderBy(desc(auditLog.id))
        .limit(1)
      expect(audit?.after).toMatchObject({ rates: [{ partNo: 'WIN-RATE-1', rate: '2.50' }] })
    })
  })
})
