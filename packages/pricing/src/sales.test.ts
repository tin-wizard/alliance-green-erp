import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { calculateSalesInvoice, type SalesInvoiceInput } from './sales'
import { calculateLocalInvoiceTotals, resolveLocalTaxProvince } from './local'
import { LEGACY_CENT_CORRECTION } from './sales'

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
  expected_stored: {
    labour: string
    material: string
    subtotal: string
    tax: string
    total: string
  }
}

function load<T>(file: string): { cases: T[] } {
  return JSON.parse(readFileSync(new URL(`../fixtures/${file}`, import.meta.url), 'utf8')) as {
    cases: T[]
  }
}

/**
 * The harness always posts at least one labour row because the legacy endpoint
 * aborts on an empty `date[]` array: `hhours[]=['0'], rrate[]=['0.00']` stands
 * in for "no labour" in the captured payloads. Mirror that here (A7).
 */
function toInput(raw: RawCase): SalesInvoiceInput {
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
    parts: partQty.map((qty, index) => ({
      partNo: `PART${index + 1}`,
      qty,
      price: partPrice[index] ?? '0.00',
    })),
    specialParts: soQty.map((qty, index) => ({
      name: 'Special part',
      qty,
      price: soPrice[index] ?? '0.00',
    })),
    manualTaxAmount: raw.input.fld_tax_amount ?? null,
    manualSubtotalAmount: raw.input.fld_subtotal_amount ?? null,
    workOrderId: raw.input.woidd ?? null,
  }
}

describe('sales-invoice fixture pack', () => {
  const { cases } = load<RawCase>('sales-invoice.json')

  test.each(cases)('sales-invoice / $id — $note', (raw) => {
    const totals = calculateSalesInvoice(toInput(raw))
    expect({
      labour: totals.labour,
      material: totals.material,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
    }).toEqual(raw.expected_stored)
  })
})

describe('project-wo fixture pack', () => {
  const { cases } = load<RawCase>('project-wo.json')

  test.each(cases)('project-wo / $id — $note', (raw) => {
    const totals = calculateSalesInvoice(toInput(raw))
    expect({
      labour: totals.labour,
      material: totals.material,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
    }).toEqual(raw.expected_stored)
  })
})

describe('local-wo fixture pack', () => {
  const { cases } = load<RawCase>('local-wo.json')

  test.each(cases)('local-wo / $id — $note', (raw) => {
    const totals = calculateSalesInvoice(toInput(raw))
    expect({
      labour: totals.labour,
      material: totals.material,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
    }).toEqual(raw.expected_stored)
  })

  test('local-wo / local-endpoint-accepts-province-but-submit-forces-on — submit boundary forces ON', () => {
    expect(resolveLocalTaxProvince('local', 'AB')).toBe('ON')
    expect(resolveLocalTaxProvince('local_project', 'AB')).toBe('AB')
    const forced = calculateLocalInvoiceTotals('local', {
      taxProvince: 'AB',
      labour: [{ hours: '2', rate: '100.00' }],
    })
    expect(forced.tax).toBe('26.00')
    expect(forced.total).toBe('226.00')
    expect(forced.calcType).toBe('local')
  })
})

describe('sales calculator contract', () => {
  test('A7 labour is mandatory: a missing labour array is rejected', () => {
    expect(() =>
      calculateSalesInvoice({
        taxProvince: 'ON',
        labour: [],
      }),
    ).toThrow(/Enter labour/)
  })

  test('A7 a zero-hour labour line is legal', () => {
    const totals = calculateSalesInvoice({
      taxProvince: 'ON',
      labour: [{ hours: '0', rate: '85.00' }],
    })
    expect(totals.subtotal).toBe('0.00')
    expect(totals.tax).toBe('0.00')
  })

  test('A4 override uses a numeric comparison, so 170 equals 170.00', () => {
    const totals = calculateSalesInvoice({
      taxProvince: 'ON',
      labour: [{ hours: '2', rate: '85.00' }],
      manualTaxAmount: '21.50',
      manualSubtotalAmount: '170',
    })
    expect(totals.appliedManualTax).toBe(true)
    expect(totals.tax).toBe('21.50')
  })

  test('appliedTaxRate replaces the table rate for the stored tax row', () => {
    const totals = calculateSalesInvoice({
      taxProvince: 'ON',
      labour: [{ hours: '2', rate: '85.00' }],
      appliedTaxRate: '0.05',
    })
    expect(totals.taxProvince).toBe('ON')
    expect(totals.tax).toBe('8.50')
    expect(totals.total).toBe('178.50')
  })

  test('WO 73850 correction can be switched off behind the named guard', () => {
    const input: SalesInvoiceInput = {
      taxProvince: 'ON',
      labour: [{ hours: '0', rate: '0.00' }],
      parts: [{ qty: '1', price: '102021.92' }],
      workOrderId: LEGACY_CENT_CORRECTION.workOrderId,
    }
    expect(calculateSalesInvoice(input).tax).toBe('13262.84')
    expect(
      calculateSalesInvoice({ ...input, applyLegacyCentCorrection: false }).tax,
    ).toBe('13262.85')
  })

  test('special-part quantities at or below -99999 are dropped', () => {
    const totals = calculateSalesInvoice({
      taxProvince: 'ON',
      labour: [{ hours: '1', rate: '100.00' }],
      specialParts: [{ name: 'Sentinel', qty: '-99999', price: '5.00' }],
    })
    expect(totals.material).toBe('0.00')
  })

  test('negative special parts above the sentinel are legal credit lines', () => {
    const totals = calculateSalesInvoice({
      taxProvince: 'ON',
      labour: [{ hours: '1', rate: '100.00' }],
      specialParts: [{ name: 'Credit', qty: '-1', price: '25.00' }],
    })
    expect(totals.material).toBe('-25.00')
    expect(totals.subtotal).toBe('75.00')
    expect(totals.tax).toBe('9.75')
  })
})
