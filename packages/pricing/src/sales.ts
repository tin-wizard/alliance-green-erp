/**
 * Sales-side invoice calculator — single source of truth for Work Orders and
 * Invoicing.
 *
 * Reproduces `app/ajaxCalcTotal.php` and `app/ajaxCalcTotalSubProjectWo.php`
 * cent for cent, including the parts of the legacy behaviour the rebuild
 * deliberately keeps because historical invoices contain the resulting values:
 *
 *  1. every line is rounded to 2dp before accumulation (A2);
 *  2. tax is accumulated line by line and the accumulator is re-rounded at
 *     every step (A3) — three 0.165 lines store 0.51 and 0.06, not 0.50 / 0.07;
 *  3. a manual tax amount wins only while the posted subtotal still matches the
 *     computed subtotal (A4);
 *  4. labour is mandatory; a zero-hour line is legal, a missing labour array is
 *     not (A7);
 *  5. negative part and special-part lines are legal (A8);
 *  6. special-part quantities at or below -99999 are treated as deleted (A17);
 *  7. project work order 73850's one-cent tax correction is reproduced behind
 *     `LEGACY_CENT_CORRECTION` and can be switched off once signed off.
 *
 * PURE. No database, no clock, no request. See BUSINESS-RULES A1-A8.
 */
import {
  add,
  compare,
  decimalEquals,
  format,
  multiply,
  parseDecimal,
  PricingError,
  requireDecimal,
  round,
  roundStep,
  type Decimal,
} from './decimal'
import { normalizeSalesProvince, salesTaxRate } from './tax'

export interface LabourLineInput {
  /** Hours for this line. A zero-hour line is legal. */
  hours: string | number
  /** Resolved hourly rate. `wo_hours.hourly_rate`. */
  rate: string | number
  date?: string | null
}

export interface PartLineInput {
  partNo?: string | null
  qty: string | number
  price: string | number
}

export interface SpecialPartLineInput {
  name?: string | null
  qty: string | number
  price: string | number
}

export interface SalesInvoiceInput {
  taxProvince?: string | null
  /**
   * `wo_tax.appliedtaxrate` override (BUSINESS-RULES A10). The legacy
   * calculator endpoint ignores it; the invoice read path applies it. Pass it
   * only when reading a stored invoice, never when reproducing the endpoint.
   */
  appliedTaxRate?: string | number | null
  labour: readonly LabourLineInput[]
  parts?: readonly PartLineInput[]
  specialParts?: readonly SpecialPartLineInput[]
  /** Operator-posted tax. Honoured only when `manualSubtotalAmount` matches. */
  manualTaxAmount?: string | number | null
  /** The subtotal that was on screen when the operator typed the tax. */
  manualSubtotalAmount?: string | number | null
  /** Needed for the historical WO 73850 correction. */
  workOrderId?: number | string | null
  /**
   * Historical one-cent correction for WO 73850
   * (`ajaxCalcTotalSubProjectWo.php:303-309`). Default on: live invoice data was
   * produced with it. Set false only after the human signs it off.
   */
  applyLegacyCentCorrection?: boolean
}

export interface SalesInvoiceTotals {
  labour: string
  material: string
  subtotal: string
  tax: string
  total: string
  taxProvince: string
  taxRate: string
  /** True when the operator's manual tax amount was used. */
  appliedManualTax: boolean
  /** True when the WO 73850 correction changed the tax by one cent. */
  legacyCentCorrectionApplied: boolean
}

export const LEGACY_CENT_CORRECTION = {
  workOrderId: 73850,
  accumulatedTax: '13262.85',
  correctedTax: '13262.84',
} as const

const HUNDREDTHS = 2

function requireAtMostTwoDecimals(value: Decimal, field: string): void {
  if (value.scale > HUNDREDTHS) {
    throw new PricingError(`Enter ${field} with at most 2 decimal places.`)
  }
}

/**
 * Calculate one invoice, exactly as the legacy endpoint does.
 * Throws `PricingError` for input the legacy screen would have rejected.
 */
