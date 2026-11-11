import { describe, expect, test, vi } from 'vitest'
import { getConfig } from '@cls/core/env.server'
import { getDb, type Tx } from '@cls/db'
import {
  customers,
  partGroups,
  partPriceHistory,
  partSellingRates,
  partSupplierRates,
  parts,
  sites,
  subcontractorDocuments,
  subcontractors,
  suppliers,
} from '@cls/db/schema'
import {
  getCustomer,
  getPart,
  getSite,
  getSubcontractor,
  getSupplier,
  listCustomers,
  listParts,
  listSites,
  listSubcontractors,
  listSuppliers,
} from './master-data.server'

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

describe.skipIf(!databaseConfigured())('master-data server queries', () => {
  test('lists and detail reads join without dropping orphan sites', async () => {
    await inRollback(async (tx) => {
      await tx.insert(customers).values({ id: 993001, name: 'Parity Customer', city: 'Toronto' })
      await tx.insert(sites).values([
        {
          id: 993001,
          customerId: 993001,
          name: 'Parity Linked Site',
          city: 'Toronto',
          province: 'ON',
        },
        {
          id: 993002,
          customerId: 999998,
          name: 'Parity Orphan Site',
          city: 'Ottawa',
          province: 'ON',
        },
      ])

      const customersPage = await listCustomers({ search: 'Parity Customer', page: 1, pageSize: 25 }, tx)
      expect(customersPage.rows).toHaveLength(1)
      expect(customersPage.rows[0]?.siteCount).toBe(1)

      const sitePage = await listSites(
        { search: 'Parity', page: 1, pageSize: 25, parent: 'all' },
        tx,
      )
      expect(sitePage.rows.map((row) => row.id)).toEqual([993001, 993002])

      const orphans = await listSites(
        { search: 'Parity', page: 1, pageSize: 25, parent: 'missing' },
        tx,
      )
      expect(orphans.rows.map((row) => row.id)).toEqual([993002])
      expect(orphans.rows[0]?.customerName).toBeNull()

      const site = await getSite(993002, tx)
      expect(site?.customerId).toBe(999998)
      expect(site?.customerName).toBeNull()

      const customer = await getCustomer(993001, tx)
      expect(customer?.sites.map((row) => row.id)).toEqual([993001])
    })
  })

  test('subcontractor compliance uses documents and zero documents fails', async () => {
    await inRollback(async (tx) => {
      await tx.insert(subcontractors).values([
        { id: 993101, name: 'Parity Valid Vendor', city: 'Toronto' },
        { id: 993102, name: 'Parity Empty Vendor', city: 'Toronto' },
      ])
      await tx.insert(subcontractorDocuments).values({
        subcontractorId: 993101,
        kind: 'wsib',
        documentType: 'WSIB',
        expiresOn: '2099-12-31',
        isExpired: false,
      })

      const valid = await listSubcontractors(
        { search: 'Parity', page: 1, pageSize: 25, wsib: 'valid' },
        tx,
      )
      expect(valid.rows.map((row) => row.id)).toEqual([993101])

      const missing = await listSubcontractors(
        { search: 'Parity', page: 1, pageSize: 25, wsib: 'missing' },
        tx,
      )
      expect(missing.rows.map((row) => row.id)).toEqual([993102])

      const detail = await getSubcontractor(993102, tx)
      expect(detail?.wsibValid).toBe(false)
      expect(detail?.documents).toHaveLength(0)
    })
  })

  test('supplier and part detail read their rate cards', async () => {
    await inRollback(async (tx) => {
      await tx.insert(suppliers).values({ id: 993201, name: 'Parity Supplier', sageVendorId: 770001 })
      await tx.insert(partGroups).values({ id: 993201, name: 'Parity Group' })
      await tx.insert(parts).values({
        id: 993201,
        partNumber: 'PARITY-MD-001',
        name: 'Parity Fixture',
        partGroupId: 993201,
        cost: '5.00',
        sellPrice: '9.99',
      })
      await tx.insert(partSupplierRates).values({
        partId: 993201,
        supplierId: 993201,
        costPrice: '5.00',
        sellPrice: '9.99',
        defaultRate: true,
      })
      await tx.insert(partSellingRates).values({
        partId: 993201,
        sellPrice: '9.99',
        installPrice: '2.00',
      })
      await tx.insert(partPriceHistory).values({
        partId: 993201,
        fieldName: 'sell_price',
        lastValue: '8.99',
        newValue: '9.99',
      })

      const supplierPage = await listSuppliers({ search: 'Parity Supplier', page: 1, pageSize: 25 }, tx)
      expect(supplierPage.rows.map((row) => row.id)).toEqual([993201])
      expect((await getSupplier(993201, tx))?.name).toBe('Parity Supplier')

      const partPage = await listParts({ search: 'PARITY-MD', page: 1, pageSize: 25 }, tx)
      expect(partPage.rows.map((row) => row.partNumber)).toEqual(['PARITY-MD-001'])

      const part = await getPart(993201, tx)
      expect(part?.groupName).toBe('Parity Group')
      expect(part?.supplierRates[0]?.supplierName).toBe('Parity Supplier')
      expect(part?.sellingRates[0]?.sellPrice).toBe('9.99')
      expect(part?.priceHistory[0]?.fieldName).toBe('sell_price')
    })
  })
})
