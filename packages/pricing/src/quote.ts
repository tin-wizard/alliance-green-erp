import {
  add,
  compare,
  format,
  multiply,
  parseDecimal,
  PricingError,
  requireDecimal,
  round,
  roundStep,
  subtract,
  type Decimal,
} from './decimal'
import { normalizeSalesProvince, salesTaxRate } from './tax'

/**
 * Quote calculator.
 *
 * Quotes share the invoice rounding rules for sell lines but differ in three
 * deliberate ways, all confirmed from `app/ajaxQuoteCalcTotal.php` and
 * `customer_quote_pdf.php`:
 *
 *  1. a labour line carries `numTechs`; labour is hours × techs × rate;
 *  2. incurred cost lines are a parallel margin basis and never enter the
 *     customer subtotal or tax (the PDF sums sell lines only);
 *  3. a manual tax amount is honoured as typed, without requiring the posted
 *     subtotal to match (the legacy PDF prints `tax_amount` when non-empty).
 *
 * It is a separate entry point, not a fork: every decimal/rounding helper is
 * shared with `calculateSalesInvoice`.
 */
export interface QuoteLabourLineInput {
  hours: string | number
  /** Defaults to 1. Legacy staging allowed 2+ techs on one line. */
  numTechs?: string | number | null
  rate: string | number
  incurredHours?: string | number | null
  incurredRate?: string | number | null
}

export interface QuotePartLineInput {
  partNo?: string | null
  qty: string | number
  price: string | number
  costPrice?: string | number | null
}

export interface QuoteSpecialPartLineInput {
  name?: string | null
  qty: string | number
  price: string | number
  costPrice?: string | number | null
}

export interface QuoteInput {
  taxProvince?: string | null
  /** `quotes.applied_tax_rate`; overrides the province table when present. */
  appliedTaxRate?: string | number | null
  /** `quotes.manual_tax_amount`; honoured as typed. */
  manualTaxAmount?: string | number | null
  labour?: readonly QuoteLabourLineInput[]
  parts?: readonly QuotePartLineInput[]
  specialParts?: readonly QuoteSpecialPartLineInput[]
}

export interface QuoteTotals {
  labour: string
  material: string
  subtotal: string
  tax: string
  total: string
  taxProvince: string
  taxRate: string
  appliedManualTax: boolean
  /** Cost basis from the parallel incurred columns. */
  incurredLabour: string
  incurredMaterial: string
  incurredSubtotal: string
  /** subtotal − incurredSubtotal (negative means selling below cost). */
  margin: string
  /** margin ÷ subtotal × 100, two decimals; `0.00` when subtotal is zero. */
  marginPercent: string
}

const HUNDREDTHS = 2
const ZERO: Decimal = { value: 0n, scale: HUNDREDTHS }

function lineTotal(quantity: Decimal, price: Decimal, field: string): Decimal {
  if (price.scale > HUNDREDTHS) {
    throw new PricingError(`Enter ${field} with at most 2 decimal places.`)
  }
  return round(multiply(quantity, price), HUNDREDTHS)
}

/** PHP `empty()`: null, '', 0 and '0' mean one tech; '0.00' stays zero. */
function techCount(raw: string | number | null | undefined): Decimal {
  if (raw === null || raw === undefined) return parseDecimal('1')!
  if (typeof raw === 'number') {
    if (raw === 0) return parseDecimal('1')!
  } else {
    const text = raw.trim()
    if (text === '' || text === '0') return parseDecimal('1')!
  }
  return requireDecimal(raw, 'technicians')
}

