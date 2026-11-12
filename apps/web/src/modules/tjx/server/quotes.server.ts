/**
 * TJX quotes: header, snapshots, server-owned totals and revisions.
 *
 * SERVER ONLY. Every write runs in one transaction with its revision and audit
 * row. The client may post markup, ratio, quantities, prices and notes; it may
 * never make a total authoritative. `calculateTjxQuote` runs here, on the
 * canonical part numbers and the quote's own price snapshots.
 */
import { and, asc, desc, eq, inArray, ilike, or, sql, type SQL } from 'drizzle-orm'
import { ConflictError, NotFoundError, ValidationError } from '@cls/core'
import type { Executor, Tx } from '@cls/db'
import {
  customers,
  parts,
  sites,
  tjxQuoteFixtureParts,
  tjxQuoteFixtures,
  tjxQuoteParts,
  tjxQuotePrices,
  tjxQuoteRevisions,
  tjxQuoteRooms,
  tjxQuoteSpecialParts,
  tjxQuoteWorkOrders,
  tjxQuotes,
} from '@cls/db/schema'
import {
  calculateTjxQuote,
  format,
  normalizeSalesProvince,
  PricingError,
  salesTaxRate,
  type TjxQuoteCalculation,
} from '@cls/pricing'
import type { AuthSessionView } from '../../../server/auth.types'
import type {
  TjxQuoteDetail,
  TjxQuoteListFilters,
  TjxQuoteListRow,
  TjxQuotePriceRow,
  TjxQuoteRoomInput,
  TjxQuoteSaveInput,
  TjxQuoteRoomRow,
  TjxQuoteFixtureRow,
} from '../types'
import type { TjxGridType, TjxPaymentTerms, TjxQuoteType } from '../lib/lifecycle'
import type { CreateQuoteInput } from '../lib/quotes.validation'
import { canEditQuote, statusLabel } from '../lib/lifecycle'
import { getSite } from '../../work-orders/lib/lookups'
import { assertTjxWrite, auditTjx, normalizePartNo } from './access.server'
import { getDefaultTemplate } from './templates.server'

/* --------------------------------- reads ---------------------------------- */

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

