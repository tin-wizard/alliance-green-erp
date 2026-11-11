/**
 * TJX quote editor: server-owned totals, snapshots, revisions and concurrency.
 * Real database, always rolled back. No DDL.
 */
import { desc, eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { ALL_PERMISSIONS, ConflictError, ForbiddenError, ValidationError } from '@cls/core'
import { getConfig } from '@cls/core/env.server'
import { getDb, type Tx } from '@cls/db'
import {
  auditLog,
  customers,
  parts,
  sites,
  tjxFixtureParts,
  tjxFixtures,
  tjxQuoteFixtures,
  tjxQuoteRooms,
  tjxQuoteRevisions,
  tjxQuotes,
  tjxRoomTemplateRooms,
  tjxRoomTemplates,
  tjxRooms,
  users,
} from '@cls/db/schema'
import { calculateTjxQuote } from '@cls/pricing'
import type { AuthSessionView } from '../../../server/auth.types'
import type { TjxQuoteCreateInput, TjxQuoteSaveInput } from '../types'
import { createQuoteCore, getQuoteDetail, saveQuoteCore } from './quotes.server'
import { setDefaultTemplateCore } from './templates.server'

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
const CUSTOMER_ID = 9_430_001
const SITE_ID = 9_430_001
const PART_ONE = 9_430_101
const PART_TWO = 9_430_102
const PART_MISSING = 9_430_103

function adminSession(): AuthSessionView {
  return {
    id: 'session-tjx-quotes',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id: ADMIN_ID,
      email: 'tjx-quotes-admin@example.test',
      username: 'tjx-quotes-admin',
      displayName: 'TJX Quotes Admin',
      role: 'admin',
      subcontractorId: null,
      grants: ALL_PERMISSIONS.map((key) => ({ key, scopeSubcontractorId: null })),
    },
  }
}

function readOnlySession(): AuthSessionView {
  return {
    id: 'session-tjx-quotes-reader',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id: READER_ID,
      email: 'tjx-quotes-reader@example.test',
      username: 'tjx-quotes-reader',
      displayName: 'TJX Quotes Reader',
      role: 'technician',
      subcontractorId: null,
      grants: [{ key: 'tjx:read', scopeSubcontractorId: null }],
    },
  }
}

async function seed(tx: Tx): Promise<{ fixtureId: number }> {
  await tx.insert(users).values([
    {
      id: ADMIN_ID,
      email: 'tjx-quotes-admin@example.test',
      username: 'tjx-quotes-admin',
      displayName: 'TJX Quotes Admin',
      role: 'admin',
    },
    {
      id: READER_ID,
      email: 'tjx-quotes-reader@example.test',
      username: 'tjx-quotes-reader',
      displayName: 'TJX Quotes Reader',
      role: 'technician',
    },
  ])
  await tx.insert(customers).values({ id: CUSTOMER_ID, name: 'TJX Test Customer' })
  await tx.insert(sites).values({
    id: SITE_ID,
    customerId: CUSTOMER_ID,
    name: 'TJX Test Site',
    street: '1 Test Street',
    city: 'Toronto',
    province: 'ON',
    postalCode: 'M5V 1A1',
  })
  await tx.insert(parts).values([
    {
      id: PART_ONE,
      partNumber: 'TJX-IT-100',
      name: 'TJX test lamp',
      sellPrice: '10.00',
    },
    {
      id: PART_TWO,
      partNumber: 'TJX-IT-200',
      name: 'TJX test ballast',
      sellPrice: '20.00',
    },
    {
      id: PART_MISSING,
      partNumber: 'TJX-IT-NOPRICE',
      name: 'TJX no price',
      sellPrice: null,
    },
  ])

  const [roomOne] = await tx
    .insert(tjxRooms)
    .values({ name: 'TJX Test Room A', isActive: true })
    .returning()
  const [roomTwo] = await tx
    .insert(tjxRooms)
    .values({ name: 'TJX Test Room B', isActive: true })
    .returning()
  const [template] = await tx
    .insert(tjxRoomTemplates)
    .values({ name: 'TJX Test Template', isDefault: false })
    .returning()
  await tx.insert(tjxRoomTemplateRooms).values([
    { templateId: template!.id, roomId: roomOne!.id, sortOrder: 0 },
    { templateId: template!.id, roomId: roomTwo!.id, sortOrder: 1 },
  ])
  await setDefaultTemplateCore(tx, template!.id, adminSession())

  const [fixture] = await tx
    .insert(tjxFixtures)
    .values({ name: 'TJX Test Fixture', isActive: true })
    .returning()
  await tx
    .insert(tjxFixtureParts)
    .values([
      {
        fixtureId: fixture!.id,
        partNo: 'TJX-IT-100',
        partType: 'Lamp',
        markup: '1.5',
        ratioPerFixture: '2',
        sortOrder: 0,
      },
      {
        fixtureId: fixture!.id,
        partNo: 'TJX-IT-200',
        partType: 'Ballast',
        markup: '1',
        ratioPerFixture: '1',
        sortOrder: 1,
      },
    ])

  return { fixtureId: fixture!.id }
}

