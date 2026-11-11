/**
 * Payload mappers. Pure functions: the adapter resolves ids (contact, product,
 * tax rate, ledger account) and the mapper proves the arithmetic before a single
 * byte is sent.
 *
 * The API computes document totals from lines. It is never sent a total field,
 * because a total we send and a line set the API adds up are two numbers that can
 * disagree — and the ledger believes the lines.
 */
import { SageError } from '../errors'

export interface DocumentMappingContext {
  contactId: string
  /** Account used for lines that are not products (labour, services). */
  ledgerAccountId: string | null
  /** Account used when the line set cannot reproduce our stored net exactly. */
  roundingLedgerAccountId: string | null
  taxRateIdFor(percent: string): string
  productIdFor(partNumber: string): string | null
}

export interface InvoiceLineInput {
  description: string
  quantity: string
  unitPrice: string
  taxRate: string
  lineTotal: string
  partNumber?: string | null
}

export interface MappedLine {
  description: string
  quantity: string
  unit_price: string
  tax_rate_id: string
  product_id?: string
  ledger_account_id?: string
}

export interface MappedLines {
  lines: MappedLine[]
  /** Net and tax the ledger will compute from the mapped lines, in cents. */
  netCents: number
  taxCents: number
  roundingAdded: boolean
}

/**
 * The legacy database stores tax two ways: a percentage (`13`) and a decimal
 * fraction (`0.13000`, from `applied_tax_rate`). Canadian rates sit between 5%
 * and 15%, so a value of 1 or less is unambiguously a fraction. Everything above
 * this function works in percent, which is what Sage calls `percentage`.
 */
export function taxPercent(raw: string | number): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) {
    throw new SageError('permanent', 'TAX_RATE_UNREADABLE', `Cannot read the tax rate "${String(raw)}".`)
  }
  return n > 0 && n <= 1 ? n * 100 : n
}

export function toCents(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) {
    throw new SageError('permanent', 'AMOUNT_UNREADABLE', `Cannot read the amount "${String(value)}".`)
  }
  return Math.round(n * 100)
}

export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function mapLines(input: {
  lines: InvoiceLineInput[]
  context: DocumentMappingContext
  subtotal: string
  tax: string
  total: string
}): MappedLines {
  const { lines, context } = input
  const mapped: MappedLine[] = []
  let netCents = 0
  let taxCents = 0

  for (const line of lines) {
    const rate = taxPercent(line.taxRate)
    const quantity = Number(line.quantity)
    const unitPrice = Number(line.unitPrice)
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) {
      throw new SageError(
        'permanent',
        'LINE_AMOUNT_UNREADABLE',
        `Line "${line.description}" has an unreadable quantity or price.`,
      )
    }
    const lineNet = Math.round(quantity * unitPrice * 100)
    const lineTax = Math.round((lineNet * rate) / 100)
    netCents += lineNet
    taxCents += lineTax

    const lineMapped: MappedLine = {
      description: line.description,
      quantity: String(line.quantity),
      unit_price: String(line.unitPrice),
      tax_rate_id: context.taxRateIdFor(String(rate)),
    }
    if (line.partNumber) {
      const productId = context.productIdFor(line.partNumber)
      if (productId) {
        lineMapped.product_id = productId
      } else if (context.ledgerAccountId) {
        lineMapped.ledger_account_id = context.ledgerAccountId
      } else {
        throw new SageError(
          'permanent',
          'MAPPING_MISSING',
          `Part "${line.partNumber}" is not in the ledger and no sales ledger account is configured.`,
        )
      }
    } else if (context.ledgerAccountId) {
      lineMapped.ledger_account_id = context.ledgerAccountId
    } else {
      throw new SageError(
        'permanent',
        'MAPPING_MISSING',
        'No ledger account is configured for non-product lines.',
      )
    }
    mapped.push(lineMapped)
  }

  // Rounding line: the line set is authoritative, so an arithmetic difference
  // between our stored subtotal and the lines is posted explicitly, never
  // hidden by editing a line.
  const expectedNet = toCents(input.subtotal)
  let roundingAdded = false
  const delta = expectedNet - netCents
  if (delta !== 0) {
    if (!context.roundingLedgerAccountId) {
      throw new SageError(
        'permanent',
        'ROUNDING_UNRESOLVED',
        `The line set is ${fromCents(delta)} away from the stored subtotal and no rounding account is configured.`,
        { details: { expectedNet: fromCents(expectedNet), lineNet: fromCents(netCents) } },
      )
    }
    const roundingRate = String(taxPercent(lines[0]?.taxRate ?? 0))
    mapped.push({
      description: 'Rounding adjustment',
      quantity: '1',
      unit_price: fromCents(delta),
      tax_rate_id: context.taxRateIdFor(roundingRate),
      ledger_account_id: context.roundingLedgerAccountId,
    })
    const roundingTax = Math.round((delta * taxPercent(roundingRate)) / 100)
    netCents += delta
    taxCents += roundingTax
    roundingAdded = true
  }

  const expectedTax = toCents(input.tax)
  if (Math.abs(expectedTax - taxCents) > 1) {
    throw new SageError(
      'permanent',
      'TOTAL_MISMATCH',
      `The mapped lines produce tax ${fromCents(taxCents)} but the invoice stores ${fromCents(expectedTax)}.`,
      {
        details: {
          expectedNet: fromCents(expectedNet),
          computedNet: fromCents(netCents),
          expectedTax: fromCents(expectedTax),
          computedTax: fromCents(taxCents),
        },
      },
    )
  }
  const expectedTotal = toCents(input.total)
  if (Math.abs(expectedTotal - (netCents + taxCents)) > 1) {
    throw new SageError(
      'permanent',
      'TOTAL_MISMATCH',
      `The mapped lines total ${fromCents(netCents + taxCents)} but the invoice stores ${fromCents(expectedTotal)}.`,
    )
  }

  return { lines: mapped, netCents, taxCents, roundingAdded }
}
