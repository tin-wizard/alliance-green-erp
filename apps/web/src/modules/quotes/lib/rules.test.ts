import { describe, expect, test } from 'vitest'
import { canConvertQuote, canEditQuote, canReviseQuote, quoteCapabilities } from './rules'
import type { QuoteDetail } from '../types'

const base = {
  status: 4,
  isDeleted: false,
  isLastRevision: true,
  convertedWorkOrderId: null,
  kind: 'customer' as const,
}

describe('quote rules', () => {
  test('only an approved, current, unconverted quote converts', () => {
    expect(canConvertQuote(base)).toBe(true)
    expect(canConvertQuote({ ...base, status: 3 })).toBe(false)
    expect(canConvertQuote({ ...base, isDeleted: true })).toBe(false)
    expect(canConvertQuote({ ...base, convertedWorkOrderId: 42 })).toBe(false)
    expect(canConvertQuote({ ...base, isLastRevision: false })).toBe(false)
  })

  test('editing is limited to in-progress/saved chain ends', () => {
    expect(canEditQuote({ status: 1, isDeleted: false, isLastRevision: true })).toBe(true)
    expect(canEditQuote({ status: 2, isDeleted: false, isLastRevision: true })).toBe(true)
    expect(canEditQuote({ status: 3, isDeleted: false, isLastRevision: true })).toBe(false)
    expect(canEditQuote({ status: 1, isDeleted: true, isLastRevision: true })).toBe(false)
    expect(canEditQuote({ status: 1, isDeleted: false, isLastRevision: false })).toBe(false)
  })

  test('revision requires approved, current and not deleted', () => {
    expect(canReviseQuote({ status: 4, isDeleted: false, isLastRevision: true })).toBe(true)
    expect(canReviseQuote({ status: 5, isDeleted: false, isLastRevision: true })).toBe(false)
    expect(canReviseQuote({ status: 4, isDeleted: false, isLastRevision: false })).toBe(false)
  })

  test('conversion capability requires both quote:approve and workorder:create', () => {
    const quote = { ...base } as unknown as QuoteDetail
    expect(quoteCapabilities(quote, new Set(['quote:approve', 'workorder:create'])).canConvert).toBe(
      true,
    )
    expect(quoteCapabilities(quote, new Set(['quote:approve'])).canConvert).toBe(false)
    expect(
      quoteCapabilities(
        { ...quote, status: 3 },
        new Set(['quote:approve', 'workorder:create']),
      ).canConvert,
    ).toBe(false)
  })

  test('a standalone quote exposes soft delete only with write permission', () => {
    const standalone = { ...base, kind: 'standalone' as const } as unknown as QuoteDetail
    expect(quoteCapabilities(standalone, new Set(['quote:write'])).canDelete).toBe(true)
    expect(quoteCapabilities(standalone, new Set(['quote:read'])).canDelete).toBe(false)
    expect(quoteCapabilities({ ...standalone, kind: 'customer' }, new Set(['quote:write'])).canDelete).toBe(
      false,
    )
  })
})