export async function listQuotes(
  executor: Executor,
  filters: TjxQuoteListFilters,
): Promise<TjxQuoteListRow[]> {
  const conditions: SQL[] = []
  if (filters.status !== undefined) conditions.push(eq(tjxQuotes.status, filters.status))
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`
    conditions.push(
      or(
        sql`${tjxQuotes.id}::text ilike ${term}`,
        ilike(sites.name, term),
        ilike(customers.name, term),
      )!,
    )
  }

  const rows = await executor
    .select({
      quote: tjxQuotes,
      siteName: sites.name,
      customerName: customers.name,
    })
    .from(tjxQuotes)
    .leftJoin(sites, eq(tjxQuotes.siteId, sites.id))
    .leftJoin(customers, eq(tjxQuotes.customerId, customers.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(tjxQuotes.updatedAt), desc(tjxQuotes.id))
    .limit(200)

  if (rows.length === 0) return []
  const ids = rows.map((row) => row.quote.id)

  const [roomCounts, fixtureCounts] = await Promise.all([
    executor
      .select({ quoteId: tjxQuoteRooms.quoteId, n: sql<number>`count(*)::int` })
      .from(tjxQuoteRooms)
      .where(inArray(tjxQuoteRooms.quoteId, ids))
      .groupBy(tjxQuoteRooms.quoteId),
    executor
      .select({ quoteId: tjxQuoteFixtures.quoteId, n: sql<number>`count(*)::int` })
      .from(tjxQuoteFixtures)
      .where(inArray(tjxQuoteFixtures.quoteId, ids))
      .groupBy(tjxQuoteFixtures.quoteId),
  ])
  const rooms = new Map(roomCounts.map((row) => [row.quoteId, row.n]))
  const fixtures = new Map(fixtureCounts.map((row) => [row.quoteId, row.n]))

  return rows.map(({ quote, siteName, customerName }) => ({
    id: quote.id,
    status: quote.status,
    statusLabel: statusLabel(quote.status),
    siteId: quote.siteId,
    siteName: siteName ?? null,
    customerName: customerName ?? null,
    quoteType: quote.quoteType as TjxQuoteType,
    gridType: quote.ceilingGridType as TjxGridType | null,
    paymentTermsCode: quote.paymentTermsCode as TjxPaymentTerms | null,
    subtotal: quote.subtotalAmount,
    tax: quote.taxAmount,
    total: quote.totalAmount,
    withoutMarkupSubtotal: quote.withoutMarkupSubtotalAmount,
    withoutMarkupTax: quote.withoutMarkupTaxAmount,
    withoutMarkupTotal: quote.withoutMarkupTotalAmount,
    revisionNo: quote.revisionNo,
    roomCount: rooms.get(quote.id) ?? 0,
    fixtureCount: fixtures.get(quote.id) ?? 0,
    updatedAt: quote.updatedAt.toISOString(),
  }))
}

export async function getQuoteDetail(
  executor: Executor,
  quoteId: number,
): Promise<TjxQuoteDetail> {
  const [row] = await executor
    .select({
      quote: tjxQuotes,
      siteName: sites.name,
      customerName: customers.name,
    })
    .from(tjxQuotes)
    .leftJoin(sites, eq(tjxQuotes.siteId, sites.id))
    .leftJoin(customers, eq(tjxQuotes.customerId, customers.id))
    .where(eq(tjxQuotes.id, quoteId))
    .limit(1)
  if (!row) throw new NotFoundError('TJX quote')
  const quote = row.quote

  const [roomRows, fixtureRows, partRows, priceRows, specialRows, workOrderRows] =
    await Promise.all([
      executor
        .select()
        .from(tjxQuoteRooms)
        .where(eq(tjxQuoteRooms.quoteId, quoteId))
        .orderBy(asc(tjxQuoteRooms.sortOrder), asc(tjxQuoteRooms.id)),
      executor
        .select()
        .from(tjxQuoteFixtures)
        .where(eq(tjxQuoteFixtures.quoteId, quoteId))
        .orderBy(asc(tjxQuoteFixtures.sortOrder), asc(tjxQuoteFixtures.id)),
      executor
        .select()
        .from(tjxQuoteParts)
        .where(eq(tjxQuoteParts.quoteId, quoteId))
        .orderBy(asc(tjxQuoteParts.sortOrder), asc(tjxQuoteParts.id)),
      executor
        .select()
        .from(tjxQuotePrices)
        .where(eq(tjxQuotePrices.quoteId, quoteId))
        .orderBy(asc(tjxQuotePrices.partNo)),
      executor
        .select()
        .from(tjxQuoteSpecialParts)
        .where(eq(tjxQuoteSpecialParts.quoteId, quoteId))
        .orderBy(asc(tjxQuoteSpecialParts.sortOrder), asc(tjxQuoteSpecialParts.id)),
      executor
        .select()
        .from(tjxQuoteWorkOrders)
        .where(eq(tjxQuoteWorkOrders.quoteId, quoteId))
        .orderBy(asc(tjxQuoteWorkOrders.sortOrder), asc(tjxQuoteWorkOrders.id)),
    ])

  const fixtureIds = fixtureRows.map((fixture) => fixture.id)
  const fixturePartRows = fixtureIds.length
    ? await executor
        .select()
        .from(tjxQuoteFixtureParts)
        .where(inArray(tjxQuoteFixtureParts.quoteFixtureId, fixtureIds))
        .orderBy(
          asc(tjxQuoteFixtureParts.sortOrder),
          asc(tjxQuoteFixtureParts.id),
        )
    : []

  const partsByFixture = new Map<number, TjxQuoteFixtureRow['parts']>()
  for (const part of fixturePartRows) {
    const list = partsByFixture.get(part.quoteFixtureId) ?? []
    list.push({
      id: part.id,
      partNo: part.partNo,
      partType: part.partType,
      markup: part.markup,
      ratioPerFixture: part.ratioPerFixture,
      sortOrder: part.sortOrder,
    })
    partsByFixture.set(part.quoteFixtureId, list)
  }

  const fixturesByRoom = new Map<number, TjxQuoteFixtureRow[]>()
  for (const fixture of fixtureRows) {
    const list = fixturesByRoom.get(fixture.quoteRoomId) ?? []
    list.push({
      id: fixture.id,
      fixtureId: fixture.fixtureId,
      fixtureName: fixture.fixtureName,
      quantity: fixture.quantity,
      sortOrder: fixture.sortOrder,
      parts: partsByFixture.get(fixture.id) ?? [],
    })
    fixturesByRoom.set(fixture.quoteRoomId, list)
  }

  return {
    id: quote.id,
    status: quote.status,
    statusLabel: statusLabel(quote.status),
    version: quote.version,
    quoteType: quote.quoteType as TjxQuoteType,
    ceilingGridType: quote.ceilingGridType as TjxGridType | null,
    isTypeMaintenance: quote.isTypeMaintenance,
    paymentTermsCode: quote.paymentTermsCode as TjxPaymentTerms | null,
    dueDate: quote.dueDate,
    siteId: quote.siteId,
    siteName: row.siteName ?? null,
    customerId: quote.customerId,
    customerName: row.customerName ?? null,
    shipToType: quote.shipToType,
    shipContactName: quote.shipContactName,
    shipCompany: quote.shipCompany,
    shipStreet1: quote.shipStreet1,
    shipStreet2: quote.shipStreet2,
    shipCity: quote.shipCity,
    shipProvince: quote.shipProvince,
    shipPostalCode: quote.shipPostalCode,
    shipPhone: quote.shipPhone,
    shippingAddress: quote.shippingAddress,
    taxCode: quote.taxCode,
    taxProvince: quote.taxProvince,
    appliedTaxRate: quote.appliedTaxRate,
    notes: quote.notes,
    pdfNotes: quote.pdfNotes,
    revisionNotes: quote.revisionNotes,
    revisionNo: quote.revisionNo,
    subtotal: quote.subtotalAmount,
    tax: quote.taxAmount,
    total: quote.totalAmount,
    withoutMarkupSubtotal: quote.withoutMarkupSubtotalAmount,
    withoutMarkupTax: quote.withoutMarkupTaxAmount,
    withoutMarkupTotal: quote.withoutMarkupTotalAmount,
    canEdit: canEditQuote(quote.status),
    createdAt: quote.createdAt.toISOString(),
    updatedAt: quote.updatedAt.toISOString(),
    rooms: roomRows.map<TjxQuoteRoomRow>((room) => ({
      id: room.id,
      roomId: room.roomId,
      roomName: room.roomName,
      sortOrder: room.sortOrder,
      fixtures: fixturesByRoom.get(room.id) ?? [],
    })),
    parts: partRows.map((part) => ({
      partNo: part.partNo,
      description: part.description,
      qtyWithMarkup: part.qtyWithMarkup,
      qtyWithoutMarkup: part.qtyWithoutMarkup,
      unitPrice: part.unitPrice,
      lineSubtotal: part.lineSubtotal,
      lineSubtotalWithoutMarkup: part.lineSubtotalWithoutMarkup,
      sortOrder: part.sortOrder,
    })),
    prices: priceRows.map<TjxQuotePriceRow>((price) => ({
      partNo: price.partNo,
      price: price.price,
      previousPrice: price.previousPrice,
      source: price.source as TjxQuotePriceRow['source'],
    })),
    specialParts: specialRows.map((part) => ({
      id: part.id,
      name: part.name,
      quantity: part.quantity,
      unitPrice: part.unitPrice,
      lineSubtotal: part.lineSubtotal,
      sortOrder: part.sortOrder,
    })),
    workOrders: workOrderRows.map((link) => ({
      workOrderId: link.workOrderId,
      isPrimary: link.isPrimary,
      sortOrder: link.sortOrder,
      linkedAt: link.linkedAt.toISOString(),
    })),
  }
}

/* -------------------------------- helpers --------------------------------- */

function taxProvinceFor(siteProvince: string | null, input: string | null): string {
  return normalizeSalesProvince(input || siteProvince || 'ON')
}

function appliedRate(input: string | null, province: string): string {
  return input ?? format(salesTaxRate(province).rate, 5)
}

function headerValues(input: TjxQuoteSaveInput | CreateQuoteInput) {
  return {
    quoteType: input.quoteType,
    ceilingGridType: input.ceilingGridType,
    isTypeMaintenance: input.isTypeMaintenance,
    paymentTermsCode: input.paymentTermsCode,
    dueDate: input.dueDate,
    shipToType: input.shipToType,
    shipContactName: input.shipContactName,
    shipCompany: input.shipCompany,
    shipStreet1: input.shipStreet1,
    shipStreet2: input.shipStreet2,
    shipCity: input.shipCity,
    shipProvince: input.shipProvince,
    shipPostalCode: input.shipPostalCode,
    shipPhone: input.shipPhone,
    shippingAddress: input.shippingAddress,
    notes: input.notes,
    pdfNotes: input.pdfNotes,
  }
}

function normalizedRooms(rooms: TjxQuoteRoomInput[]): TjxQuoteRoomInput[] {
  return rooms.map((room) => ({
    roomId: room.roomId,
    roomName: room.roomName.trim(),
    fixtures: room.fixtures.map((fixture) => {
      const seen = new Set<string>()
      return {
        fixtureId: fixture.fixtureId,
        fixtureName: fixture.fixtureName.trim(),
        quantity: fixture.quantity,
        parts: fixture.parts.map((part) => {
          const partNo = normalizePartNo(part.partNo)
          if (seen.has(partNo)) {
            throw new ValidationError(
              `Part ${partNo} appears twice in fixture ${fixture.fixtureName}.`,
            )
          }
          seen.add(partNo)
          return {
            partNo,
            partType: part.partType,
            markup: part.markup,
            ratioPerFixture: part.ratioPerFixture,
          }
        }),
      }
    }),
  }))
}

function calculatorInput(
  rooms: TjxQuoteRoomInput[],
  specialParts: TjxQuoteSaveInput['specialParts'],
  taxRate: string,
  prices: Record<string, string>,
) {
  return {
    taxRate,
    fixtures: rooms.flatMap((room) =>
      room.fixtures.map((fixture) => ({
        quantity: fixture.quantity,
        parts: fixture.parts.map((part) => ({
          partNo: part.partNo,
          markup: part.markup,
          ratioPerFixture: part.ratioPerFixture,
        })),
      })),
    ),
    specialParts: specialParts.map((part) => ({
      name: part.name,
      quantity: part.quantity,
      unitPrice: part.unitPrice,
    })),
    prices,
  }
}

function calculate(input: ReturnType<typeof calculatorInput>): TjxQuoteCalculation {
  try {
    return calculateTjxQuote(input)
  } catch (error) {
    if (error instanceof PricingError) throw new ValidationError(error.message)
    throw error
  }
}

export function revisionQuoteData(row: typeof tjxQuotes.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    status: row.status,
    version: row.version,
    quoteType: row.quoteType,
    ceilingGridType: row.ceilingGridType,
    isTypeMaintenance: row.isTypeMaintenance,
    paymentTermsCode: row.paymentTermsCode,
    dueDate: row.dueDate,
    siteId: row.siteId,
    customerId: row.customerId,
    shipToType: row.shipToType,
    shipContactName: row.shipContactName,
    shipCompany: row.shipCompany,
    shipStreet1: row.shipStreet1,
    shipStreet2: row.shipStreet2,
    shipCity: row.shipCity,
    shipProvince: row.shipProvince,
    shipPostalCode: row.shipPostalCode,
    shipPhone: row.shipPhone,
    shippingAddress: row.shippingAddress,
    taxProvince: row.taxProvince,
    appliedTaxRate: row.appliedTaxRate,
    notes: row.notes,
    pdfNotes: row.pdfNotes,
    revisionNo: row.revisionNo,
    subtotal: row.subtotalAmount,
    tax: row.taxAmount,
    total: row.totalAmount,
    withoutMarkupSubtotal: row.withoutMarkupSubtotalAmount,
    withoutMarkupTax: row.withoutMarkupTaxAmount,
    withoutMarkupTotal: row.withoutMarkupTotalAmount,
  }
}

export async function nextSaveSeq(tx: Tx, quoteId: number): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number>`coalesce(max(${tjxQuoteRevisions.saveSeq}), 0)::int` })
    .from(tjxQuoteRevisions)
    .where(eq(tjxQuoteRevisions.quoteId, quoteId))
  return (row?.max ?? 0) + 1
}

async function writeRevision(
  tx: Tx,
  session: AuthSessionView,
  input: {
    quoteId: number
    revisionNo: number
    revisionType: 'insert' | 'update'
    dataQuote: Record<string, unknown>
    rooms: TjxQuoteRoomInput[]
    calculation: TjxQuoteCalculation
    notes: string | null
  },
): Promise<void> {
  await tx.insert(tjxQuoteRevisions).values({
    quoteId: input.quoteId,
    saveSeq: await nextSaveSeq(tx, input.quoteId),
    revisionNo: input.revisionNo,
    revisionType: input.revisionType,
    revisedBy: session.user.id,
    dataQuote: input.dataQuote,
    dataRooms: input.rooms as unknown as Record<string, unknown>[],
    dataFixtures: input.rooms.flatMap((room) =>
      room.fixtures.map((fixture) => ({
        roomName: room.roomName,
        fixtureName: fixture.fixtureName,
        quantity: fixture.quantity,
        parts: fixture.parts,
      })),
    ) as unknown as Record<string, unknown>[],
    dataParts: input.calculation.parts as unknown as Record<string, unknown>[],
    dataSpecialParts: input.calculation
      .specialParts as unknown as Record<string, unknown>[],
    notes: input.notes,
  })
}

/* --------------------------------- create --------------------------------- */

export async function createQuoteCore(
  tx: Tx,
  input: CreateQuoteInput,
  session: AuthSessionView,
): Promise<TjxQuoteDetail> {
  assertTjxWrite(session)
  const site = await getSite(input.siteId, tx)
  if (!site) throw new ValidationError('Choose a valid site for this quote.')

  const template = await getDefaultTemplate(tx)
  if (!template) {
    throw new ValidationError('Create a default room template before starting a TJX quote.')
  }

  const province = taxProvinceFor(site.province, input.taxProvince)
  const rate = appliedRate(input.appliedTaxRate, province)
  const header = headerValues(input)

  const [quote] = await tx
    .insert(tjxQuotes)
    .values({
      ...header,
      siteId: site.id,
      customerId: site.customerId || null,
      status: 1,
      version: 1,
      taxCode: province,
      taxProvince: province,
      appliedTaxRate: rate,
      shipProvince: input.shipProvince || site.province || null,
      shipStreet1: input.shipStreet1 || site.street || null,
      shipCity: input.shipCity || site.city || null,
      shipPostalCode: input.shipPostalCode || site.postalCode || null,
      createdBy: session.user.id,
      updatedBy: session.user.id,
    })
    .returning()
  if (!quote) throw new ValidationError('The TJX quote could not be created.')

  if (template.rooms.length) {
    await tx.insert(tjxQuoteRooms).values(
      template.rooms.map((room, index) => ({
        quoteId: quote.id,
        roomId: room.roomId,
        roomName: room.roomName,
        sortOrder: index,
      })),
    )
  }

  const rooms: TjxQuoteRoomInput[] = template.rooms.map((room) => ({
    roomId: room.roomId,
    roomName: room.roomName,
    fixtures: [],
  }))
  const emptyCalculation = calculate(calculatorInput(rooms, [], rate, {}))

  await writeRevision(tx, session, {
    quoteId: quote.id,
    revisionNo: 0,
    revisionType: 'insert',
    dataQuote: revisionQuoteData(quote),
    rooms,
    calculation: emptyCalculation,
    notes: input.notes,
  })

  await auditTjx(tx, session, 'tjx.quote.create', 'tjx_quote', quote.id, {
    summary: `Created TJX quote ${quote.id} from ${template.name}.`,
    after: quote as unknown as Record<string, unknown>,
  })

  return getQuoteDetail(tx, quote.id)
}

/* ---------------------------------- save ---------------------------------- */

export async function saveQuoteCore(
  tx: Tx,
  input: TjxQuoteSaveInput,
  session: AuthSessionView,
): Promise<TjxQuoteDetail> {
  assertTjxWrite(session)

  const [before] = await tx
    .select()
    .from(tjxQuotes)
    .where(eq(tjxQuotes.id, input.id))
    .limit(1)
  if (!before) throw new NotFoundError('TJX quote')
  if (!canEditQuote(before.status)) {
    throw new ValidationError('Only an in-progress or waiting-for-approval quote can be edited.')
  }
  if (before.version !== input.version) {
    throw new ConflictError(`TJX quote ${input.id} changed since you loaded it.`)
  }

  const site = await getSite(input.siteId, tx)
  if (!site) throw new ValidationError('Choose a valid site for this quote.')

  const rooms = normalizedRooms(input.rooms)
  const province = taxProvinceFor(site.province, input.taxProvince)
  const rate = appliedRate(input.appliedTaxRate, province)

  const partNumbers = new Set<string>()
  for (const room of rooms) {
    for (const fixture of room.fixtures) {
      for (const part of fixture.parts) partNumbers.add(part.partNo)
    }
  }

  const [existingPrices, masterParts] = await Promise.all([
    tx.select().from(tjxQuotePrices).where(eq(tjxQuotePrices.quoteId, input.id)),
    partNumbers.size
      ? tx
          .select({ partNumber: parts.partNumber, sellPrice: parts.sellPrice })
          .from(parts)
          .where(inArray(parts.partNumber, [...partNumbers]))
      : Promise.resolve([]),
  ])
  const existingByPart = new Map(existingPrices.map((price) => [price.partNo, price]))
  const masterByPart = new Map(masterParts.map((part) => [part.partNumber, part.sellPrice]))

  const overrides = new Map<string, string>()
  for (const override of input.priceOverrides) {
    const partNo = normalizePartNo(override.partNo)
    if (overrides.has(partNo)) {
      throw new ValidationError(`Part ${partNo} appears twice in the price list.`)
    }
    overrides.set(partNo, override.price)
  }

  const prices: Record<string, string> = {}
  const priceRows: Array<{
    quoteId: number
    partNo: string
    price: string
    previousPrice: string | null
    source: 'snapshot' | 'override' | 'imported'
    updatedBy: string
  }> = []

  for (const partNo of [...partNumbers].sort()) {
    const existing = existingByPart.get(partNo)
    const override = overrides.get(partNo)
    let price = existing?.price
    if (override !== undefined) {
      price = override
    } else if (price === undefined) {
      const master = masterByPart.get(partNo)
      if (!master) {
        throw new ValidationError(
          `No price is set for part ${partNo}. Enter a price override before saving.`,
        )
      }
      price = master
    }
    if (price === undefined) {
      throw new ValidationError(
        `No price is set for part ${partNo}. Enter a price override before saving.`,
      )
    }
    prices[partNo] = price
    priceRows.push({
      quoteId: input.id,
      partNo,
      price,
      previousPrice:
        override !== undefined
          ? (existing?.price ?? masterByPart.get(partNo) ?? null)
          : (existing?.previousPrice ?? null),
      source: override !== undefined ? 'override' : (existing?.source as 'snapshot' | 'override' | 'imported') ?? 'snapshot',
      updatedBy: session.user.id,
    })
  }

  const calculation = calculate(calculatorInput(rooms, input.specialParts, rate, prices))

  const [updated] = await tx
    .update(tjxQuotes)
    .set({
      ...headerValues(input),
      siteId: site.id,
      customerId: site.customerId || null,
      taxCode: province,
      taxProvince: province,
      appliedTaxRate: rate,
      shipProvince: input.shipProvince || site.province || null,
      shipStreet1: input.shipStreet1 || site.street || null,
      shipCity: input.shipCity || site.city || null,
      shipPostalCode: input.shipPostalCode || site.postalCode || null,
      subtotalAmount: calculation.subtotal,
      taxAmount: calculation.tax,
      totalAmount: calculation.total,
      withoutMarkupSubtotalAmount: calculation.withoutMarkupSubtotal,
      withoutMarkupTaxAmount: calculation.withoutMarkupTax,
      withoutMarkupTotalAmount: calculation.withoutMarkupTotal,
      version: before.version + 1,
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(and(eq(tjxQuotes.id, input.id), eq(tjxQuotes.version, input.version)))
    .returning()
  if (!updated) throw new ConflictError(`TJX quote ${input.id} changed since you loaded it.`)

  await tx.delete(tjxQuotePrices).where(eq(tjxQuotePrices.quoteId, input.id))
  if (priceRows.length) await tx.insert(tjxQuotePrices).values(priceRows)

  await tx.delete(tjxQuoteFixtures).where(eq(tjxQuoteFixtures.quoteId, input.id))
  await tx.delete(tjxQuoteRooms).where(eq(tjxQuoteRooms.quoteId, input.id))
  await tx.delete(tjxQuoteParts).where(eq(tjxQuoteParts.quoteId, input.id))
  await tx.delete(tjxQuoteSpecialParts).where(eq(tjxQuoteSpecialParts.quoteId, input.id))

  const roomIdByOrder = new Map<number, number>()
  if (rooms.length) {
    const insertedRooms = await tx
      .insert(tjxQuoteRooms)
      .values(
        rooms.map((room, index) => ({
          quoteId: input.id,
          roomId: room.roomId,
          roomName: room.roomName,
          sortOrder: index,
        })),
      )
      .returning({ id: tjxQuoteRooms.id, sortOrder: tjxQuoteRooms.sortOrder })
    for (const room of insertedRooms) roomIdByOrder.set(room.sortOrder, room.id)
  }

  const fixtureValues: Array<{
    quoteId: number
    quoteRoomId: number
    fixtureId: number | null
    fixtureName: string
    quantity: string
    sortOrder: number
  }> = []
  rooms.forEach((room, roomIndex) => {
    const quoteRoomId = roomIdByOrder.get(roomIndex)
    if (!quoteRoomId) throw new ValidationError('The quote room could not be saved.')
    room.fixtures.forEach((fixture, fixtureIndex) => {
      fixtureValues.push({
        quoteId: input.id,
        quoteRoomId,
        fixtureId: fixture.fixtureId,
        fixtureName: fixture.fixtureName,
        quantity: fixture.quantity,
        sortOrder: fixtureIndex,
      })
    })
  })

  if (fixtureValues.length) {
    const insertedFixtures = await tx
      .insert(tjxQuoteFixtures)
      .values(fixtureValues)
      .returning({
        id: tjxQuoteFixtures.id,
        quoteRoomId: tjxQuoteFixtures.quoteRoomId,
        sortOrder: tjxQuoteFixtures.sortOrder,
      })
    const fixtureIdByRoomAndOrder = new Map<string, number>()
    for (const fixture of insertedFixtures) {
      fixtureIdByRoomAndOrder.set(`${fixture.quoteRoomId}:${fixture.sortOrder}`, fixture.id)
    }

    const partValues: Array<{
      quoteFixtureId: number
      partNo: string
      partType: string
      markup: string
      ratioPerFixture: string
      sortOrder: number
    }> = []
    rooms.forEach((room, roomIndex) => {
      const quoteRoomId = roomIdByOrder.get(roomIndex)
      room.fixtures.forEach((fixture, fixtureIndex) => {
        const quoteFixtureId = fixtureIdByRoomAndOrder.get(`${quoteRoomId}:${fixtureIndex}`)
        if (!quoteFixtureId) throw new ValidationError('The quote fixture could not be saved.')
        fixture.parts.forEach((part, partIndex) => {
          partValues.push({
            quoteFixtureId,
            partNo: part.partNo,
            partType: part.partType,
            markup: part.markup,
            ratioPerFixture: part.ratioPerFixture,
            sortOrder: partIndex,
          })
        })
      })
    })
    if (partValues.length) await tx.insert(tjxQuoteFixtureParts).values(partValues)
  }

  if (calculation.parts.length) {
    await tx.insert(tjxQuoteParts).values(
      calculation.parts.map((part, index) => ({
        quoteId: input.id,
        partNo: part.partNo,
        description: part.description,
        qtyWithMarkup: part.qtyWithMarkup,
        qtyWithoutMarkup: part.qtyWithoutMarkup,
        unitPrice: part.unitPrice,
        lineSubtotal: part.lineWithMarkup,
        lineSubtotalWithoutMarkup: part.lineWithoutMarkup,
        sortOrder: index,
        origin: 'calculated',
      })),
    )
  }

  if (calculation.specialParts.length) {
    await tx.insert(tjxQuoteSpecialParts).values(
      calculation.specialParts.map((part, index) => ({
        quoteId: input.id,
        name: part.name,
        quantity: part.quantity,
        unitPrice: part.unitPrice,
        lineSubtotal: part.lineTotal,
        sortOrder: index,
      })),
    )
  }

  await writeRevision(tx, session, {
    quoteId: input.id,
    revisionNo: updated.revisionNo,
    revisionType: 'update',
    dataQuote: revisionQuoteData(updated),
    rooms,
    calculation,
    notes: input.revisionNotes,
  })

  await auditTjx(tx, session, 'tjx.quote.save', 'tjx_quote', input.id, {
    summary: `Saved TJX quote ${input.id}: ${calculation.total} with markup, ${calculation.withoutMarkupTotal} without.`,
    before: before as unknown as Record<string, unknown>,
    after: updated as unknown as Record<string, unknown>,
  })

  return getQuoteDetail(tx, input.id)
}

export { iso }