function header(): TjxQuoteCreateInput {
  return {
    siteId: SITE_ID,
    quoteType: 'Gen 1',
    ceilingGridType: 2,
    isTypeMaintenance: false,
    paymentTermsCode: 4,
    dueDate: '2026-12-01',
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
    notes: 'Test quote',
    pdfNotes: null,
  }
}

function saveInput(quote: { id: number; version: number }): TjxQuoteSaveInput {
  return {
    ...header(),
    id: quote.id,
    version: quote.version,
    revisionNotes: 'Save from integration test',
    rooms: [],
    specialParts: [],
    priceOverrides: [],
  }
}

describe.skipIf(!databaseConfigured())('TJX quote editor', () => {
  test('creates from the default template in order and writes the insert revision', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const quote = await createQuoteCore(tx, header(), adminSession())

      expect(quote.siteId).toBe(SITE_ID)
      expect(quote.customerName).toBe('TJX Test Customer')
      expect(quote.status).toBe(1)
      expect(quote.appliedTaxRate).toBe('0.13000')
      expect(quote.rooms.map((room) => room.roomName)).toEqual([
        'TJX Test Room A',
        'TJX Test Room B',
      ])

      const revisions = await tx
        .select()
        .from(tjxQuoteRevisions)
        .where(eq(tjxQuoteRevisions.quoteId, quote.id))
      expect(revisions).toHaveLength(1)
      expect(revisions[0]!.revisionType).toBe('insert')
      expect(revisions[0]!.saveSeq).toBe(1)

      const audits = await tx
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, 'tjx.quote.create'))
        .orderBy(desc(auditLog.id))
      expect(audits[0]?.entityId).toBe(String(quote.id))
    })
  })

  test('calculates both triplets on the server and persists the aggregates', async () => {
    await inRollback(async (tx) => {
      const { fixtureId } = await seed(tx)
      const created = await createQuoteCore(tx, header(), adminSession())
      const input = saveInput(created)
      input.rooms = [
        {
          roomId: null,
          roomName: 'Test Room',
          fixtures: [
            {
              fixtureId,
              fixtureName: 'TJX Test Fixture',
              quantity: '2',
              parts: [
                {
                  partNo: 'TJX-IT-100',
                  partType: 'Lamp',
                  markup: '1.5',
                  ratioPerFixture: '2',
                },
                {
                  partNo: 'TJX-IT-200',
                  partType: 'Ballast',
                  markup: '1',
                  ratioPerFixture: '1',
                },
              ],
            },
          ],
        },
      ]
      input.specialParts = [{ name: 'Freight', quantity: '1', unitPrice: '5.00' }]

      const saved = await saveQuoteCore(tx, input, adminSession())
      const expected = calculateTjxQuote({
        taxRate: '0.13',
        fixtures: [
          {
            quantity: '2',
            parts: [
              { partNo: 'TJX-IT-100', markup: '1.5', ratioPerFixture: '2' },
              { partNo: 'TJX-IT-200', markup: '1', ratioPerFixture: '1' },
            ],
          },
        ],
        specialParts: [{ name: 'Freight', quantity: '1', unitPrice: '5.00' }],
        prices: { 'TJX-IT-100': '10.00', 'TJX-IT-200': '20.00' },
      })

      expect(saved.subtotal).toBe(expected.subtotal)
      expect(saved.tax).toBe(expected.tax)
      expect(saved.total).toBe(expected.total)
      expect(saved.withoutMarkupSubtotal).toBe(expected.withoutMarkupSubtotal)
      expect(saved.withoutMarkupTax).toBe(expected.withoutMarkupTax)
      expect(saved.withoutMarkupTotal).toBe(expected.withoutMarkupTotal)
      expect(saved.parts.map((part) => part.partNo)).toEqual(['TJX-IT-100', 'TJX-IT-200'])
      expect(saved.parts[0]!.qtyWithMarkup).toBe('6.000')
      expect(saved.parts[0]!.qtyWithoutMarkup).toBe('4.000')
      expect(saved.specialParts[0]!.name).toBe('Freight')

      const [row] = await tx.select().from(tjxQuotes).where(eq(tjxQuotes.id, created.id))
      expect(row!.subtotalAmount).toBe(expected.subtotal)
      expect(row!.totalAmount).toBe(expected.total)
      expect(row!.version).toBe(2)
    })
  })

  test('ignores posted totals; hidden tampering cannot change the stored money', async () => {
    await inRollback(async (tx) => {
      const { fixtureId } = await seed(tx)
      const created = await createQuoteCore(tx, header(), adminSession())
      const input = saveInput(created)
      input.rooms = [
        {
          roomId: null,
          roomName: 'Test Room',
          fixtures: [
            {
              fixtureId,
              fixtureName: 'TJX Test Fixture',
              quantity: '1',
              parts: [
                {
                  partNo: 'TJX-IT-100',
                  partType: 'Lamp',
                  markup: '1',
                  ratioPerFixture: '1',
                },
              ],
            },
          ],
        },
      ]

      const tampered = {
        ...input,
        subtotalAmount: '999999.99',
        taxAmount: '1.00',
        totalAmount: '1.00',
        withoutMarkupSubtotalAmount: '0.01',
        withoutMarkupTaxAmount: '0.02',
        withoutMarkupTotalAmount: '0.03',
      } as TjxQuoteSaveInput

      const saved = await saveQuoteCore(tx, tampered, adminSession())
      const [row] = await tx.select().from(tjxQuotes).where(eq(tjxQuotes.id, created.id))

      expect(saved.subtotal).toBe('10.00')
      expect(saved.total).toBe('11.30')
      expect(row!.subtotalAmount).toBe('10.00')
      expect(row!.taxAmount).toBe('1.30')
      expect(row!.totalAmount).toBe('11.30')
      expect(row!.withoutMarkupTotalAmount).toBe('11.30')
    })
  })

  test('snapshots part prices and keeps them when the master changes', async () => {
    await inRollback(async (tx) => {
      const { fixtureId } = await seed(tx)
      const created = await createQuoteCore(tx, header(), adminSession())
      const input = saveInput(created)
      input.rooms = [
        {
          roomId: null,
          roomName: 'Test Room',
          fixtures: [
            {
              fixtureId,
              fixtureName: 'TJX Test Fixture',
              quantity: '1',
              parts: [
                {
                  partNo: 'TJX-IT-100',
                  partType: 'Lamp',
                  markup: '1',
                  ratioPerFixture: '1',
                },
              ],
            },
          ],
        },
      ]

      const first = await saveQuoteCore(tx, input, adminSession())
      expect(first.prices.find((price) => price.partNo === 'TJX-IT-100')?.source).toBe('snapshot')

      await tx.update(parts).set({ sellPrice: '99.00' }).where(eq(parts.id, PART_ONE))

      const secondInput = saveInput(first)
      secondInput.rooms = input.rooms
      const second = await saveQuoteCore(tx, secondInput, adminSession())
      expect(second.parts[0]!.unitPrice).toBe('10.00')
      expect(second.total).toBe('11.30')
    })
  })

  test('a price override survives a save and records its previous price', async () => {
    await inRollback(async (tx) => {
      const { fixtureId } = await seed(tx)
      const created = await createQuoteCore(tx, header(), adminSession())
      const input = saveInput(created)
      input.rooms = [
        {
          roomId: null,
          roomName: 'Test Room',
          fixtures: [
            {
              fixtureId,
              fixtureName: 'TJX Test Fixture',
              quantity: '1',
              parts: [
                {
                  partNo: 'TJX-IT-100',
                  partType: 'Lamp',
                  markup: '1',
                  ratioPerFixture: '1',
                },
              ],
            },
          ],
        },
      ]
      input.priceOverrides = [{ partNo: 'TJX-IT-100', price: '12.34' }]

      const first = await saveQuoteCore(tx, input, adminSession())
      const override = first.prices.find((price) => price.partNo === 'TJX-IT-100')
      expect(override?.price).toBe('12.34')
      expect(override?.previousPrice).toBe('10.00')
      expect(override?.source).toBe('override')
      expect(first.total).toBe('13.94')

      const secondInput = saveInput(first)
      secondInput.rooms = input.rooms
      const second = await saveQuoteCore(tx, secondInput, adminSession())
      expect(second.parts[0]!.unitPrice).toBe('12.34')
      expect(second.prices.find((price) => price.partNo === 'TJX-IT-100')?.source).toBe('override')
    })
  })

  test('a missing price names the part and blocks the save', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const created = await createQuoteCore(tx, header(), adminSession())
      const input = saveInput(created)
      input.rooms = [
        {
          roomId: null,
          roomName: 'Test Room',
          fixtures: [
            {
              fixtureId: null,
              fixtureName: 'No price fixture',
              quantity: '1',
              parts: [
                {
                  partNo: 'TJX-IT-NOPRICE',
                  partType: 'Lamp',
                  markup: '1',
                  ratioPerFixture: '1',
                },
              ],
            },
          ],
        },
      ]

      await expect(saveQuoteCore(tx, input, adminSession())).rejects.toThrow(/TJX-IT-NOPRICE/)
    })
  })

  test('writes one revision per save without bumping revision_no', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const created = await createQuoteCore(tx, header(), adminSession())
      const firstInput = saveInput(created)
      const first = await saveQuoteCore(tx, firstInput, adminSession())
      const secondInput = saveInput(first)
      const second = await saveQuoteCore(tx, secondInput, adminSession())

      const revisions = await tx
        .select()
        .from(tjxQuoteRevisions)
        .where(eq(tjxQuoteRevisions.quoteId, created.id))
        .orderBy(tjxQuoteRevisions.saveSeq)
      expect(revisions.map((row) => row.revisionType)).toEqual(['insert', 'update', 'update'])
      expect(revisions.map((row) => row.saveSeq)).toEqual([1, 2, 3])
      expect(second.revisionNo).toBe(0)
      expect(revisions[2]!.dataQuote).toMatchObject({ total: '0.00' })
    })
  })

  test('rejects a stale version with a conflict', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const created = await createQuoteCore(tx, header(), adminSession())
      const firstInput = saveInput(created)
      const first = await saveQuoteCore(tx, firstInput, adminSession())
      const stale = saveInput(created)

      await expect(saveQuoteCore(tx, stale, adminSession())).rejects.toBeInstanceOf(ConflictError)
      expect(first.version).toBe(2)
    })
  })

  test('locks an approved quote and enforces tjx:write', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const created = await createQuoteCore(tx, header(), adminSession())
      await tx.update(tjxQuotes).set({ status: 4 }).where(eq(tjxQuotes.id, created.id))

      await expect(
        saveQuoteCore(tx, saveInput({ id: created.id, version: 1 }), adminSession()),
      ).rejects.toBeInstanceOf(ValidationError)

      await expect(
        saveQuoteCore(tx, saveInput(created), readOnlySession()),
      ).rejects.toBeInstanceOf(ForbiddenError)

      const detail = await getQuoteDetail(tx, created.id)
      expect(detail.canEdit).toBe(false)
    })
  })

  test('removing rooms, fixtures and special parts clears the persisted aggregates', async () => {
    await inRollback(async (tx) => {
      const { fixtureId } = await seed(tx)
      const created = await createQuoteCore(tx, header(), adminSession())
      const input = saveInput(created)
      input.rooms = [
        {
          roomId: null,
          roomName: 'Test Room',
          fixtures: [
            {
              fixtureId,
              fixtureName: 'TJX Test Fixture',
              quantity: '1',
              parts: [
                {
                  partNo: 'TJX-IT-100',
                  partType: 'Lamp',
                  markup: '1',
                  ratioPerFixture: '1',
                },
              ],
            },
          ],
        },
      ]
      input.specialParts = [{ name: 'Freight', quantity: '1', unitPrice: '5.00' }]
      const first = await saveQuoteCore(tx, input, adminSession())
      expect(first.parts).toHaveLength(1)

      const cleared = saveInput(first)
      const saved = await saveQuoteCore(tx, cleared, adminSession())
      expect(saved.parts).toEqual([])
      expect(saved.specialParts).toEqual([])
      expect(saved.total).toBe('0.00')
      expect(saved.rooms).toEqual([])

      const [roomCount] = await tx
        .select({ n: tjxQuoteRooms.id })
        .from(tjxQuoteRooms)
        .where(eq(tjxQuoteRooms.quoteId, created.id))
      expect(roomCount).toBeUndefined()
      const [fixtureCount] = await tx
        .select({ n: tjxQuoteFixtures.id })
        .from(tjxQuoteFixtures)
        .where(eq(tjxQuoteFixtures.quoteId, created.id))
      expect(fixtureCount).toBeUndefined()
    })
  })

  test('stores the province rate for the site and applies it on save', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      await tx.update(sites).set({ province: 'BC' }).where(eq(sites.id, SITE_ID))
      const input = header()
      input.siteId = SITE_ID
      input.taxProvince = null
      const created = await createQuoteCore(tx, input, adminSession())

      expect(created.taxProvince).toBe('BC')
      expect(created.appliedTaxRate).toBe('0.05000')
    })
  })
})
