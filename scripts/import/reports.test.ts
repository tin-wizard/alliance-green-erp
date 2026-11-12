import { describe, expect, it } from 'vitest'
import { classifyCounts } from './reports'
import { deltaValue, sameValue } from './parity'
import { EXCEPTION_CLASSES } from './exception-classes'

describe('classifyCounts', () => {
  it('is none when expected, staged and mapped agree', () => {
    expect(classifyCounts({ expected: 10, staged: 10, mapped: 10, policySkipped: 0 })).toBe('none')
  })

  it('is none when policy skips explain the mapped gap', () => {
    expect(classifyCounts({ expected: 10, staged: 10, mapped: 8, policySkipped: 2 })).toBe('none')
  })

  it('calls a smaller staged count a genuine exception, never a fixture decision', () => {
    expect(classifyCounts({ expected: 10, staged: 9, mapped: 9, policySkipped: 0 })).toBe(
      'genuine-exception',
    )
  })

  it('calls a larger staged count fixture-correct', () => {
    expect(classifyCounts({ expected: 10, staged: 12, mapped: 12, policySkipped: 0 })).toBe(
      'fixture-correct',
    )
  })

  it('does not let a policy skip hide an unexplained gap', () => {
    expect(classifyCounts({ expected: 10, staged: 10, mapped: 5, policySkipped: 2 })).toBe(
      'genuine-exception',
    )
  })
})

describe('sameValue', () => {
  it('treats equal money with different decimal places as a match', () => {
    expect(sameValue('1234.5', '1234.50')).toBe(true)
  })

  it('does not treat different numbers as a match', () => {
    expect(sameValue('1234', '1235')).toBe(false)
  })

  it('keeps null distinct from zero and from empty', () => {
    expect(sameValue(null, '0')).toBe(false)
    expect(sameValue(null, '')).toBe(false)
    expect(sameValue(null, null)).toBe(true)
  })
})

describe('deltaValue', () => {
  it('subtracts the baseline from a count', () => {
    expect(deltaValue('12', '5')).toBe('7')
  })

  it('keeps money decimals', () => {
    expect(deltaValue('15.50', '0')).toBe('15.5')
  })

  it('diffs a status histogram key by key', () => {
    expect(
      deltaValue('[{"status":"1","rows":8},{"status":"2","rows":3}]', '[{"status":"1","rows":3}]'),
    ).toBe('[{"status":"1","rows":5},{"status":"2","rows":3}]')
  })

  it('returns the raw value when it cannot diff', () => {
    expect(deltaValue('not a number', '0')).toBe('not a number')
    expect(deltaValue(null, '0')).toBeNull()
  })
})

describe('exception classes', () => {
  it('gives every class an owner and a description', () => {
    for (const [name, meta] of Object.entries(EXCEPTION_CLASSES)) {
      expect(meta.owner, name).toBeTruthy()
      expect(meta.description.length, name).toBeGreaterThan(20)
    }
  })

  it('treats placeholder work orders and dated duplicates as policy skips', () => {
    expect(EXCEPTION_CLASSES.placeholder_work_order.policySkip).toBe(true)
    expect(EXCEPTION_CLASSES.dated_duplicate_skipped.policySkip).toBe(true)
    expect(EXCEPTION_CLASSES.blank_tax.policySkip).toBe(false)
    expect(EXCEPTION_CLASSES.unbalanced_totals.owner).toBe('finance')
  })
})
