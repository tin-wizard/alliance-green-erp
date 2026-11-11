import { describe, expect, test, vi } from 'vitest'
import { getConfig } from '@cls/core/env.server'
import { getDb, type Tx } from '@cls/db'
import {
  customers,
  legacyPartsPriceLock,
  parts,
  sites,
  subcontractors,
} from '@cls/db/schema'
import {
  getSubcontractorWsibState,
  partsLookup,
  searchSites,
} from '../../work-orders/lib/lookups'

/**
 * Behaviour parity for the frozen Work Orders adapter.
 *
 * These are the four behaviours Work Orders actually depends on, not a shape
 * comparison against legacy rows. Each case runs in a transaction that is
 * always rolled back; ids sit above the Sage range so they cannot collide with
 * migrated data.
 */
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

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

describe.skipIf(!databaseConfigured())('master-data adapter behaviour', () => {
  test('searchSites orders case-insensitively and matches mid-word substrings', async () => {
    await inRollback(async (tx) => {
      await tx.insert(customers).values([
        { id: 992101, name: 'Alpha Holdings' },
        { id: 992102, name: 'Zeta Holdings' },
      ])
      await tx.insert(sites).values([
        {
          id: 992101,
          customerId: 992101,
          name: 'Zeta Lighting',
          street: '10 Zeta Way',
          city: 'Toronto',
          province: 'ON',
        },
        {
          id: 992102,
          customerId: 992102,
          name: 'alpha Lighting',
          street: '20 Alpha Way',
          city: 'Ottawa',
          province: 'ON',
        },
        {
          id: 992103,
          customerId: 992101,
          name: 'BETA LIGHTING',
          street: '30 Beta Way',
          city: 'Toronto',
          province: 'ON',
        },
      ])

      const midWord = await searchSites('ghtin', 20, tx)
      expect(midWord.map((row) => row.id)).toEqual([992102, 992103, 992101])

      const emptySearch = await searchSites('', 2, tx)
      expect(emptySearch.map((row) => row.id)).toEqual([992102, 992103])
    })
  })

  test('a missing billing parent is returned as an empty customer name', async () => {
    await inRollback(async (tx) => {
      await tx.insert(customers).values({ id: 992201, name: 'Existing Parent' })
      await tx.insert(sites).values({
        id: 992201,
        customerId: 992201,
        name: 'Parity Orphan Site',
        street: '1 Orphan Way',
        city: 'Toronto',
        province: 'ON',
      })
      await tx.insert(sites).values({
        id: 992202,
        customerId: 999999,
        name: 'Parity Site With Missing Parent',
        street: '2 Orphan Way',
        city: 'Toronto',
        province: 'ON',
      })

      const rows = await searchSites('Parity', 20, tx)
      const orphan = rows.find((row) => row.id === 992202)
      expect(orphan).toBeDefined()
      expect(orphan?.customerId).toBe(999999)
      expect(orphan?.customerName).toBe('')
    })
  })

  test('a subcontractor with zero documents has no valid WSIB state', async () => {
    await inRollback(async (tx) => {
      await tx.insert(subcontractors).values({
        id: 992301,
        name: 'Parity Vendor With No Documents',
      })

      const state = await getSubcontractorWsibState(992301, tx)
      expect(state).toEqual({ valid: false, expirationDate: null, documentType: null })
    })
  })

  test('parts lookup ignores the price lock and preserves NULL prices', async () => {
    await inRollback(async (tx) => {
      await tx.insert(parts).values([
        {
          id: 992401,
          partNumber: 'PARITY-001',
          name: 'Parity Lamp',
          sellPrice: '12.34',
        },
        {
          id: 992402,
          partNumber: 'PARITY-002',
          name: 'Parity Ballast',
          sellPrice: null,
        },
      ])

      const unlocked = await partsLookup('PARITY', 20, tx)
      expect(unlocked).toEqual([
        { partNo: 'PARITY-001', description: 'Parity Lamp', price: '12.34' },
        { partNo: 'PARITY-002', description: 'Parity Ballast', price: null },
      ])

      // The lock is a mutex over the editor, not a per-part freeze. A held lock
      // must not hide a part, zero a price or expose working values.
      await tx
        .insert(legacyPartsPriceLock)
        .values({ id: 1, isLocked: 1, lockedBy: 'parity-test', lockTime: 1 })
        .onConflictDoNothing()

      const locked = await partsLookup('PARITY', 20, tx)
      expect(locked).toEqual(unlocked)
    })
  })
})
