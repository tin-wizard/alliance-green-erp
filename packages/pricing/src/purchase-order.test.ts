import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  calculatePurchaseOrderTotals,
  type PurchaseOrderInput,
} from './purchase-order'

interface RawCase {
  id: string
  note: string
  taxProvince: string
  appliedTaxRate?: string
  parts: Array<{ qty: string; price: string }>
  specialParts?: Array<{ name: string; qty: string; price: string }>
  expected: { subtotal: string; tax: string; total: string }
}

function load(): RawCase[] {
  const parsed = JSON.parse(
    readFileSync(new URL('../fixtures/purchase-order.json', import.meta.url), 'utf8'),
  ) as { cases: RawCase[] }
  return parsed.cases
}

function toInput(raw: RawCase): PurchaseOrderInput {
  return {
    taxProvince: raw.taxProvince,
    appliedTaxRate: raw.appliedTaxRate,
    parts: raw.parts,
    specialParts: raw.specialParts ?? [],
  }
}

describe('purchase-order fixtures', () => {
  const cases = load()

  test.each(cases)('purchase-order / $id — $note', (raw) => {
    const totals = calculatePurchaseOrderTotals(toInput(raw))
    expect(totals.subtotal).toBe(raw.expected.subtotal)
    expect(totals.tax).toBe(raw.expected.tax)
    expect(totals.total).toBe(raw.expected.total)
  })

  test('uses the purchase table rather than the sales table for BC', () => {
    const totals = calculatePurchaseOrderTotals({
      taxProvince: 'BC',
      parts: [{ qty: '1', price: '100.00' }],
    })
    expect(totals.tax).toBe('12.00')
    expect(totals.taxRate).toBe('0.12')
    expect(totals.pstRate).toBe('0.07')
  })

  test('is deterministic and does not mutate the input', () => {
    const input = { taxProvince: 'ON', parts: [{ qty: '2', price: '5.00' }] }
    const first = calculatePurchaseOrderTotals(input)
    const second = calculatePurchaseOrderTotals(input)
    expect(first).toEqual(second)
    expect(input.parts[0]).toEqual({ qty: '2', price: '5.00' })
  })
})
