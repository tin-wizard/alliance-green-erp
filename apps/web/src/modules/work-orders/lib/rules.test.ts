import { describe, expect, test } from 'vitest'
import {
  businessToday,
  calcTypeFor,
  evaluateWsibGate,
  invoiceImmutable,
  isOverdue,
  matchesView,
  requiresSubcontractor,
  triageColumns,
  triageFromColumns,
  validWsibDocument,
} from './rules'

describe('views', () => {
  const today = '2026-11-11'

  test('overdue counts open work only', () => {
    expect(isOverdue(1, '2026-11-10', today)).toBe(true)
    expect(isOverdue(1, '2026-11-11', today)).toBe(false)
    expect(isOverdue(11, '2026-01-01', today)).toBe(false)
    expect(isOverdue(1, null, today)).toBe(false)
  })

  test('missing WSIB requires an assigned subcontractor without a valid document', () => {
    const base = { status: 1 as const, expectedCompletion: null, subcontractorId: 10 }
    expect(matchesView('missing_wsib', { ...base, wsibValid: false }, today)).toBe(true)
    expect(matchesView('missing_wsib', { ...base, wsibValid: true }, today)).toBe(false)
    expect(
      matchesView(
        'missing_wsib',
        { ...base, subcontractorId: null, wsibValid: false },
        today,
      ),
    ).toBe(false)
  })

  test('invoiced view only contains status 11', () => {
    expect(
      matchesView(
        'invoiced',
        { status: 11, expectedCompletion: null, subcontractorId: null, wsibValid: true },
        today,
      ),
    ).toBe(true)
    expect(
      matchesView(
        'invoiced',
        { status: 2, expectedCompletion: null, subcontractorId: null, wsibValid: true },
        today,
      ),
    ).toBe(false)
  })
})

describe('WSIB gate', () => {
  const today = '2026-11-11'

  test('valid only when unexpired and not flagged', () => {
    expect(validWsibDocument([], today)).toBeNull()
    expect(
      validWsibDocument(
        [{ documentType: 'WSIB', expirationDate: '2026-11-10', isExpired: 0 }],
        today,
      ),
    ).toBeNull()
    expect(
      validWsibDocument(
        [{ documentType: 'WSIB', expirationDate: '2026-11-11', isExpired: 0 }],
        today,
      ),
    ).not.toBeNull()
    expect(
      validWsibDocument(
        [{ documentType: 'WSIB', expirationDate: '2027-01-01', isExpired: 1 }],
        today,
      ),
    ).toBeNull()
  })

  test('blocks assignment without a document unless the scoped override is held', () => {
    expect(
      evaluateWsibGate({
        subcontractorId: 5,
        wsibValid: false,
        overrideRequested: true,
        hasOverridePermission: false,
      }).allowed,
    ).toBe(false)
    expect(
      evaluateWsibGate({
        subcontractorId: 5,
        wsibValid: false,
        overrideRequested: true,
        hasOverridePermission: true,
      }),
    ).toEqual({ allowed: true, overrideUsed: true, reason: null })
  })

  test('no subcontractor needs no document', () => {
    expect(
      evaluateWsibGate({
        subcontractorId: null,
        wsibValid: false,
        overrideRequested: false,
        hasOverridePermission: false,
      }).allowed,
    ).toBe(true)
  })
})

describe('other rules', () => {
  test('calc_type follows the local/project flags', () => {
    expect(calcTypeFor({ isLocal: false, isProject: false })).toBe('sub')
    expect(calcTypeFor({ isLocal: false, isProject: true })).toBe('sub_project')
    expect(calcTypeFor({ isLocal: true, isProject: false })).toBe('local')
    expect(calcTypeFor({ isLocal: true, isProject: true })).toBe('local_project')
  })

  test('invoice immutability follows the Sage and stock flags', () => {
    expect(
      invoiceImmutable({ sageSalesDone: false, stockUpdated: false, onlyPortalStockUpdated: false }),
    ).toBe(false)
    expect(
      invoiceImmutable({ sageSalesDone: true, stockUpdated: false, onlyPortalStockUpdated: false }),
    ).toBe(true)
  })

  test('dispatch requires a subcontractor', () => {
    expect(requiresSubcontractor(7)).toBe(true)
    expect(requiresSubcontractor(2)).toBe(false)
  })

  test('triage columns round-trip', () => {
    expect(
      triageFromColumns({ isMarkedRed: true, isMarkedGreen: false, isMarkedCritical: true }),
    ).toEqual(['red', 'critical'])
    expect(triageColumns(['green'])).toEqual({
      isMarkedRed: false,
      isMarkedGreen: true,
      isMarkedCritical: false,
    })
  })

  test('business date is an ISO day', () => {
    expect(businessToday(new Date('2026-11-11T15:00:00Z'))).toBe('2026-11-11')
  })
})
