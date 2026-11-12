/**
 * Reports integration tests. Real database, always rolled back.
 *
 * These pin the parameterised client report (legacy fifteen-page family), the
 * outstanding and work-order summaries, site visits, parts valuation and both
 * export bytes.
 */
import { eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { getConfig } from '@cls/core/env.server'
import { getDb, type Tx } from '@cls/db'
import {
  auditLog,
  customers,
  invoiceLabourLines,
  parts,
  salesInvoices,
  sites,
  users,
  workOrders,
} from '@cls/db/schema'
import { exportReport, runReport } from './reports.server'
import type { ReportRequest } from '../types'

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
const suffix = 700_000 + Math.floor(Math.random() * 200_000)
const CUSTOMER_ID = 900_000_000 + suffix
const SITE_ID = 800_000_000 + suffix
const WO_INVOICED = 600_000_000 + suffix
const WO_OPEN = 500_000_000 + suffix
const WO_MAINT = 400_000_000 + suffix
const PART_ID = 300_000_000 + suffix

async function seed(tx: Tx): Promise<void> {
  await tx.insert(users).values({
    id: ADMIN_ID,
    email: `reports-${suffix}@example.test`,
    username: `reports-${suffix}`,
    displayName: 'Reports Admin',
    role: 'admin',
  })
  await tx.insert(customers).values({
    id: CUSTOMER_ID,
    name: `Bell Mobility Inc #${suffix} - Test Store`,
    province: 'ON',
  })
  await tx.insert(sites).values({
    id: SITE_ID,
    customerId: CUSTOMER_ID,
    name: `Test Store ${suffix}`,
    street: '1 Report Way',
    city: 'Toronto',
    province: 'ON',
  })
  await tx.insert(workOrders).values([
    {
      id: WO_INVOICED,
      siteId: SITE_ID,
      status: 11,
      serviceTypeId: 1,
      dateTaken: '2026-02-10',
      customerPo: `PO-${suffix}`,
      serviceRequired: 'Replace lamps',
    },
    {
      id: WO_OPEN,
      siteId: SITE_ID,
      status: 1,
      serviceTypeId: 2,
      dateTaken: '2026-02-11',
      customerPo: `PO-OPEN-${suffix}`,
    },
    {
      id: WO_MAINT,
      siteId: SITE_ID,
      status: 2,
      serviceTypeId: 3,
      dateTaken: '2026-02-12',
    },
  ])
  const [invoice] = await tx
    .insert(salesInvoices)
    .values({
      workOrderId: WO_INVOICED,
      invoiceNumber: `INV-${suffix}`,
      workOrderNumber: WO_INVOICED,
      customerId: CUSTOMER_ID,
      siteId: SITE_ID,
      calcType: 'standard',
      status: 'issued',
      invoiceDate: '2026-02-15',
      labourAmount: '100.00',
      materialAmount: '50.00',
      subtotalAmount: '150.00',
      taxAmount: '19.50',
      totalAmount: '169.50',
    })
    .returning({ id: salesInvoices.id })
  await tx.insert(invoiceLabourLines).values({
    invoiceId: invoice!.id,
    position: 1,
    lineDate: '2026-02-15',
    hours: '1.00',
    rateCode: 1,
    hourlyRate: '100.00',
    qty: '1.00',
    price: '100.00',
    amount: '100.00',
  })
  await tx.insert(parts).values({
    id: PART_ID,
    partNumber: `RPT-${suffix}`,
    name: 'Report test part',
    cost: '2.50',
    sellPrice: '4.00',
    currentQuantity: '6.00',
  })
}

function request(patch: Partial<ReportRequest>): ReportRequest {
  return {
    key: 'client-invoices',
    client: 'all',
    startDate: '2026-02-01',
    endDate: '2026-02-28',
    serviceScope: 'work',
    province: '',
    category: 'all',
    search: '',
    stockScope: 'all',
    page: 1,
    pageSize: 100,
    ...patch,
  }
}

describe.skipIf(!databaseConfigured())('reports', () => {
  test('client invoice report is one parameterised query with money totals', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const all = await runReport(request({ client: 'all' }), tx)
      const row = all.rows.find((item) => item.invoiceNumber === `INV-${suffix}`)
      expect(row).toBeDefined()
      expect(row?.site).toBe(`Test Store ${suffix}`)
      expect(row?.total).toBe('169.50')
      expect(all.totals?.total).toBe('169.50')
      expect(all.pageSize).toBe(100)

      const outside = await runReport(
        request({ client: 'all', startDate: '2026-03-01', endDate: '2026-03-31' }),
        tx,
      )
      expect(outside.rows.some((item) => item.invoiceNumber === `INV-${suffix}`)).toBe(false)

      const maintenance = await runReport(
        request({ client: 'all', serviceScope: 'maintenance' }),
        tx,
      )
      expect(maintenance.rows.some((item) => item.invoiceNumber === `INV-${suffix}`)).toBe(false)

      const bell = await runReport(request({ client: 'bell' }), tx)
      expect(bell.rows.some((item) => item.invoiceNumber === `INV-${suffix}`)).toBe(true)
      const tjx = await runReport(request({ client: 'tjx' }), tx)
      expect(tjx.rows.some((item) => item.invoiceNumber === `INV-${suffix}`)).toBe(false)
    })
  })

  test('outstanding, work-order, site and stock reports group the same data', async () => {
    await inRollback(async (tx) => {
      await seed(tx)

      const outstanding = await runReport(
        request({ key: 'client-outstanding', client: 'bell' }),
        tx,
      )
      const open = outstanding.rows.find((row) => row.workOrder === String(WO_OPEN))
      expect(open?.status).toBe('In progress')
      expect(outstanding.rows.some((row) => row.workOrder === String(WO_INVOICED))).toBe(false)

      const grouped = await runReport(
        request({
          key: 'work-orders',
          client: 'bell',
          serviceScope: 'all',
          startDate: '2026-02-01',
          endDate: '2026-02-28',
        }),
        tx,
      )
      const group = grouped.rows.find((row) => row.customer?.startsWith('Bell Mobility Inc'))
      expect(group).toMatchObject({ interior: '1', exterior: '1', maintenance: '1', total: '3' })

      const visits = await runReport(
        request({
          key: 'site-visits',
          client: 'bell',
          startDate: '2026-02-01',
          endDate: '2026-02-28',
        }),
        tx,
      )
      expect(visits.rows.find((row) => row.site === `Test Store ${suffix}`)?.visits).toBe('3')

      const stock = await runReport(
        request({ key: 'parts-stock', search: `RPT-${suffix}` }),
        tx,
      )
      expect(stock.rows[0]).toMatchObject({
        partNumber: `RPT-${suffix}`,
        quantity: '6.00',
        stockCost: '15.00',
        stockValue: '24.00',
      })
      expect(stock.totals?.stockValue).toBe('24.00')
    })
  })

  test('exports produce real PDF and XLSX bytes and an audit row', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const base = request({ client: 'bell' })
      const pdf = await exportReport({ ...base, format: 'pdf' }, ADMIN_ID, tx)
      expect(Buffer.from(pdf.base64, 'base64').subarray(0, 4).toString()).toBe('%PDF')
      expect(pdf.fileName.endsWith('.pdf')).toBe(true)

      const xlsx = await exportReport({ ...base, format: 'xlsx' }, ADMIN_ID, tx)
      const bytes = Buffer.from(xlsx.base64, 'base64')
      expect(bytes.subarray(0, 2).toString()).toBe('PK')
      expect(xlsx.rowCount).toBeGreaterThan(0)

      const audits = await tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, 'client-invoices'))
      expect(audits.length).toBeGreaterThanOrEqual(2)
    })
  })
})
