/**
 * The six checks, one fixture per finding code.
 *
 * These are the acceptance cases in `SAGE-RECONCILIATION.md` §10, at the level
 * where they are decidable: rows in, findings out, no database and no socket.
 */
import { describe, expect, test } from 'vitest'
import {
  checkAmounts,
  checkBalances,
  checkExternalChanges,
  checkLinkIntegrity,
  checkQueueHealth,
  checkTaxPeriods,
} from './checks'
import { summariseRun } from './summary'
import { severityFor, type Finding } from './types'
import type { DocumentComparison, PostingRow } from './checks'

const NOW = new Date('2026-11-11T11:00:00Z')
const HOUR = 60 * 60 * 1000

function posting(overrides: Partial<PostingRow> = {}): PostingRow {
  return {
    docType: 'sales_invoice',
    docId: '101',
    externalRef: 'cls:sales_invoice:101',
    status: 'sent',
    attempts: 1,
    updatedAt: new Date(NOW.getTime() - 4 * HOUR),
    ...overrides,
  }
}

function document(overrides: Partial<DocumentComparison> = {}): DocumentComparison {
  return {
    docType: 'sales_invoice',
    docId: '101',
    externalRef: 'cls:sales_invoice:101',
    apiId: 'sdi-1',
    expected: { totalCents: 11_300, taxCents: 1_300, netCents: 10_000 },
    actual: { totalCents: 11_300, taxCents: 1_300, netCents: 10_000 },
    ...overrides,
  }
}

describe('§4.1 link integrity', () => {
  test('a sent posting with no link row is MISSING_IN_SAGE; linking clears it', () => {
    const withoutLink = checkLinkIntegrity({ postings: [posting()], links: [], now: NOW })
    expect(withoutLink.findings).toHaveLength(1)
    expect(withoutLink.findings[0]?.code).toBe('MISSING_IN_SAGE')
    expect(withoutLink.findings[0]?.severity).toBe('blocker')
    expect(withoutLink.findings[0]?.externalRef).toBe('cls:sales_invoice:101')

    const linked = checkLinkIntegrity({
      postings: [posting()],
      links: [
        {
          docType: 'sales_invoice',
          docId: '101',
          externalRef: 'cls:sales_invoice:101',
          apiId: 'sdi-1',
        },
      ],
      now: NOW,
    })
    expect(linked.findings).toEqual([])
  })

  test('a timed-out POST stays visible as STUCK_POSTING, and becomes a blocker after four attempts', () => {
    const stale = new Date(NOW.getTime() - 3 * HOUR)
    const early = checkLinkIntegrity({
      postings: [posting({ status: 'unknown', attempts: 1, updatedAt: stale })],
      links: [],
      now: NOW,
    })
    expect(early.findings.map((finding) => finding.code)).toEqual(['STUCK_POSTING'])
    expect(early.findings[0]?.severity).toBe('warning')

    const late = checkLinkIntegrity({
      postings: [posting({ status: 'queued', attempts: 4, updatedAt: stale })],
      links: [],
      now: NOW,
    })
    expect(late.findings[0]?.severity).toBe('blocker')
    expect(severityFor('STUCK_POSTING', { attempts: 4 })).toBe('blocker')
  })

  test('a fresh queued posting is not stuck', () => {
    const result = checkLinkIntegrity({
      postings: [posting({ status: 'queued', updatedAt: NOW })],
      links: [],
      now: NOW,
    })
    expect(result.findings).toEqual([])
  })

  test('two links pointing at one Sage document is DUPLICATE_IN_SAGE', () => {
    const result = checkLinkIntegrity({
      postings: [],
      links: [
        { docType: 'sales_invoice', docId: '101', externalRef: 'cls:sales_invoice:101', apiId: 'sdi-1' },
        { docType: 'sales_invoice', docId: '102', externalRef: 'cls:sales_invoice:102', apiId: 'sdi-1' },
      ],
      now: NOW,
    })
    expect(result.findings.map((finding) => finding.code)).toEqual(['DUPLICATE_IN_SAGE'])
  })
})

