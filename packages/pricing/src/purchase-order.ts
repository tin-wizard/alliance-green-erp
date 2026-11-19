/**
 * Purchase-order totals — the supplier-purchase rule set.
 *
 * This is deliberately NOT the subcontractor purchase calculator:
 *  - PO lines are parts and special parts only, no labour;
 *  - each line total is rounded to 2dp before accumulation;
 *  - tax is accumulated per line and rounded after each addition, matching the
 *    mechanics of `ajaxCalcPurchaseOrder.php`;
 *  - the rate comes from `purchaseTaxRate` (the purchase table), not the
 *    sales-style table the legacy PO screen used for BC/MB/QC/SK.
 *
 * The tax table and decimal helpers are shared with the rest of `@cls/pricing`;
 * this function adds no rates and no second rounding implementation.
 */
import {
  add,
  compare,
  format,
  multiply,
  parseDecimal,
  round,
  type Decimal,
} from './decimal'
import { purchaseTaxRate } from './tax'

export interface PurchaseOrderPartLineInput {
  partNo?: string | null
  qty: string | number
  price: string | number
}

export interface PurchaseOrderSpecialPartLineInput {
  name?: string | null
  qty: string | number
  price: string | number
}

export interface PurchaseOrderInput {
  taxProvince?: string | null
  appliedTaxRate?: string | number | null
  appliedTaxRatePst?: string | number | null
  parts?: readonly PurchaseOrderPartLineInput[]
  specialParts?: readonly PurchaseOrderSpecialPartLineInput[]
}

export interface PurchaseOrderTotals {
  material: string
  specialMaterial: string
  subtotal: string
  tax: string
  total: string
  taxProvince: string
  taxRate: string
  pstRate: string | null
}

const HUNDREDTHS = 2
const ZERO: Decimal = { value: 0n, scale: HUNDREDTHS }

function decimal(value: string | number, label: string): Decimal {
  const parsed = parseDecimal(value)
  if (!parsed) throw new Error(`${label} must be a decimal number.`)
  return parsed
}

export function calculatePurchaseOrderTotals(input: PurchaseOrderInput): PurchaseOrderTotals {
  const tableRate = purchaseTaxRate(input.taxProvince, null)
  const override = parseDecimal(input.appliedTaxRate)
  const taxRate = override ?? tableRate.rate
  const pstOverride = parseDecimal(input.appliedTaxRatePst)
  const pstRate = pstOverride ?? tableRate.pst ?? null

  let material: Decimal = ZERO
  let specialMaterial: Decimal = ZERO
  let tax: Decimal = ZERO

  const accumulate = (qty: Decimal, price: Decimal, target: 'part' | 'special') => {
    const lineTotal = round(multiply(qty, price), HUNDREDTHS)
    if (target === 'part') material = add(material, lineTotal)
    else specialMaterial = add(specialMaterial, lineTotal)
    tax = round(add(tax, round(multiply(lineTotal, taxRate), HUNDREDTHS)), HUNDREDTHS)
  }

  for (const line of input.parts ?? []) {
    accumulate(
      decimal(line.qty, 'part quantity'),
      decimal(line.price, 'part price'),
      'part',
    )
  }

  for (const line of input.specialParts ?? []) {
    const name = (line.name ?? '').trim()
    if (!name) continue
    const qty = decimal(line.qty, 'special part quantity')
    // Legacy sentinel: a special line at or below -99999 is not counted.
    if (compare(qty, parseDecimal('-99999') ?? { value: -99999n, scale: 0 }) <= 0) continue
    accumulate(qty, decimal(line.price, 'special part price'), 'special')
  }

  const subtotal = round(add(material, specialMaterial), HUNDREDTHS)
  const total = round(add(subtotal, tax), HUNDREDTHS)

  return {
    material: format(material, HUNDREDTHS),
    specialMaterial: format(specialMaterial, HUNDREDTHS),
    subtotal: format(subtotal, HUNDREDTHS),
    tax: format(tax, HUNDREDTHS),
    total: format(total, HUNDREDTHS),
    taxProvince: (input.taxProvince ?? '').trim().toUpperCase() || 'ON',
    taxRate: format(taxRate, 5).replace(/0+$/, '').replace(/\.$/, ''),
    pstRate: pstRate ? format(pstRate, 5).replace(/0+$/, '').replace(/\.$/, '') : null,
  }
}
