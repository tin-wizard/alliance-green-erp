import { describe, expect, test } from 'vitest'
import {
  countPdfPages,
  renderDocument,
  tjxOrderSheetDocumentDataSchema,
  tjxQuoteDocumentDataSchema,
  type TjxOrderSheetDocumentData,
  type TjxQuoteDocumentData,
} from './index'

const ADDRESS = {
  name: 'TJX Customer',
  street: '1 Program Way',
  city: 'Toronto',
  province: 'ON',
  postalCode: 'M5V 1A1',
}

function customerFixture(): TjxQuoteDocumentData {
  return {
    schemaVersion: 1,
    kind: 'tjx-quote',
    number: 'TJX-42',
    revision: '2',
    issuedOn: '2026-11-11',
    dueDate: '2026-12-01',
    customer: ADDRESS,
    shipTo: ADDRESS,
    quoteType: 'Gen 1',
    gridType: 'B',
    paymentTerms: '30 Days',
    rooms: [
      {
        name: 'Sales floor',
        fixtures: [{ name: 'Highbay 2-lamp', quantity: '4.000' }],
      },
    ],
    lines: [
      {
        position: 1,
        partNumber: 'WIN-100',
        description: 'LED lamp',
        quantity: '6.000',
        unitPrice: '10.00',
        lineTotal: '60.00',
      },
    ],
    specialParts: [
      {
        position: 1,
        description: 'Freight',
        quantity: '1.000',
        unitPrice: '5.00',
        lineTotal: '5.00',
      },
    ],
    totals: {
      subtotal: '65.00',
      taxLabel: 'Tax (ON)',
      tax: '8.45',
      total: '73.45',
    },
    notes: ['Customer copy — with markup only.'],
  }
}

function orderSheetFixture(): TjxOrderSheetDocumentData {
  const quote = customerFixture()
  return {
    schemaVersion: 1,
    kind: 'tjx-order-sheet',
    number: quote.number,
    revision: quote.revision,
    issuedOn: quote.issuedOn,
    dueDate: quote.dueDate,
    customer: quote.customer,
    shipTo: quote.shipTo,
    quoteType: quote.quoteType,
    gridType: quote.gridType,
    paymentTerms: quote.paymentTerms,
    rooms: quote.rooms,
    lines: [
      {
        position: 1,
        partNumber: 'WIN-100',
        description: 'LED lamp',
        qtyWithMarkup: '6.000',
        qtyWithoutMarkup: '4.000',
        unitPrice: '10.00',
        lineWithMarkup: '60.00',
        lineWithoutMarkup: '40.00',
      },
    ],
    specialParts: quote.specialParts,
    totals: {
      withMarkup: quote.totals,
      withoutMarkup: {
        subtotal: '45.00',
        taxLabel: 'Tax (ON)',
        tax: '5.85',
        total: '50.85',
      },
    },
    workOrders: ['WO-100'],
    notes: ['Internal only.'],
  }
}

describe('TJX PDF DTOs', () => {
  test('accepts a customer quote and an internal order sheet', () => {
    expect(tjxQuoteDocumentDataSchema.parse(customerFixture()).kind).toBe('tjx-quote')
    expect(tjxOrderSheetDocumentDataSchema.parse(orderSheetFixture()).kind).toBe(
      'tjx-order-sheet',
    )
  })

  test('the customer schema rejects the internal order-sheet DTO', () => {
    const result = tjxQuoteDocumentDataSchema.safeParse(orderSheetFixture())
    expect(result.success).toBe(false)
  })

  test('rejects a quote with no lines', () => {
    const result = tjxQuoteDocumentDataSchema.safeParse({
      ...customerFixture(),
      lines: [],
      specialParts: [],
    })
    expect(result.success).toBe(false)
  })

  test('rejects a malformed quantity', () => {
    const fixture = customerFixture()
    const result = tjxQuoteDocumentDataSchema.safeParse({
      ...fixture,
      lines: [{ ...fixture.lines[0]!, quantity: 'six' }],
    })
    expect(result.success).toBe(false)
  })
})

describe('TJX PDF rendering', () => {
  test('renders the customer quote to Letter PDF bytes', async () => {
    const buffer = await renderDocument('tjx-quote', customerFixture())
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
    expect(countPdfPages(buffer)).toBeGreaterThanOrEqual(1)
    expect(buffer.toString('latin1')).toMatch(
      /\/MediaBox\s*\[\s*0\s+0\s+612\s+792\s*\]/,
    )
  })

  test('renders the internal order sheet to Letter PDF bytes', async () => {
    const buffer = await renderDocument('tjx-order-sheet', orderSheetFixture())
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
    expect(countPdfPages(buffer)).toBeGreaterThanOrEqual(1)
  })

  test('is deterministic for the same snapshot', async () => {
    const first = await renderDocument('tjx-quote', customerFixture())
    const second = await renderDocument('tjx-quote', customerFixture())
    expect(first.equals(second)).toBe(true)
  })

  test('a DTO of the wrong kind is rejected before rendering', async () => {
    await expect(
      renderDocument('tjx-quote' as never, { kind: 'tjx-order-sheet' } as never),
    ).rejects.toThrow()
  })
})
