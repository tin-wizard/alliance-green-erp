/**
 * Exact decimal arithmetic for the money calculators.
 *
 * The legacy PHP builds money from floats and `number_format(..., 2)`, which
 * rounds half away from zero. Reproducing those historical figures with
 * JavaScript numbers would inherit the same binary-float noise in a different
 * order, so every figure here is an integer scaled by a power of ten and every
 * rounding step is explicit.
 *
 * SERVER AND CLIENT SAFE. No dependencies.
 */

export class PricingError extends Error {
  readonly code = 'pricing_invalid_input'

  constructor(message: string) {
    super(message)
    this.name = 'PricingError'
  }
}

export interface Decimal {
  /** Unscaled value: the number multiplied by 10^scale. */
  readonly value: bigint
  readonly scale: number
}

const DECIMAL_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?$/

/** Parse a decimal string or number. Blank, malformed and non-finite input returns null. */
export function parseDecimal(input: string | number | null | undefined): Decimal | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null
    return parseDecimal(String(input))
  }
  const text = input.trim().replace(/[$,\s]/g, '')
  if (text === '' || text === '+' || text === '-' || text === '.') return null
  const match = DECIMAL_PATTERN.exec(text)
  if (!match) return null
  const [, sign = '', whole = '', fraction = ''] = match
  if (whole === '' && fraction === '') return null
  const digits = `${whole || '0'}${fraction}`
  if (!/^\d+$/.test(digits)) return null
  let value = BigInt(digits)
  if (sign === '-') value = -value
  return { value, scale: fraction.length }
}

/** Parse or throw with the message the calculator should surface. */
export function requireDecimal(
  input: string | number | null | undefined,
  field: string,
): Decimal {
  const parsed = parseDecimal(input)
  if (!parsed) throw new PricingError(`Enter a valid number for ${field}.`)
  return parsed
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent)
}

/** Align two decimals to the larger scale. */
function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale)
  return [a.value * pow10(scale - a.scale), b.value * pow10(scale - b.scale), scale]
}

export function add(a: Decimal, b: Decimal): Decimal {
  const [left, right, scale] = align(a, b)
  return { value: left + right, scale }
}

export function subtract(a: Decimal, b: Decimal): Decimal {
  const [left, right, scale] = align(a, b)
  return { value: left - right, scale }
}

export function multiply(a: Decimal, b: Decimal): Decimal {
  return { value: a.value * b.value, scale: a.scale + b.scale }
}

export function compare(a: Decimal, b: Decimal): number {
  const [left, right] = align(a, b)
  return left === right ? 0 : left < right ? -1 : 1
}

export function isZero(a: Decimal): boolean {
  return a.value === 0n
}

/**
 * Round half away from zero to `dp` decimals, matching PHP's `number_format`.
 * 0.165 -> 0.17, -0.165 -> -0.17, 25.025 -> 25.03.
 */
export function round(a: Decimal, dp = 2): Decimal {
  if (a.scale <= dp) {
    return { value: a.value * pow10(dp - a.scale), scale: dp }
  }
  const divisor = pow10(a.scale - dp)
  const negative = a.value < 0n
  const absolute = negative ? -a.value : a.value
  let quotient = absolute / divisor
  const remainder = absolute % divisor
  if (remainder * 2n >= divisor) quotient += 1n
  return { value: negative ? -quotient : quotient, scale: dp }
}

/**
 * Round an accumulated sum to `dp` in place. `number_format` is applied after
 * every tax accumulation step in the legacy calculators; callers use this to
 * reproduce that behaviour.
 */
export function roundStep(a: Decimal, dp = 2): Decimal {
  return round(a, dp)
}

/** Fixed-point string, e.g. `format(round(...), 2)` -> "42.34". */
export function format(a: Decimal, dp = 2): string {
  const rounded = a.scale === dp ? a : round(a, dp)
  const negative = rounded.value < 0n
  const absolute = negative ? -rounded.value : rounded.value
  const digits = absolute.toString().padStart(dp + 1, '0')
  const whole = digits.slice(0, digits.length - dp)
  const fraction = dp === 0 ? '' : `.${digits.slice(digits.length - dp)}`
  return `${negative ? '-' : ''}${whole}${fraction}`
}

/** Convenience: round then format to two decimals. */
export function money(a: Decimal): string {
  return format(round(a, 2), 2)
}

/** True when two decimal-ish values represent the same amount (2dp aware). */
export function decimalEquals(
  a: string | number | null | undefined,
  b: Decimal,
): boolean {
  const parsed = parseDecimal(a)
  return parsed !== null && compare(parsed, b) === 0
}

/** Numeric value, for tests and diagnostics only. Never use for money storage. */
export function toNumber(a: Decimal): number {
  return Number(format(a, a.scale))
}
