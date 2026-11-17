import { describe, expect, it } from 'vitest'
import { formatQuantity } from './ui'

describe('formatQuantity', () => {
  it('shows plain numbers, never currency', () => {
    expect(formatQuantity('3.00')).toBe('3')
    expect(formatQuantity('-15.00')).toBe('-15')
    expect(formatQuantity('2.50')).toBe('2.5')
    expect(formatQuantity('1234.5')).toBe('1,234.5')
    expect(formatQuantity('3.00')).not.toContain('$')
  })
  it('handles empty and non-numeric values', () => {
    expect(formatQuantity(null)).toBe('—')
    expect(formatQuantity('')).toBe('—')
    expect(formatQuantity('abc')).toBe('abc')
  })
})
