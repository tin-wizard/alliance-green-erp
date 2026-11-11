/**
 * Subcontractor purchase-invoice calculator — a different rule set.
 *
 * This is NOT a variant of the sales calculator. It reproduces
 * `get_sub_purchase_invoice_totals()` (`app/config/functions.php:4167`) and the
 * differences are load-bearing (BUSINESS-RULES A12-A16):
 *
 *  - province rates are BC 12/7, MB 13/8 before July 2019 and 12/7 after,
 *    QC 14.975/9.975, SK 11/6; `appliedtaxrate` overrides the province;
 *  - labour is counted only when `hourly_rate > 0`; a rate-code line without an
 *    hourly rate contributes zero (the legacy `$rate1/$rate2/$rate3` are out of
 *    scope in the function);
 *  - parts only count when `qty > 0`; special parts count whenever their
 *    description is non-empty;
 *  - the returned tax is a single rounding of the subtotal, discarding the
 *    per-line accumulation the function performed first (A13);
 *  - a non-positive total returns null, which legacy callers read as
 *    "not invoiced" (A18).
 *
 * PURE. Keep it exported separately; do not fold it into `calculateSalesInvoice`.
 */
import {
  add,
  compare,
  format,
  multiply,
  parseDecimal,
  requireDecimal,
  round,
  type Decimal,
} from './decimal'
import { purchaseTaxRate } from './tax'

export interface PurchaseLabourLineInput {
  /** Report date; the earliest one selects the Manitoba rate. */
  date?: string | null
  hours: string | number
  /** Legacy `wo_hours.rate` code (1/2/3). Kept for diagnostics. */
  rateCode?: number | null
  /** Legacy `wo_hours.hourly_rate`. Labour is counted only when this is > 0. */
  hourlyRate?: string | number | null
}

export interface PurchasePartLineInput {
  partNo?: string | null
  qty: string | number
  price: string | number
}

export interface PurchaseSpecialPartLineInput {
  name?: string | null
  qty: string | number
  price: string | number
}

export interface SubcontractorPurchaseInput {
  /** `wo_tax.name` province code. */
  taxProvince?: string | null
  /** `wo_tax.appliedtaxrate`; overrides the province table when non-blank. */
  appliedTaxRate?: string | number | null
  /** `wo_tax.appliedtaxrate_pst`; display/reporting only. */
  appliedTaxRatePst?: string | number | null
  /** Earliest `wo_hours.date`; drives the Manitoba rate. */
  invoiceDate?: string | null
  labour: readonly PurchaseLabourLineInput[]
  parts?: readonly PurchasePartLineInput[]
  specialParts?: readonly PurchaseSpecialPartLineInput[]
}

export interface SubcontractorPurchaseTotals {
  labour: string
  material: string
  subtotal: string
  tax: string
  total: string
  taxProvince: string
  taxRate: string
  pstRate: string | null
  /** False when the legacy function would have returned NULL. */
  payable: boolean
}

const HUNDREDTHS = 2
const ZERO: Decimal = { value: 0n, scale: HUNDREDTHS }

function earliestDate(dates: readonly (string | null | undefined)[]): string | null {
  const valid = dates
    .map((date) => (date ?? '').trim())
    .filter((date) => /^\d{4}-\d{2}-\d{2}/.test(date))
    .sort()
  return valid[0] ?? null
}

export function calculateSubcontractorPurchaseTotals(
  input: SubcontractorPurchaseInput,
): SubcontractorPurchaseTotals | null {
  const invoiceDate = input.invoiceDate ?? earliestDate(input.labour.map((line) => line.date))

  const tableRate = purchaseTaxRate(input.taxProvince, invoiceDate)
  const override = parseDecimal(input.appliedTaxRate)
  const taxRate = override ?? tableRate.rate
  const pstOverride = parseDecimal(input.appliedTaxRatePst)
  const pstRate = pstOverride ?? tableRate.pst ?? null

  let labourTotal: Decimal = ZERO
  let partsTotal: Decimal = ZERO

  for (const line of input.labour) {
    const hours = round(requireDecimal(line.hours, 'hours'), HUNDREDTHS)
    // The rate code branch reads variables that are not in scope in the legacy
    // function, so a code without an explicit hourly rate resolves to zero and
    // the line is skipped.
    const hourly = parseDecimal(line.hourlyRate)
    if (hourly === null || compare(hourly, { value: 0n, scale: 0 }) <= 0) continue
    const rate = round(hourly, HUNDREDTHS)
    const lineTotal = round(multiply(hours, rate), HUNDREDTHS)
    labourTotal = add(labourTotal, lineTotal)
  }

  for (const line of input.parts ?? []) {
    const qty = requireDecimal(line.qty, 'part quantity')
    if (compare(qty, { value: 0n, scale: 0 }) <= 0) continue
    const price = requireDecimal(line.price, 'part price')
    partsTotal = add(partsTotal, round(multiply(qty, price), HUNDREDTHS))
  }

  for (const line of input.specialParts ?? []) {
    const name = (line.name ?? '').trim()
    if (!name) continue
    const qty = requireDecimal(line.qty, 'special part quantity')
    const price = requireDecimal(line.price, 'special part price')
    partsTotal = add(partsTotal, round(multiply(qty, price), HUNDREDTHS))
  }

  const subtotal = round(add(labourTotal, partsTotal), HUNDREDTHS)
  // A13: the legacy code overwrites its per-line tax accumulation with one
  // rounding of the subtotal. Reproduce the shipped number, not the intent.
  const tax = round(multiply(subtotal, taxRate), HUNDREDTHS)
  const total = round(add(subtotal, tax), HUNDREDTHS)

  if (compare(total, { value: 0n, scale: 0 }) <= 0) return null

  return {
    labour: format(labourTotal, HUNDREDTHS),
    material: format(partsTotal, HUNDREDTHS),
    subtotal: format(subtotal, HUNDREDTHS),
    tax: format(tax, HUNDREDTHS),
    total: format(total, HUNDREDTHS),
    taxProvince: (input.taxProvince ?? '').trim().toUpperCase() || 'ON',
    taxRate: format(taxRate, 5).replace(/0+$/, '').replace(/\.$/, ''),
    pstRate: pstRate ? format(pstRate, 5).replace(/0+$/, '').replace(/\.$/, '') : null,
    payable: true,
  }
}
