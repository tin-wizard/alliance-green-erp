import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { lineAmount, previewInvoiceTotals, type InvoiceMoneyInput } from './money'

interface RawCase {
  id: string
  note: string
  taxprov: string
  input: {
    hhours?: string[]
    rrate?: string[]
    part_qty?: string[]
    part_price?: string[]
    qty?: string[]
    price?: string[]
    so_qty?: string[]
    so_price?: string[]
    soqty?: string[]
    soprice?: string[]
    fld_tax_amount?: string | null
    fld_subtotal_amount?: string | null
    woidd?: string
  }
  expected_stored: { labour: string; material: string; subtotal: string; tax: string; total: string }
}

function cases(): RawCase[] {
  const file = new URL(
    '../../../../../../packages/pricing/fixtures/sales-invoice.json',
    import.meta.url,
  )
  return (JSON.parse(readFileSync(file, 'utf8')) as { cases: RawCase[] }).cases
}

/**
 * Same harness as the pricing pack: legacy posts one zero labour row when the
 * payload has no labour, so the module parity path does the same (A7).
 */
function toInput(raw: RawCase): InvoiceMoneyInput {
  const hours = raw.input.hhours ?? []
  const rates = raw.input.rrate ?? []
  const labour =
    hours.length === 0
      ? [{ date: '2026-01-01', hours: '0', rate: '0.00' }]
      : hours.map((value, index) => ({
          date: '2026-01-01',
          hours: value,
          rate: rates[index] ?? '0.00',
        }))
  const partQty = raw.input.part_qty ?? raw.input.qty ?? []
  const partPrice = raw.input.part_price ?? raw.input.price ?? []
  const soQty = raw.input.so_qty ?? raw.input.soqty ?? []
  const soPrice = raw.input.so_price ?? raw.input.soprice ?? []
  return {
    taxProvince: raw.taxprov,
    labour,
    parts: partQty.map((qty, index) => ({ partNo: `PART${index + 1}`, qty, price: partPrice[index] ?? '0.00' })),
    specialParts: soQty.map((qty, index) => ({ name: 'Special part', qty, price: soPrice[index] ?? '0.00' })),
    manualTaxAmount: raw.input.fld_tax_amount ?? null,
    manualSubtotalAmount: raw.input.fld_subtotal_amount ?? null,
    workOrderId: raw.input.woidd ?? null,
  }
}

describe('invoice money path — sales fixture parity', () => {
  const all = cases()

  test('covers all 28 captured sales invoices', () => {
    expect(all).toHaveLength(28)
  })

  test.each(all)('sales-invoice / $id — $note', (raw) => {
    const totals = previewInvoiceTotals(toInput(raw))
    expect({
      labour: totals.labour,
      material: totals.material,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
    }).toEqual(raw.expected_stored)
  })

  test('line amounts round per line before accumulation', () => {
    expect(lineAmount('1.005', '1.00')).toBe('1.01')
    expect(lineAmount('3', '0.335')).toBe('1.01')
  })
})