export function calculateQuoteTotals(input: QuoteInput): QuoteTotals {
  const province = salesTaxRate(input.taxProvince)
  const override = parseDecimal(input.appliedTaxRate)
  const taxRate = override ?? province.rate

  let labourTotal = ZERO
  let partsTotal = ZERO
  let specialPartsTotal = ZERO
  let incurredLabour = ZERO
  let incurredMaterial = ZERO
  let taxTotal = ZERO

  for (const line of input.labour ?? []) {
    const hours = requireDecimal(line.hours, 'hours')
    const techs = techCount(line.numTechs)
    const rate = requireDecimal(line.rate, 'rate')
    const billedHours = multiply(hours, techs)
    const amount = lineTotal(billedHours, rate, 'rate')
    taxTotal = roundStep(add(taxTotal, multiply(amount, taxRate)), HUNDREDTHS)
    labourTotal = add(labourTotal, amount)

    const costHours = parseDecimal(line.incurredHours) ?? hours
    const costRate = parseDecimal(line.incurredRate)
    if (costRate !== null) {
      incurredLabour = add(
        incurredLabour,
        lineTotal(multiply(costHours, techs), costRate, 'incurred rate'),
      )
    }
  }

  for (const line of input.parts ?? []) {
    const qty = requireDecimal(line.qty, 'part quantity')
    const price = requireDecimal(line.price, 'part price')
    const amount = lineTotal(qty, price, 'part price')
    taxTotal = roundStep(add(taxTotal, multiply(amount, taxRate)), HUNDREDTHS)
    partsTotal = add(partsTotal, amount)

    const cost = parseDecimal(line.costPrice)
    if (cost !== null) {
      incurredMaterial = add(incurredMaterial, lineTotal(qty, cost, 'incurred part price'))
    }
  }

  for (const line of input.specialParts ?? []) {
    const name = (line.name ?? '').trim()
    if (!name) throw new PricingError('Enter a value for special part name.')
    const qty = requireDecimal(line.qty, 'special part quantity')
    const price = requireDecimal(line.price, 'special part price')
    if (compare(qty, parseDecimal('-99999') ?? { value: -99999n, scale: 0 }) <= 0) {
      continue
    }
    const amount = lineTotal(qty, price, 'special part price')
    taxTotal = roundStep(add(taxTotal, multiply(amount, taxRate)), HUNDREDTHS)
    specialPartsTotal = add(specialPartsTotal, amount)

    const cost = parseDecimal(line.costPrice)
    if (cost !== null) {
      incurredMaterial = add(
        incurredMaterial,
        lineTotal(qty, cost, 'incurred special part price'),
      )
    }
  }

  const materialTotal = round(add(partsTotal, specialPartsTotal), HUNDREDTHS)
  const subtotal = round(add(add(labourTotal, partsTotal), specialPartsTotal), HUNDREDTHS)

  let appliedManualTax = false
  const manualTax = parseDecimal(input.manualTaxAmount)
  if (manualTax !== null) {
    taxTotal = round(manualTax, HUNDREDTHS)
    appliedManualTax = true
  }

  const incurredSubtotal = round(add(incurredLabour, incurredMaterial), HUNDREDTHS)
  const margin = round(subtract(subtotal, incurredSubtotal), HUNDREDTHS)
  const marginPercent = compare(subtotal, ZERO) === 0
    ? '0.00'
    : format(round(multiply(divide(margin, subtotal), parseDecimal('100')!), HUNDREDTHS), HUNDREDTHS)

  return {
    labour: format(labourTotal, HUNDREDTHS),
    material: format(materialTotal, HUNDREDTHS),
    subtotal: format(subtotal, HUNDREDTHS),
    tax: format(taxTotal, HUNDREDTHS),
    total: format(add(subtotal, taxTotal), HUNDREDTHS),
    taxProvince: normalizeSalesProvince(input.taxProvince),
    taxRate: format(taxRate, 5).replace(/0+$/, '').replace(/\.$/, ''),
    appliedManualTax,
    incurredLabour: format(incurredLabour, HUNDREDTHS),
    incurredMaterial: format(incurredMaterial, HUNDREDTHS),
    incurredSubtotal: format(incurredSubtotal, HUNDREDTHS),
    margin: format(margin, HUNDREDTHS),
    marginPercent,
  }
}

/** Decimal division with the same scale discipline as the other helpers. */
function divide(numerator: Decimal, denominator: Decimal): Decimal {
  if (denominator.value === 0n) return ZERO
  const scale = 10
  const factor = 10n ** BigInt(scale + denominator.scale - numerator.scale + 4)
  return { value: (numerator.value * factor) / denominator.value, scale: scale + 4 }
}