describe('§4.2 amounts', () => {
  test('one cent of total difference is AMOUNT_MISMATCH, with both values reported', () => {
    const result = checkAmounts({
      documents: [
        document({ actual: { totalCents: 11_299, taxCents: 1_300, netCents: 9_999 } }),
      ],
    })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      code: 'AMOUNT_MISMATCH',
      severity: 'blocker',
      expectedCents: 11_300,
      actualCents: 11_299,
    })
    expect(result.findings[0]?.detail.field).toBe('total_amount')
  })

  test('a tax difference is TAX_MISMATCH, separately from the total', () => {
    const result = checkAmounts({
      documents: [document({ actual: { totalCents: 11_300, taxCents: 1_200, netCents: 10_100 } })],
    })
    expect(result.findings.map((finding) => finding.code)).toEqual(['TAX_MISMATCH'])
  })

  test('an unreadable amount is skipped rather than invented', () => {
    const result = checkAmounts({
      documents: [document({ actual: { totalCents: null, taxCents: null, netCents: null } })],
    })
    expect(result.findings).toEqual([])
    expect(result.checked).toBe(1)
  })
})

describe('§4.3 balances', () => {
  test('a missing roll-forward is BALANCE_ROLLFORWARD_UNAVAILABLE, not a pass', () => {
    const result = checkBalances({
      contacts: [{ contactId: 'c-1', expectedCents: null, actualCents: 5_000, source: 'no-mapping' }],
    })
    expect(result.findings.map((finding) => finding.code)).toEqual(['BALANCE_ROLLFORWARD_UNAVAILABLE'])
    expect(result.findings[0]?.severity).toBe('warning')
  })

  test('a balance difference is BALANCE_MISMATCH for finance, with the difference', () => {
    const result = checkBalances({
      contacts: [{ contactId: 'c-1', expectedCents: 50_000, actualCents: 54_500, source: 'sage-documents' }],
    })
    expect(result.findings[0]).toMatchObject({
      code: 'BALANCE_MISMATCH',
      owner: 'finance',
      expectedCents: 50_000,
      actualCents: 54_500,
    })
    expect(result.findings[0]?.detail.differenceCents).toBe(4_500)
  })
})

describe('§4.4 external changes', () => {
  test('a deleted document is DELETED_IN_SAGE and produces no re-post instruction', () => {
    const result = checkExternalChanges({
      events: [{ kind: 'deleted', apiId: 'sdi-9', externalRef: 'cls:sales_invoice:101' }],
    })
    expect(result.findings.map((finding) => finding.code)).toEqual(['DELETED_IN_SAGE'])
    // The finding carries what changed; it never carries a payload to re-send.
    expect(JSON.stringify(result.findings[0])).not.toContain('post')
    expect(result.findings[0]?.detail).toEqual({ apiId: 'sdi-9' })
  })

  test('orphan, external change and unmatched payment each get their own code', () => {
    const result = checkExternalChanges({
      events: [
        { kind: 'matched', apiId: 'sdi-1' },
        { kind: 'changed', apiId: 'sdi-2', externalRef: 'cls:sales_invoice:102', field: 'total_amount' },
        { kind: 'orphan', apiId: 'sdi-3', externalRef: 'cls:sales_invoice:103' },
        { kind: 'payment_unmatched', contactId: 'c-7', externalRef: 'cls:contact_payment:44' },
      ],
    })
    expect(result.findings.map((finding) => finding.code)).toEqual([
      'EXTERNAL_CHANGE',
      'ORPHAN_IN_SAGE',
      'PAYMENT_UNMATCHED',
    ])
    expect(result.findings[0]?.detail).toEqual({ apiId: 'sdi-2', field: 'total_amount' })
  })
})

describe('§4.5 tax periods', () => {
  test('a monthly tax difference over a dollar is a blocker; a cent is a warning', () => {
    const big = checkTaxPeriods({
      // $20 short: over the hundred-cent line, so a blocker.
      periods: [{ period: '2026-10', rateId: 'all', expectedCents: 130_000, actualCents: 128_000 }],
    })
    expect(big.findings[0]?.code).toBe('TAX_PERIOD_MISMATCH')
    expect(big.findings[0]?.severity).toBe('blocker')
    expect(big.findings[0]?.detail.differenceCents).toBe(-2_000)

    const small = checkTaxPeriods({
      periods: [{ period: '2026-10', rateId: 'all', expectedCents: 130_000, actualCents: 130_001 }],
    })
    expect(small.findings[0]?.severity).toBe('warning')
  })

  test('a matching month is silent', () => {
    expect(
      checkTaxPeriods({
        periods: [{ period: '2026-10', rateId: 'all', expectedCents: 130_000, actualCents: 130_000 }],
      }).findings,
    ).toEqual([])
  })
})

