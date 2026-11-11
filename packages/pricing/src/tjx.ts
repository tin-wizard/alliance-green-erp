/**
 * TJX quote calculator.
 *
 * The TJX quote carries two money triplets side by side: the customer price
 * with the program markup applied, and the subcontractor-facing price without
 * it. The legacy screens computed both in PHP and stored the totals; this
 * module is the single calculator for the v2 quote, sub-invoice and export
 * paths.
 *
 * Rules, all fixture-proven in `fixtures/tjx-quote.json`:
 *  - with markup, per fixture: `ceil(F * M) * R`;
 *  - without markup, per fixture: `ceil(F) * R`;
 *  - `WIN-150` is the legacy exception: both sides use `F * M * R`;
 *  - raw quantities aggregate across fixtures before the global ceiling
 *    (with markup) or the 3-decimal round (without markup), never per fixture;
 *  - tax is rounded per line to two decimals and summed.
 *
 * Pure: no database, no React, no environment.
 */
import {
  add,
  compare,
  format,
  multiply,
  PricingError,
  requireDecimal,
  round,
  type Decimal,
} from './decimal'

export interface TjxFixturePartInput {
  partNo: string
  description?: string | null
  markup: string
  ratioPerFixture: string
}

export interface TjxFixtureInput {
  quantity: string
  parts: readonly TjxFixturePartInput[]
}

export interface TjxSpecialPartInput {
  name: string
  quantity: string
  unitPrice: string
}

export interface TjxQuoteInput {
  taxRate: string
  fixtures: readonly TjxFixtureInput[]
  specialParts?: readonly TjxSpecialPartInput[]
  prices: Readonly<Record<string, string>>
}

export interface TjxCalculatedPart {
  partNo: string
  description: string | null
  /** 3 decimals. */
  qtyWithMarkup: string
  /** 3 decimals. */
  qtyWithoutMarkup: string
  /** 2 decimals. */
  unitPrice: string
  /** 2 decimals. */
  lineWithMarkup: string
  /** 2 decimals. */
  lineWithoutMarkup: string
  /** 2 decimals. */
  taxWithMarkup: string
  /** 2 decimals. */
  taxWithoutMarkup: string
}

export interface TjxCalculatedSpecialPart {
  name: string
  quantity: string
  unitPrice: string
  lineTotal: string
  tax: string
}

export interface TjxQuoteCalculation {
  parts: TjxCalculatedPart[]
  specialParts: TjxCalculatedSpecialPart[]
  subtotal: string
  tax: string
  total: string
  withoutMarkupSubtotal: string
  withoutMarkupTax: string
  withoutMarkupTotal: string
}

const ZERO: Decimal = { value: 0n, scale: 0 }
const ONE: Decimal = { value: 1n, scale: 0 }
const LEGACY_EXCEPTION_PART = 'WIN-150'

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent)
}

/** Ceiling to an integer, away from zero for negatives. */
function ceiling(value: Decimal): Decimal {
  const divisor = pow10(value.scale)
  const negative = value.value < 0n
  const absolute = negative ? -value.value : value.value
  const whole = absolute / divisor
  if (negative) {
    return { value: -whole, scale: 0 }
  }
  const remainder = absolute % divisor
  return { value: remainder === 0n ? whole : whole + 1n, scale: 0 }
}

function canonicalPartNo(partNo: string): string {
  return partNo.trim().toUpperCase()
}

function requireTaxRate(input: string): Decimal {
  const rate = requireDecimal(input, 'tax rate')
  if (compare(rate, ZERO) < 0 || compare(rate, ONE) > 0) {
    throw new PricingError('Enter a tax rate between 0 and 1.')
  }
  return rate
}

function requirePrice(
  prices: ReadonlyMap<string, Decimal>,
  partNo: string,
): Decimal {
  const price = prices.get(partNo)
  if (price === undefined) {
    throw new PricingError(`No price is set for part ${partNo}.`)
  }
  if (compare(price, ZERO) < 0) {
    throw new PricingError(`Enter a price of zero or more for part ${partNo}.`)
  }
  if (price.scale > 2) {
    throw new PricingError(`Enter a price with at most 2 decimal places for part ${partNo}.`)
  }
  return price
}

interface PartAccumulator {
  description: string | null
  withRaw: Decimal
  withoutRaw: Decimal
}

