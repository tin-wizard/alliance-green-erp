import { describe, expect, test } from 'vitest'
import {
  classifyCustomerDuplicate,
  classifyPartDuplicate,
  classifySiteDuplicate,
  classifyVendorDuplicate,
  normalizeName,
  similarity,
} from './duplicates'

describe('duplicate thresholds', () => {
  test('normalizes legal suffixes and case', () => {
    expect(normalizeName('Alliance Lighting Supplies Ltd.')).toBe('alliance lighting supplies')
    expect(normalizeName('ALLIANCE LIGHTING SUPPLIES INC')).toBe('alliance lighting supplies')
  })

  test('blocks a customer with the same normalized name and postal code', () => {
    const result = classifyCustomerDuplicate(
      { name: 'Acme Lighting Ltd', postalCode: 'M5V 1A1', city: 'Toronto' },
      [{ id: 1, name: 'ACME LIGHTING INC', postalCode: 'M5V 1A1', city: 'Toronto' }],
    )
    expect(result.decision).toBe('block')
    expect(result.candidateIds).toEqual([1])
  })

  test('requires an override for a >= 0.92 similar name in the same city', () => {
    const left = normalizeName('Alliance Lighting Suppl')
    const right = normalizeName('Alliance Lighting Supplies')
    expect(similarity(left, right)).toBeGreaterThanOrEqual(0.92)
    const result = classifyCustomerDuplicate(
      { name: 'Alliance Lighting Suppl', city: 'Toronto' },
      [{ id: 2, name: 'Alliance Lighting Supplies', city: 'Toronto' }],
    )
    expect(result.decision).toBe('override')
  })

  test('requires an override for a reused phone under a different name', () => {
    const result = classifyCustomerDuplicate(
      { name: 'New Name', phone: '416-555-0100' },
      [{ id: 3, name: 'Old Name', phone: '(416) 555-0100' }],
    )
    expect(result.decision).toBe('override')
  })

  test('site blocks only within the same billing parent and normalized address', () => {
    expect(
      classifySiteDuplicate(
        { name: 'Store', street: '1 Main St', city: 'Toronto', customerId: 10 },
        [{ id: 4, name: 'Store', street: '1 Main Street', city: 'Toronto', parentId: 10 }],
      ).decision,
    ).toBe('block')
    expect(
      classifySiteDuplicate(
        { name: 'Store', street: '1 Main St', city: 'Toronto', customerId: 11 },
        [{ id: 4, name: 'Store', street: '1 Main Street', city: 'Toronto', parentId: 10 }],
      ).decision,
    ).toBe('override')
  })

  test('vendor blocks on name plus email and part blocks on number', () => {
    expect(
      classifyVendorDuplicate(
        { name: 'Vendor Co', email: 'A@Example.com' },
        [{ id: 5, name: 'Vendor Company', email: 'a@example.com' }],
      ).decision,
    ).toBe('block')
    expect(
      classifyPartDuplicate(
        { partNumber: 'ABC-1' },
        [{ id: 6, name: 'Anything', partNumber: 'abc-1' }],
      ).decision,
    ).toBe('block')
  })
})
