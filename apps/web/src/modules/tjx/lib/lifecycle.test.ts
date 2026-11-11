import { describe, expect, test } from 'vitest'
import {
  TJX_GRID_LABELS,
  TJX_PAYMENT_TERM_LABELS,
  TJX_QUOTE_TYPES,
  TJX_STATUS_LABELS,
  allowedNextStatuses,
  canApproveQuote,
  canCancelQuote,
  canEditQuote,
  gridLabel,
  isTerminalStatus,
  isTjxGridType,
  isTjxPaymentTerms,
  isTjxQuoteStatus,
  paymentTermsLabel,
  quoteLabel,
  statusLabel,
} from './lifecycle'

describe('TJX lifecycle constants', () => {
  test('keeps the four legacy status codes and never introduces Saved', () => {
    expect(Object.keys(TJX_STATUS_LABELS).map(Number)).toEqual([1, 3, 4, 5])
    expect(statusLabel(1)).toBe('In Progress')
    expect(statusLabel(3)).toBe('Waiting for Approval')
    expect(statusLabel(4)).toBe('Approved')
    expect(statusLabel(5)).toBe('Cancelled')
    expect(statusLabel(2)).toBe('Unknown (2)')
    expect(isTjxQuoteStatus(2)).toBe(false)
    expect(isTjxQuoteStatus(4)).toBe(true)
  })

  test('the transition graph matches the plan', () => {
    expect(allowedNextStatuses(1)).toEqual([3, 5])
    expect(allowedNextStatuses(3)).toEqual([1, 4, 5])
    expect(allowedNextStatuses(4)).toEqual([5])
    expect(allowedNextStatuses(5)).toEqual([])
    expect(canEditQuote(1)).toBe(true)
    expect(canEditQuote(3)).toBe(true)
    expect(canEditQuote(4)).toBe(false)
    expect(canApproveQuote(3)).toBe(true)
    expect(canApproveQuote(4)).toBe(false)
    expect(canCancelQuote(4)).toBe(true)
    expect(isTerminalStatus(5)).toBe(true)
    expect(isTerminalStatus(4)).toBe(false)
  })

  test('grid and payment labels preserve the raw codes', () => {
    expect(TJX_GRID_LABELS).toEqual({ 1: 'A', 2: 'B', 3: 'C', 4: 'Highbay' })
    expect(gridLabel(4)).toBe('Highbay')
    expect(gridLabel(null)).toBeNull()
    expect(isTjxGridType(4)).toBe(true)
    expect(isTjxGridType(5)).toBe(false)
    expect(TJX_PAYMENT_TERM_LABELS[5]).toBe('NET45')
    expect(paymentTermsLabel(3)).toBe('15 Days')
    expect(paymentTermsLabel(2)).toBeNull()
    expect(isTjxPaymentTerms(2)).toBe(false)
    expect(isTjxPaymentTerms(5)).toBe(true)
  })

  test('quote types and display label', () => {
    expect(TJX_QUOTE_TYPES).toEqual(['Gen 1', 'Gen 2'])
    expect(quoteLabel(42)).toBe('TJX-42')
  })
})
