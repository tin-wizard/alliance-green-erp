/**
 * Parts-on-approval workbook. Real database, rolled back.
 */
import { describe, expect, test, vi } from 'vitest'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { ALL_PERMISSIONS } from '@cls/core'
import { getConfig } from '@cls/core/env.server'
import { getDb, type Tx } from '@cls/db'
import { customers, sites, users } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type { TjxQuoteCreateInput, TjxQuoteSaveInput } from '../types'
import { createQuoteCore, saveQuoteCore } from './quotes.server'
import { submitQuoteCore } from './lifecycle.server'
import { exportPartsOnApprovalCore } from './exports.server'

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
const CUSTOMER_ID = 9_470_001
const SITE_ID = 9_470_001

function adminSession(): AuthSessionView {
  return {
    id: 'session-tjx-export',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id: ADMIN_ID,
      email: 'tjx-export@example.test',
      username: 'tjx-export',
      displayName: 'TJX Export Admin',
      role: 'admin',
      subcontractorId: null,
      grants: ALL_PERMISSIONS.map((key) => ({ key, scopeSubcontractorId: null })),
    },
  }
}

async function seed(tx: Tx): Promise<void> {
  await tx.insert(users).values({
    id: ADMIN_ID,
    email: 'tjx-export@example.test',
    username: 'tjx-export',
    displayName: 'TJX Export Admin',
    role: 'admin',
  })
  await tx.insert(customers).values({ id: CUSTOMER_ID, name: 'TJX Export Customer' })
  await tx.insert(sites).values({
    id: SITE_ID,
    customerId: CUSTOMER_ID,
    name: 'TJX Export Site',
    street: '5 Export Way',
    city: 'Toronto',
    province: 'ON',
    postalCode: 'M5V 1A5',
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
    notes: null,
    pdfNotes: null,
  }
}

async function waitingQuote(
  tx: Tx,
  input: { quantity: string; province: string; parts: { partNo: string; ratio: string; markup: string }[] },
): Promise<void> {
  const created = await createQuoteCore(
    tx,
    { ...quoteInput(), shipProvince: input.province, taxProvince: input.province },
    adminSession(),
  )
  const save: TjxQuoteSaveInput = {
    ...quoteInput(),
    shipProvince: input.province,
    taxProvince: input.province,
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
            fixtureName: 'Troffer',
            quantity: input.quantity,
            parts: input.parts.map((part) => ({
              partNo: part.partNo,
              partType: 'Ballast' as const,
              markup: part.markup,
              ratioPerFixture: part.ratio,
            })),
          },
        ],
      },
    ],
    specialParts: [],
    priceOverrides: input.parts.map((part) => ({ partNo: part.partNo, price: '30.00' })),
  }
  const saved = await saveQuoteCore(tx, save, adminSession())
  await submitQuoteCore(tx, { id: saved.id, version: saved.version }, adminSession())
}

describe.skipIf(!databaseConfigured())('TJX parts-on-approval export', () => {
  test('writes a summary and one sheet per province with grouped family quantities', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      await waitingQuote(tx, {
        quantity: '10',
        province: 'ON',
        parts: [
          { partNo: 'WIN-100', ratio: '1', markup: '2' },
          { partNo: '1240', ratio: '1', markup: '1' },
          { partNo: 'ABC-900', ratio: '1', markup: '1' },
          { partNo: 'WIN-ZERO', ratio: '0', markup: '1' },
        ],
      })
      await waitingQuote(tx, {
        quantity: '5',
        province: 'QC',
        parts: [{ partNo: 'WIN-100', ratio: '1', markup: '2' }],
      })

      const result = await exportPartsOnApprovalCore(tx, adminSession())
      expect(result.filename).toContain('status-3')
      expect(result.filename.endsWith('.xlsx')).toBe(true)

      const ExcelJS = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(
        Buffer.from(result.base64, 'base64') as unknown as Parameters<typeof workbook.xlsx.load>[0],
      )
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
        'Waiting for Approval Parts',
        'Waiting for Approval Parts - ON',
        'Waiting for Approval Parts - QC',
      ])

      const summary = workbook.getWorksheet('Waiting for Approval Parts')!
      expect(summary.getRow(1).values).toEqual([
        undefined,
        'Part Number',
        'Quote Type',
        'Quantity',
        'Quantity with No Markup',
      ])
      const rows = new Map<string, { quantity: number; without: number }>()
      summary.eachRow((row, number) => {
        if (number === 1) return
        rows.set(String(row.getCell(1).value), {
          quantity: Number(row.getCell(3).value),
          without: Number(row.getCell(4).value),
        })
      })
      expect(rows.get('WIN-100')).toEqual({ quantity: 30, without: 15 })
      expect(rows.get('1240')).toEqual({ quantity: 10, without: 10 })
      expect(rows.has('ABC-900')).toBe(false)
      expect(rows.has('WIN-ZERO')).toBe(false)
      expect(summary.getRow(2).getCell(1).numFmt).toBe('@')
      expect(summary.getRow(2).getCell(2).numFmt).toBe('@')

      const on = workbook.getWorksheet('Waiting for Approval Parts - ON')!
      const onRows = new Map<string, number>()
      on.eachRow((row, number) => {
        if (number > 1) onRows.set(String(row.getCell(1).value), Number(row.getCell(3).value))
      })
      expect(onRows.get('WIN-100')).toBe(20)
      const qc = workbook.getWorksheet('Waiting for Approval Parts - QC')!
      const qcRows = new Map<string, number>()
      qc.eachRow((row, number) => {
        if (number > 1) qcRows.set(String(row.getCell(1).value), Number(row.getCell(3).value))
      })
      expect(qcRows.get('WIN-100')).toBe(10)
    })
  })
})
