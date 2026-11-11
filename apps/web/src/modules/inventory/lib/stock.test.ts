import { describe, expect, it } from 'vitest'
import {
  applyAdjustment,
  applyPurchase,
  applySale,
  counterLedgerDifference,
  type StockCounters,
} from './stock'

const base: StockCounters = {
  purchasedQuantity: '10.00',
  currentQuantity: '7.50',
  soldQuantity: '2.50',
}

describe('stock counter arithmetic (E1/E4)', () => {
  it('mirrors the legacy sale order: sold grows, current shrinks, purchased untouched', () => {
    expect(applySale(base, '2.50')).toEqual({
      purchasedQuantity: '10.00',
      currentQuantity: '5.00',
      soldQuantity: '5.00',
    })
  })

  it('allows current stock to go negative exactly as the legacy counter does', () => {
    expect(applySale(base, '10.00').currentQuantity).toBe('-2.50')
  })

  it('mirrors the legacy purchase order: purchased and current grow together', () => {
    expect(applyPurchase(base, '0.25')).toEqual({
      purchasedQuantity: '10.25',
      currentQuantity: '7.75',
      soldQuantity: '2.50',
    })
  })

  it('adjusts only current quantity, signed both ways', () => {
    expect(applyAdjustment(base, '-1.50')).toEqual({
      purchasedQuantity: '10.00',
      currentQuantity: '6.00',
      soldQuantity: '2.50',
    })
    expect(applyAdjustment(base, '1.50').currentQuantity).toBe('9.00')
  })

  it('keeps two-decimal precision through repeated fractional moves', () => {
    let counters = base
    for (let i = 0; i < 3; i += 1) counters = applySale(counters, '0.10')
    expect(counters.currentQuantity).toBe('7.20')
    expect(counters.soldQuantity).toBe('2.80')
  })

  it('rejects negative purchase and sale quantities but accepts a signed adjustment', () => {
    expect(() => applySale(base, '-1')).toThrow(/Invalid stock quantity/)
    expect(() => applyPurchase(base, '-1')).toThrow(/Invalid stock quantity/)
    expect(applyAdjustment(base, '-1').currentQuantity).toBe('6.50')
  })

  it('reports a counter/ledger difference without correcting either side', () => {
    expect(counterLedgerDifference('7.50', '5.00')).toBe('2.50')
    expect(counterLedgerDifference('-2.50', '0')).toBe('-2.50')
    expect(counterLedgerDifference('5.00', '5.00')).toBe('0.00')
  })
})
