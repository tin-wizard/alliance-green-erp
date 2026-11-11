import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { compare, parseDecimal, round, subtract } from './decimal'
import { calculateQuoteTotals, type QuoteInput, type QuoteTotals } from './quote'

interface QuoteCase {
  id: string
  input: QuoteInput
  expected: Partial<QuoteTotals> & {
    marginPercent?: string
    total?: string
  }
}

const { cases } = JSON.parse(
  readFileSync(new URL('../fixtures/quote.json', import.meta.url), 'utf8'),
) as { cases: QuoteCase[] }

describe('quote calculator fixtures', () => {
  test.each(cases)('$id', ({ input, expected }) => {
    const totals = calculateQuoteTotals(input)
    for (const [key, value] of Object.entries(expected)) {
      expect(totals[key as keyof QuoteTotals], `${key} in ${JSON.stringify(expected)}`).toBe(value)
    }
  })
})

describe('quote calculator contract', () => {
  test('incurred costs never enter the customer subtotal or tax', () => {
    const totals = calculateQuoteTotals({
      taxProvince: 'ON',
      labour: [{ hours: '1', rate: '100.00', incurredRate: '999.00' }],
    })
    expect(totals.subtotal).toBe('100.00')
    expect(totals.tax).toBe('13.00')
    expect(totals.incurredLabour).toBe('999.00')
    expect(totals.margin).toBe('-899.00')
  })

  test('manual tax is honoured without a posted subtotal match', () => {
    const totals = calculateQuoteTotals({
      taxProvince: 'ON',
      manualTaxAmount: '1.23',
      labour: [{ hours: '10', rate: '10.00' }],
    })
    expect(totals.appliedManualTax).toBe(true)
    expect(totals.tax).toBe('1.23')
    expect(totals.total).toBe('101.23')
  })

  test('a blank manual tax leaves the calculated tax in place', () => {
    const totals = calculateQuoteTotals({
      taxProvince: 'ON',
      manualTaxAmount: '',
      labour: [{ hours: '1', rate: '100.00' }],
    })
    expect(totals.appliedManualTax).toBe(false)
    expect(totals.tax).toBe('13.00')
  })

  test('margin percent rounds half away from zero and handles a zero subtotal', () => {
    const negative = calculateQuoteTotals({
      taxProvince: 'ON',
      labour: [{ hours: '1', rate: '100.00', incurredRate: '100.00' }],
      parts: [{ qty: '1', price: '0.00', costPrice: '25.00' }],
    })
    expect(negative.marginPercent).toBe('-25.00')
    expect(
      calculateQuoteTotals({ taxProvince: 'ON', parts: [{ qty: '0', price: '0.00' }] })
        .marginPercent,
    ).toBe('0.00')
  })

  test('special parts without a name are rejected', () => {
    expect(() =>
      calculateQuoteTotals({
        taxProvince: 'ON',
        specialParts: [{ name: '  ', qty: '1', price: '5.00' }],
      }),
    ).toThrow(/special part name/i)
  })

  test('per-line tax accumulation rounds each line', () => {
    // 0.0825 rounds to 0.08; tax 0.0104 rounds to 0.01 per line.
    const totals = calculateQuoteTotals({
      taxProvince: 'ON',
      labour: [
        { hours: '0.75', rate: '0.11' },
        { hours: '0.75', rate: '0.11' },
      ],
    })
    expect(totals.subtotal).toBe('0.16')
    expect(totals.tax).toBe('0.02')
  })

  test('decimal helpers used by the margin stay exact', () => {
    const margin = subtract(parseDecimal('100.00')!, parseDecimal('40.00')!)
    expect(compare(round(margin, 2), parseDecimal('60.00')!)).toBe(0)
  })
})