describe('§4.6 queue health', () => {
  test('ten stale queued postings is QUEUE_BACKLOG, nine is not', () => {
    const stale = Array.from({ length: 10 }, (_, index) =>
      posting({ docId: String(index), externalRef: `cls:sales_invoice:${index}`, status: 'queued', updatedAt: new Date(NOW.getTime() - 3 * HOUR) }),
    )
    const result = checkQueueHealth({
      postings: stale,
      quota: { used: 0, limit: 2_500 },
      connection: { state: 'verified', daysSinceRefresh: 1 },
      now: NOW,
    })
    expect(result.findings.map((finding) => finding.code)).toEqual(['QUEUE_BACKLOG'])
    expect(result.findings[0]?.detail.count).toBe(10)

    const below = checkQueueHealth({
      postings: stale.slice(0, 9),
      quota: { used: 0, limit: 2_500 },
      connection: { state: 'verified', daysSinceRefresh: 1 },
      now: NOW,
    })
    expect(below.findings).toEqual([])
  })

  test('quota at 80% warns, at 98% blocks non-posting work', () => {
    const near = checkQueueHealth({
      postings: [],
      quota: { used: 2_000, limit: 2_500 },
      connection: { state: 'verified', daysSinceRefresh: 1 },
      now: NOW,
    })
    expect(near.findings.map((finding) => finding.code)).toEqual(['QUOTA_NEAR_LIMIT'])

    const spent = checkQueueHealth({
      postings: [],
      quota: { used: 2_450, limit: 2_500 },
      connection: { state: 'verified', daysSinceRefresh: 1 },
      now: NOW,
    })
    expect(spent.findings.map((finding) => finding.code)).toEqual(['QUOTA_EXHAUSTED'])
  })

  test('reauth is a blocker, and a token 21 days old is too', () => {
    const reauth = checkQueueHealth({
      postings: [],
      quota: { used: 0, limit: 2_500 },
      connection: { state: 'needs_reauth', daysSinceRefresh: null },
      now: NOW,
    })
    expect(reauth.findings.map((finding) => finding.code)).toEqual(['REAUTH_REQUIRED'])

    const stale = checkQueueHealth({
      postings: [],
      quota: { used: 0, limit: 2_500 },
      connection: { state: 'verified', daysSinceRefresh: 21 },
      now: NOW,
    })
    expect(stale.findings.map((finding) => finding.code)).toEqual(['TOKEN_STALE'])
    expect(stale.findings[0]?.severity).toBe('blocker')
  })
})

describe('run summary', () => {
  function finding(severity: 'blocker' | 'warning'): Finding {
    return {
      code: severity === 'blocker' ? 'DELETED_IN_SAGE' : 'QUEUE_BACKLOG',
      severity,
      owner: 'platform',
      detail: {},
    }
  }

  test('a blocker fails the run', () => {
    const summary = summariseRun({ findings: [finding('blocker')], checked: 3 })
    expect(summary.status).toBe('failed')
    expect(summary.blockers).toBe(1)
  })

  test('warnings pass their own run and fail the next one while undecided', () => {
    const ownRun = summariseRun({ findings: [finding('warning')], checked: 3 })
    expect(ownRun.status).toBe('passed')

    const nextRun = summariseRun({
      findings: [],
      checked: 3,
      undecidedPreviousWarnings: 1,
    })
    expect(nextRun.status).toBe('failed')
    expect(nextRun.reason).toContain('undecided')
  })

  test('a check that could not run reports error, never passed', () => {
    const summary = summariseRun({
      findings: [],
      checked: 0,
      error: 'Sage unreachable: connect ETIMEDOUT',
    })
    expect(summary.status).toBe('error')
    expect(summary.reason).toContain('ETIMEDOUT')
  })
})
