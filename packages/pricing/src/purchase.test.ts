import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  calculateSubcontractorPurchaseTotals,
  type SubcontractorPurchaseInput,
} from './purchase'

interface RawCase {
  id: string
  note: string
  wo_tax_name: string
  wo_tax_appliedtaxrate: string
  wo_hours: Array<{
    date: string
    hours: string
    rate: number
    hourly_rate: string | null
  }>
  wo_parts: Array<{ partno: string; qty: string; price: string }>
  wo_soparts: Array<{ name: string; qty: string; price: string }>
  expected_stored: { tax: string; subtotal: string; total: number }
}

function load(): RawCase[] {
  const parsed = JSON.parse(
    readFileSync(new URL('../fixtures/subcontractor-invoice.json', import.meta.url), 'utf8'),
  ) as { cases: RawCase[] }
  return parsed.cases
}

function toInput(raw: RawCase): SubcontractorPurchaseInput {
  return {
    taxProvince: raw.wo_tax_name,
    appliedTaxRate: raw.wo_tax_appliedtaxrate,
    invoiceDate: raw.wo_hours.map((line) => line.date).sort()[0] ?? null,
    labour: raw.wo_hours.map((line) => ({
      date: line.date,
      hours: line.hours,
      rateCode: line.rate,
      hourlyRate: line.hourly_rate,
    })),
    parts: raw.wo_parts.map((line) => ({
      partNo: line.partno,
      qty: line.qty,
      price: line.price,
    })),
    specialParts: raw.wo_soparts.map((line) => ({
      name: line.name,
      qty: line.qty,
      price: line.price,
    })),
  }
}

describe('subcontractor-invoice fixture pack', () => {
  const cases = load()

  test.each(cases)('subcontractor-invoice / $id — $note', (raw) => {
    const totals = calculateSubcontractorPurchaseTotals(toInput(raw))
    expect(totals).not.toBeNull()
    expect({
      tax: totals?.tax,
      subtotal: totals?.subtotal,
      total: totals?.total,
    }).toEqual({
      tax: raw.expected_stored.tax,
      subtotal: raw.expected_stored.subtotal,
      total: Number(raw.expected_stored.total).toFixed(2),
    })
  })
})

describe('subcontractor purchase contract', () => {
  test('A13 tax is one rounding of the subtotal, not per-line accumulation', () => {
    const totals = calculateSubcontractorPurchaseTotals({
      taxProvince: 'ON',
      labour: [{ hours: '0.75', rateCode: 1, hourlyRate: '0.11' }],
      parts: [{ qty: '0.75', price: '0.11' }],
    })
    // 0.08 + 0.08 = 0.16 subtotal; 0.16 * 0.13 = 0.0208 -> 0.02
    expect(totals?.subtotal).toBe('0.16')
    expect(totals?.tax).toBe('0.02')
  })

  test('A18 a non-positive total returns null (legacy "not invoiced")', () => {
    expect(
      calculateSubcontractorPurchaseTotals({
        taxProvince: 'ON',
        labour: [],
        parts: [],
        specialParts: [],
      }),
    ).toBeNull()
  })

  test('MB picks 13% before 2019-07-01 and 12% on or after', () => {
    const before = calculateSubcontractorPurchaseTotals({
      taxProvince: 'MB',
      labour: [{ date: '2019-06-30', hours: '1', hourlyRate: '100.00' }],
    })
    const after = calculateSubcontractorPurchaseTotals({
      taxProvince: 'MB',
      labour: [{ date: '2019-07-01', hours: '1', hourlyRate: '100.00' }],
    })
    expect(before?.taxRate).toBe('0.13')
    expect(after?.taxRate).toBe('0.12')
  })
})
