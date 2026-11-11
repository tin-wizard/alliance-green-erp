import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { calculateTjxQuote, type TjxQuoteInput } from './tjx'

interface RawPart {
  partNo: string
  markup: string
  ratioPerFixture: string
  description?: string | null
}

interface RawFixture {
  quantity: string
  parts: RawPart[]
}

interface RawSpecialPart {
  name: string
  quantity: string
  unitPrice: string
}

interface ExpectedPart {
  partNo: string
  qtyWithMarkup: string
  qtyWithoutMarkup: string
  unitPrice: string
  lineWithMarkup: string
  lineWithoutMarkup: string
  taxWithMarkup: string
  taxWithoutMarkup: string
}

interface ExpectedSpecialPart {
  name: string
  quantity: string
  unitPrice: string
  lineTotal: string
  tax: string
}

interface RawCase {
  id: string
  note: string
  input: TjxQuoteInput & { fixtures: RawFixture[]; specialParts?: RawSpecialPart[] }
  expected?: {
    parts: ExpectedPart[]
    specialParts?: ExpectedSpecialPart[]
    subtotal: string
    tax: string
    total: string
    withoutMarkupSubtotal: string
    withoutMarkupTax: string
    withoutMarkupTotal: string
  }
  expectedError?: string
}

function load(): RawCase[] {
  const parsed = JSON.parse(
    readFileSync(new URL('../fixtures/tjx-quote.json', import.meta.url), 'utf8'),
  ) as { cases: RawCase[] }
  return parsed.cases
}

function expectFields(actual: object, expected: object, label: string) {
  for (const [key, value] of Object.entries(expected)) {
    expect((actual as Record<string, unknown>)[key], `${label}.${key}`).toBe(value)
  }
}

describe('TJX two-triplet fixtures', () => {
  const cases = load()

  test('the pack carries all eighteen cases', () => {
    expect(cases).toHaveLength(18)
  })

  test.each(cases)('$id — $note', (raw) => {
    if (raw.expectedError) {
      expect(() => calculateTjxQuote(raw.input)).toThrow(raw.expectedError)
      return
    }

    const expected = raw.expected!
    const result = calculateTjxQuote(raw.input)

    expect(result.parts).toHaveLength(expected.parts.length)
    expected.parts.forEach((part, index) => {
      expectFields(result.parts[index]!, part, `${raw.id}.parts[${index}]`)
    })

    const expectedSpecials = expected.specialParts ?? []
    expect(result.specialParts).toHaveLength(expectedSpecials.length)
    expectedSpecials.forEach((part, index) => {
      expectFields(result.specialParts[index]!, part, `${raw.id}.specialParts[${index}]`)
    })

    expect(result.subtotal).toBe(expected.subtotal)
    expect(result.tax).toBe(expected.tax)
    expect(result.total).toBe(expected.total)
    expect(result.withoutMarkupSubtotal).toBe(expected.withoutMarkupSubtotal)
    expect(result.withoutMarkupTax).toBe(expected.withoutMarkupTax)
    expect(result.withoutMarkupTotal).toBe(expected.withoutMarkupTotal)
  })
})

