import { describe, expect, test } from 'vitest'
import {
  ALLOWED_TRANSITIONS,
  allowedNextQuoteStatuses,
  canTransitionQuote,
  illegalQuoteTransitionMessage,
  isTerminalQuoteStatus,
  quoteNumberLabel,
  quoteTransitionPermission,
} from './status'

const STATUSES = [1, 2, 3, 4, 5] as const

describe('quote lifecycle table', () => {
  test.each([
    [1, 3, 'customer'],
    [1, 5, 'customer'],
    [1, 2, 'standalone'],
    [2, 1, 'standalone'],
    [2, 3, 'standalone'],
    [2, 5, 'standalone'],
    [3, 4, 'customer'],
    [3, 5, 'customer'],
    [3, 4, 'standalone'],
  ] as const)('%i → %i is legal for %s', (from, to, kind) => {
    expect(canTransitionQuote(from, to, kind)).toBe(true)
  })

  test.each([
    [1, 2, 'customer'],
    [1, 4, 'customer'],
    [2, 4, 'standalone'],
    [3, 1, 'customer'],
    [4, 5, 'customer'],
    [5, 3, 'customer'],
    [4, 1, 'standalone'],
  ] as const)('%i → %i is rejected for %s', (from, to, kind) => {
    expect(canTransitionQuote(from, to, kind)).toBe(false)
  })

  test('standalone alone exposes Saved (2)', () => {
    expect(allowedNextQuoteStatuses(1, 'customer')).toEqual([3, 5])
    expect(allowedNextQuoteStatuses(1, 'standalone')).toEqual([2, 3, 5])
  })

  test('4 and 5 are terminal for the row', () => {
    expect(ALLOWED_TRANSITIONS[4]).toEqual([])
    expect(ALLOWED_TRANSITIONS[5]).toEqual([])
    expect(isTerminalQuoteStatus(4)).toBe(true)
    expect(isTerminalQuoteStatus(5)).toBe(true)
    expect(isTerminalQuoteStatus(3)).toBe(false)
  })

  test('illegal transition message names both statuses and the legal set', () => {
    expect(illegalQuoteTransitionMessage(1, 4, 'customer')).toBe(
      'Illegal quote status change: In Progress → Approved. Allowed next: Waiting for approval, Cancelled.',
    )
    expect(illegalQuoteTransitionMessage(4, 3, 'customer')).toContain(
      'none — issue a revision to change an issued quote',
    )
  })

  test('approval is the only approve-permission transition', () => {
    for (const status of STATUSES) {
      expect(quoteTransitionPermission(status)).toBe(status === 4 ? 'quote:approve' : 'quote:write')
    }
  })

  test('customer quote number is the reserved work-order number', () => {
    expect(quoteNumberLabel('customer', 12, 900501)).toBe('900501')
    expect(quoteNumberLabel('customer', 12, null)).toBe('12')
    expect(quoteNumberLabel('standalone', 12, null)).toBe('12')
  })
})