export function calculateSalesInvoice(input: SalesInvoiceInput): SalesInvoiceTotals {
  if (!Array.isArray(input.labour) || input.labour.length === 0) {
    throw new PricingError('Enter labour before calculating.')
  }

  const province = salesTaxRate(input.taxProvince)
  const override = parseDecimal(input.appliedTaxRate)
  const taxRate = override ?? province.rate

  let labourTotal: Decimal = { value: 0n, scale: HUNDREDTHS }
  let partsTotal: Decimal = { value: 0n, scale: HUNDREDTHS }
  let specialPartsTotal: Decimal = { value: 0n, scale: HUNDREDTHS }
  let taxTotal: Decimal = { value: 0n, scale: HUNDREDTHS }

  for (const line of input.labour) {
    const hours = requireDecimal(line.hours, 'hours')
    const rate = requireDecimal(line.rate, 'rate')
    requireAtMostTwoDecimals(rate, 'rate')
    if (compare(rate, { value: 0n, scale: 0 }) < 0) {
      throw new PricingError('Enter a valid number for rate, maximum 2 decimal places number.')
    }
    const lineTotal = round(multiply(hours, rate), HUNDREDTHS)
    taxTotal = roundStep(add(taxTotal, multiply(lineTotal, taxRate)), HUNDREDTHS)
    labourTotal = add(labourTotal, lineTotal)
  }

  for (const line of input.parts ?? []) {
    const qty = requireDecimal(line.qty, 'part quantity')
    const price = requireDecimal(line.price, 'part price')
    requireAtMostTwoDecimals(price, 'part price')
    const lineTotal = round(multiply(qty, price), HUNDREDTHS)
    taxTotal = roundStep(add(taxTotal, multiply(lineTotal, taxRate)), HUNDREDTHS)
    partsTotal = add(partsTotal, lineTotal)
  }

  for (const line of input.specialParts ?? []) {
    const name = (line.name ?? '').trim()
    if (!name) throw new PricingError('Enter a value for special part name.')
    const qty = requireDecimal(line.qty, 'special part quantity')
    const price = requireDecimal(line.price, 'special part price')
    requireAtMostTwoDecimals(price, 'special part price')
    if (compare(qty, parseDecimal('-99999') ?? { value: -99999n, scale: 0 }) <= 0) {
      // Deleted / sentinel row: silently excluded, exactly like the legacy code.
      continue
    }
    const lineTotal = round(multiply(qty, price), HUNDREDTHS)
    taxTotal = roundStep(add(taxTotal, multiply(lineTotal, taxRate)), HUNDREDTHS)
    specialPartsTotal = add(specialPartsTotal, lineTotal)
  }

  const materialTotal = round(add(partsTotal, specialPartsTotal), HUNDREDTHS)
  const subtotal = round(add(add(labourTotal, partsTotal), specialPartsTotal), HUNDREDTHS)

  // Correction order matters: legacy adjusts the accumulated tax before the
  // manual override can replace it.
  let legacyCentCorrectionApplied = false
  const correctionEnabled = input.applyLegacyCentCorrection !== false
  if (
    correctionEnabled &&
    String(input.workOrderId ?? '') === String(LEGACY_CENT_CORRECTION.workOrderId) &&
    decimalEquals(LEGACY_CENT_CORRECTION.accumulatedTax, taxTotal)
  ) {
    taxTotal = parseDecimal(LEGACY_CENT_CORRECTION.correctedTax) ?? taxTotal
    legacyCentCorrectionApplied = true
  }

  let appliedManualTax = false
  const manualTax = parseDecimal(input.manualTaxAmount)
  const manualSubtotal = parseDecimal(input.manualSubtotalAmount)
  // PHP loose comparison: a stale or blank subtotal clears the override (A4).
  const subtotalMatches = manualSubtotal !== null && compare(manualSubtotal, subtotal) === 0
  if (manualTax !== null && subtotalMatches) {
    taxTotal = round(manualTax, HUNDREDTHS)
    appliedManualTax = true
  }

  return {
    labour: format(labourTotal, HUNDREDTHS),
    material: format(materialTotal, HUNDREDTHS),
    subtotal: format(subtotal, HUNDREDTHS),
    tax: format(taxTotal, HUNDREDTHS),
    total: format(add(subtotal, taxTotal), HUNDREDTHS),
    taxProvince: normalizeSalesProvince(input.taxProvince),
    taxRate: format(taxRate, 5).replace(/0+$/, '').replace(/\.$/, ''),
    appliedManualTax,
    legacyCentCorrectionApplied,
  }
}

/** Project and local-project work orders use the same rules plus the correction. */
export function calculateProjectWorkOrderTotals(
  input: SalesInvoiceInput,
): SalesInvoiceTotals {
  return calculateSalesInvoice(input)
}
