/**
 * Stock counter arithmetic (BUSINESS-RULES E1, E4).
 *
 * The counter is authoritative. These functions operate on `parts` counters and
 * never derive them from the ledger. Sale and purchase mirror the legacy
 * increment/decrement order; adjustments change only `current_quantity`.
 */
import { add, compare, format, parseDecimal, round, subtract, type Decimal } from '@cls/pricing'

export interface StockCounters {
  purchasedQuantity: string
  currentQuantity: string
  soldQuantity: string
}

function dec(value: string | null | undefined, label: string): Decimal {
  const parsed = parseDecimal(value ?? '0')
  if (!parsed) throw new Error(`Invalid ${label}: ${value}`)
  return parsed
}

function qty(value: string): Decimal {
  const parsed = parseDecimal(value)
  if (!parsed || compare(parsed, { value: 0n, scale: 2 }) < 0) {
    throw new Error(`Invalid stock quantity: ${value}`)
  }
  return parsed
}

export function applySale(counters: StockCounters, quantity: string): StockCounters {
  const q = qty(quantity)
  return {
    purchasedQuantity: format(dec(counters.purchasedQuantity, 'purchased quantity'), 2),
    // Legacy order: sold_quantity += qty, then current_quantity -= qty.
    soldQuantity: format(round(add(dec(counters.soldQuantity, 'sold quantity'), q), 2), 2),
    currentQuantity: format(
      round(subtract(dec(counters.currentQuantity, 'current quantity'), q), 2),
      2,
    ),
  }
}

export function applyPurchase(counters: StockCounters, quantity: string): StockCounters {
  const q = qty(quantity)
  return {
    purchasedQuantity: format(
      round(add(dec(counters.purchasedQuantity, 'purchased quantity'), q), 2),
      2,
    ),
    currentQuantity: format(round(add(dec(counters.currentQuantity, 'current quantity'), q), 2), 2),
    soldQuantity: format(dec(counters.soldQuantity, 'sold quantity'), 2),
  }
}

export function applyAdjustment(counters: StockCounters, signedQuantity: string): StockCounters {
  const q = dec(signedQuantity, 'adjustment quantity')
  return {
    purchasedQuantity: format(dec(counters.purchasedQuantity, 'purchased quantity'), 2),
    currentQuantity: format(round(add(dec(counters.currentQuantity, 'current quantity'), q), 2), 2),
    soldQuantity: format(dec(counters.soldQuantity, 'sold quantity'), 2),
  }
}

/**
 * Reporting aid only. A non-zero result is a legacy fact to surface, not a
 * correction to apply: the counter stays authoritative (E4).
 */
export function counterLedgerDifference(currentQuantity: string, ledgerQuantity: string): string {
  return format(
    round(
      subtract(dec(currentQuantity, 'current quantity'), dec(ledgerQuantity, 'ledger quantity')),
      2,
    ),
    2,
  )
}