describe('TJX calculator contract', () => {
  test('WIN-150 is the only part that skips the fixture ceiling', () => {
    const result = calculateTjxQuote({
      taxRate: '0.13',
      fixtures: [
        {
          quantity: '2',
          parts: [{ partNo: 'WIN-150', markup: '1.5', ratioPerFixture: '1.5' }],
        },
      ],
      prices: { 'WIN-150': '100.00' },
    })

    expect(result.parts[0]!.qtyWithMarkup).toBe('5.000')
    expect(result.parts[0]!.qtyWithoutMarkup).toBe('4.500')
  })

  test('aggregates raw quantities before the single ceiling', () => {
    const result = calculateTjxQuote({
      taxRate: '0.13',
      fixtures: [
        { quantity: '1', parts: [{ partNo: 'WIN-300', markup: '1', ratioPerFixture: '1.25' }] },
        { quantity: '1', parts: [{ partNo: 'WIN-300', markup: '1', ratioPerFixture: '1.25' }] },
      ],
      prices: { 'WIN-300': '10.00' },
    })

    expect(result.parts[0]!.qtyWithMarkup).toBe('3.000')
    expect(result.parts[0]!.qtyWithoutMarkup).toBe('2.500')
  })

  test('rounds tax per line, not on the subtotal', () => {
    const result = calculateTjxQuote({
      taxRate: '0.13',
      fixtures: [
        { quantity: '1', parts: [{ partNo: 'WIN-801', markup: '1', ratioPerFixture: '1' }] },
        { quantity: '1', parts: [{ partNo: 'WIN-802', markup: '1', ratioPerFixture: '1' }] },
      ],
      prices: { 'WIN-801': '0.05', 'WIN-802': '0.05' },
    })

    expect(result.subtotal).toBe('0.10')
    expect(result.tax).toBe('0.02')
  })

  test('missing price fails and names the part', () => {
    expect(() =>
      calculateTjxQuote({
        taxRate: '0.13',
        fixtures: [
          { quantity: '1', parts: [{ partNo: 'WIN-999', markup: '1', ratioPerFixture: '1' }] },
        ],
        prices: {},
      }),
    ).toThrow(/WIN-999/)
  })

  test('zero markup fails and names the part', () => {
    expect(() =>
      calculateTjxQuote({
        taxRate: '0.13',
        fixtures: [
          { quantity: '1', parts: [{ partNo: 'WIN-950', markup: '0', ratioPerFixture: '1' }] },
        ],
        prices: { 'WIN-950': '10.00' },
      }),
    ).toThrow(/WIN-950/)
  })

  test('sorts parts by canonical part number regardless of input order', () => {
    const input: TjxQuoteInput = {
      taxRate: '0.13',
      fixtures: [
        {
          quantity: '1',
          parts: [
            { partNo: 'win-20', markup: '1', ratioPerFixture: '1' },
            { partNo: 'WIN-10', markup: '1', ratioPerFixture: '1' },
          ],
        },
      ],
      prices: { 'WIN-10': '1.00', 'WIN-20': '2.00' },
    }
    const reversed: TjxQuoteInput = {
      ...input,
      fixtures: [
        {
          quantity: '1',
          parts: [
            { partNo: 'WIN-10', markup: '1', ratioPerFixture: '1' },
            { partNo: 'win-20', markup: '1', ratioPerFixture: '1' },
          ],
        },
      ],
    }

    const first = calculateTjxQuote(input)
    expect(first.parts.map((part) => part.partNo)).toEqual(['WIN-10', 'WIN-20'])
    expect(calculateTjxQuote(reversed)).toEqual(first)
    expect(input.fixtures[0]!.parts[0]!.partNo).toBe('win-20')
  })

  test('a special-parts-only quote returns equal triplets', () => {
    const result = calculateTjxQuote({
      taxRate: '0.13',
      fixtures: [],
      specialParts: [{ name: 'Credit', quantity: '1', unitPrice: '100.00' }],
      prices: {},
    })

    expect(result.parts).toEqual([])
    expect(result.subtotal).toBe(result.withoutMarkupSubtotal)
    expect(result.tax).toBe(result.withoutMarkupTax)
    expect(result.total).toBe(result.withoutMarkupTotal)
    expect(result.total).toBe('113.00')
  })

  test('a five-decimal rate rounds half away from zero', () => {
    const result = calculateTjxQuote({
      taxRate: '0.14975',
      fixtures: [
        { quantity: '1', parts: [{ partNo: 'WIN-1200', markup: '1', ratioPerFixture: '1' }] },
      ],
      prices: { 'WIN-1200': '100.00' },
    })

    expect(result.tax).toBe('14.98')
  })
})