export function calculateTjxQuote(input: TjxQuoteInput): TjxQuoteCalculation {
  const taxRate = requireTaxRate(input.taxRate)

  const priceMap = new Map<string, Decimal>()
  for (const [partNo, raw] of Object.entries(input.prices)) {
    const canonical = canonicalPartNo(partNo)
    const price = requireDecimal(raw, `price for part ${canonical}`)
    priceMap.set(canonical, price)
  }

  const accumulators = new Map<string, PartAccumulator>()

  input.fixtures.forEach((fixture, fixtureIndex) => {
    const quantity = requireDecimal(fixture.quantity, 'fixture quantity')
    if (compare(quantity, ZERO) <= 0) {
      throw new PricingError(
        `Enter a quantity greater than zero for fixture ${fixtureIndex + 1}.`,
      )
    }

    for (const part of fixture.parts) {
      const partNo = canonicalPartNo(part.partNo)
      if (!partNo) {
        throw new PricingError(`Enter a part number for fixture ${fixtureIndex + 1}.`)
      }
      const markup = requireDecimal(part.markup, `markup for part ${partNo}`)
      if (compare(markup, ZERO) <= 0) {
        throw new PricingError(`Enter a markup greater than zero for part ${partNo}.`)
      }
      const ratio = requireDecimal(part.ratioPerFixture, `ratio for part ${partNo}`)
      if (compare(ratio, ZERO) < 0) {
        throw new PricingError(`Enter a ratio of zero or more for part ${partNo}.`)
      }

      const marked = multiply(quantity, markup)
      const withRaw =
        partNo === LEGACY_EXCEPTION_PART
          ? multiply(marked, ratio)
          : multiply(ceiling(marked), ratio)
      const withoutRaw =
        partNo === LEGACY_EXCEPTION_PART
          ? multiply(marked, ratio)
          : multiply(ceiling(quantity), ratio)

      const existing = accumulators.get(partNo)
      if (existing) {
        existing.withRaw = add(existing.withRaw, withRaw)
        existing.withoutRaw = add(existing.withoutRaw, withoutRaw)
        if (!existing.description && part.description) {
          existing.description = part.description
        }
      } else {
        accumulators.set(partNo, {
          description: part.description ?? null,
          withRaw,
          withoutRaw,
        })
      }
    }
  })

  const partNumbers = [...accumulators.keys()].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  )

  const parts: TjxCalculatedPart[] = []
  let subtotal = ZERO
  let tax = ZERO
  let withoutSubtotal = ZERO
  let withoutTax = ZERO

  for (const partNo of partNumbers) {
    const accumulator = accumulators.get(partNo)!
    const unitPrice = requirePrice(priceMap, partNo)
    const qtyWithMarkup = ceiling(accumulator.withRaw)
    const qtyWithoutMarkup = round(accumulator.withoutRaw, 3)
    const lineWithMarkup = round(multiply(qtyWithMarkup, unitPrice), 2)
    const lineWithoutMarkup = round(multiply(qtyWithoutMarkup, unitPrice), 2)
    const taxWithMarkup = round(multiply(lineWithMarkup, taxRate), 2)
    const taxWithoutMarkup = round(multiply(lineWithoutMarkup, taxRate), 2)

    parts.push({
      partNo,
      description: accumulator.description,
      qtyWithMarkup: format(qtyWithMarkup, 3),
      qtyWithoutMarkup: format(qtyWithoutMarkup, 3),
      unitPrice: format(unitPrice, 2),
      lineWithMarkup: format(lineWithMarkup, 2),
      lineWithoutMarkup: format(lineWithoutMarkup, 2),
      taxWithMarkup: format(taxWithMarkup, 2),
      taxWithoutMarkup: format(taxWithoutMarkup, 2),
    })

    subtotal = add(subtotal, lineWithMarkup)
    tax = add(tax, taxWithMarkup)
    withoutSubtotal = add(withoutSubtotal, lineWithoutMarkup)
    withoutTax = add(withoutTax, taxWithoutMarkup)
  }

  const specialParts: TjxCalculatedSpecialPart[] = []
  for (const [index, special] of (input.specialParts ?? []).entries()) {
    const name = special.name.trim()
    if (!name) {
      throw new PricingError(`Enter a name for special part ${index + 1}.`)
    }
    const quantity = requireDecimal(special.quantity, `quantity for ${name}`)
    if (compare(quantity, ZERO) <= 0) {
      throw new PricingError(`Enter a quantity greater than zero for ${name}.`)
    }
    const unitPrice = requireDecimal(special.unitPrice, `price for ${name}`)
    if (compare(unitPrice, ZERO) < 0) {
      throw new PricingError(`Enter a price of zero or more for ${name}.`)
    }
    if (unitPrice.scale > 2) {
      throw new PricingError(`Enter a price with at most 2 decimal places for ${name}.`)
    }

    const lineTotal = round(multiply(quantity, unitPrice), 2)
    const lineTax = round(multiply(lineTotal, taxRate), 2)

    specialParts.push({
      name,
      quantity: format(quantity, 3),
      unitPrice: format(unitPrice, 2),
      lineTotal: format(lineTotal, 2),
      tax: format(lineTax, 2),
    })

    subtotal = add(subtotal, lineTotal)
    tax = add(tax, lineTax)
    withoutSubtotal = add(withoutSubtotal, lineTotal)
    withoutTax = add(withoutTax, lineTax)
  }

  return {
    parts,
    specialParts,
    subtotal: format(subtotal, 2),
    tax: format(tax, 2),
    total: format(add(subtotal, tax), 2),
    withoutMarkupSubtotal: format(withoutSubtotal, 2),
    withoutMarkupTax: format(withoutTax, 2),
    withoutMarkupTotal: format(add(withoutSubtotal, withoutTax), 2),
  }
}
