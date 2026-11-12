/**
 * Cutover mode, one fixture per documented quirk and one per phase rule.
 *
 * The rule these tests protect: a documented legacy defect is *classified* and
 * signed, and anything else stays a blocker. A classifier that is too forgiving
 * hides money; one that is too strict blocks the cutover on known history.
 */
import { describe, expect, test } from 'vitest'
import {
  QUIRK_NOTES,
  TAX_QUIRKS,
  classifyTaxDifference,
  evaluateCutover,
  type BaselineDocument,
  type CutoverBaseline,
  type CutoverReading,
} from './cutover'

function document(overrides: Partial<BaselineDocument> = {}): BaselineDocument {
  return {
    externalRef: 's50:sales_invoice:1',
    docType: 'sales_invoice',
    period: '2026-09',
    contactRef: 's50-contact:1',
    subtotalCents: 10_000,
    taxCents: 1_300,
    totalCents: 11_300,
    ...overrides,
  }
}

function reading(overrides: Partial<CutoverReading> = {}): CutoverReading {
  return {
    externalRef: 's50:sales_invoice:1',
    totalCents: 11_300,
    taxCents: 1_300,
    netCents: 10_000,
    allocatedCents: 0,
    outstandingCents: 11_300,
    contactId: 'ledger-contact-1',
    ...overrides,
  }
}

function baseline(overrides: Partial<CutoverBaseline> = {}): CutoverBaseline {
  return {
    snapshotId: 'snap-1',
    capturedAt: '2026-11-12T09:00:00Z',
    capturedBy: 'finance-owner',
    source: 's50-extract:2026-11-12',
    verifiedQueries: ['q1', 'q2', 'q3'],
    documents: [document()],
    receivables: [{ contactRef: 's50-contact:1', cents: 11_300 }],
    payables: [],
    ...overrides,
  }
}

describe('classifyTaxDifference', () => {
  test('a matching tax is clean', () => {
    const result = classifyTaxDifference({
      docType: 'sales_invoice',
      subtotalCents: 10_000,
      legacyTaxCents: 500,
      actualTaxCents: 500,
    })
    expect(result.quirk).toBeNull()
    expect(result.differenceCents).toBe(0)
  })

  test('quirk 1: legacy 13% on a 5% document is HARDCODED_13_PERCENT_LOCAL_LINES', () => {
    const result = classifyTaxDifference({
      docType: 'sales_invoice',
      subtotalCents: 10_000,
      legacyTaxCents: 1_300, // 13% hard-coded
      actualTaxCents: 500, // the tenant's 5%
    })
    expect(result.quirk).toBe('HARDCODED_13_PERCENT_LOCAL_LINES')
    expect(result.tolerated).toBe(true)
    expect(result.differenceCents).toBe(-800)
    expect(result.reason).toBe(QUIRK_NOTES.HARDCODED_13_PERCENT_LOCAL_LINES)
  })

  test('quirk 4: a multi-authority purchase differing by a few cents is PURCHASE_RATE_SPLIT', () => {
    const result = classifyTaxDifference({
      docType: 'purchase_invoice',
      subtotalCents: 200_000,
      legacyTaxCents: 23_998,
      actualTaxCents: 24_001,
      multiAuthority: true,
    })
    expect(result.quirk).toBe('PURCHASE_RATE_SPLIT')
  })

  test('quirk 5: a one-cent difference is ONE_CENT_CORRECTION', () => {
    const result = classifyTaxDifference({
      docType: 'sales_invoice',
      subtotalCents: 102_019_615,
      legacyTaxCents: 13_262_849,
      actualTaxCents: 13_262_850,
    })
    expect(result.quirk).toBe('ONE_CENT_CORRECTION')
  })

  test('an unexplained tax difference stays a blocker', () => {
    const result = classifyTaxDifference({
      docType: 'sales_invoice',
      subtotalCents: 10_000,
      legacyTaxCents: 1_000,
      actualTaxCents: 1_137,
    })
    expect(result.quirk).toBeNull()
    expect(result.tolerated).toBe(false)
    expect(result.differenceCents).toBe(137)
  })

  test('a single-authority purchase difference of a few cents is not excused', () => {
    const result = classifyTaxDifference({
      docType: 'purchase_invoice',
      subtotalCents: 200_000,
      legacyTaxCents: 23_998,
      actualTaxCents: 24_001,
    })
    expect(result.quirk).toBeNull()
  })
})

describe('evaluateCutover — document phase', () => {
  test('a matching document passes and the month totals agree', () => {
    const evaluation = evaluateCutover({ phase: 'documents', baseline: baseline(), readings: [reading()] })
    expect(evaluation.findings).toEqual([])
    expect(evaluation.passable).toBe(true)
    expect(evaluation.divergenceTotalCents).toBe(0)
    expect(evaluation.months[0]).toMatchObject({
      period: '2026-09',
      documents: 1,
      legacyTotalCents: 11_300,
      ledgerTotalCents: 11_300,
    })
  })

  test('a missing document is a blocker', () => {
    const evaluation = evaluateCutover({ phase: 'documents', baseline: baseline(), readings: [] })
    expect(evaluation.findings.map((finding) => finding.code)).toEqual(['MISSING_IN_SAGE'])
    expect(evaluation.passable).toBe(false)
  })

  test('the 13% quirk is recorded and totalled, not blocked', () => {
    const evaluation = evaluateCutover({
      phase: 'documents',
      baseline: baseline(),
      readings: [reading({ totalCents: 10_500, taxCents: 500, netCents: 10_000 })],
    })
    expect(evaluation.findings.map((finding) => finding.code)).toEqual(['TAX_QUIRK'])
    expect(evaluation.findings[0]?.severity).toBe('warning')
    expect(evaluation.divergenceTotalCents).toBe(800)
    expect(evaluation.quirkCounts.HARDCODED_13_PERCENT_LOCAL_LINES).toBe(1)
    expect(evaluation.months[0]?.quirkCents).toBe(800)
    expect(evaluation.months[0]?.unexplainedCents).toBe(0)
  })

  test('a net change beyond the tax difference is AMOUNT_MISMATCH even when the tax is a known quirk', () => {
    const evaluation = evaluateCutover({
      phase: 'documents',
      baseline: baseline(),
      readings: [reading({ netCents: 9_900, totalCents: 10_400, taxCents: 500 })],
    })
    expect(evaluation.findings.map((finding) => finding.code)).toEqual([
      'TAX_QUIRK',
      'AMOUNT_MISMATCH',
    ])
    expect(evaluation.passable).toBe(false)
  })

  test('a zero-tax document that only exists in the ledger is ZERO_TAX_ADDITION, not an orphan', () => {
    const evaluation = evaluateCutover({
      phase: 'documents',
      baseline: baseline(),
      readings: [reading()],
      ledgerOnly: [
        {
          externalRef: 's50:sales_invoice:99',
          totalCents: 5_000,
          taxCents: 0,
          netCents: 5_000,
        },
      ],
    })
    expect(evaluation.findings).toEqual([])
    expect(evaluation.quirkCounts.ZERO_TAX_ADDITION).toBe(1)
    expect(evaluation.quirkCounts.TTAXDTL_RATE_13).toBe(0)
  })

  test('a ledger-only document with tax is ORPHAN_IN_SAGE', () => {
    const evaluation = evaluateCutover({
      phase: 'documents',
      baseline: baseline(),
      readings: [reading()],
      ledgerOnly: [
        { externalRef: 's50:sales_invoice:98', totalCents: 5_650, taxCents: 650, netCents: 5_000 },
      ],
    })
    expect(evaluation.findings.map((finding) => finding.code)).toEqual(['ORPHAN_IN_SAGE'])
  })

  test('a source-settled document makes the document run fail until allocations exist', () => {
    const evaluation = evaluateCutover({
      phase: 'documents',
      baseline: baseline({ documents: [document({ settledInSource: true })] }),
      readings: [reading({ outstandingCents: 11_300 })],
    })
    expect(evaluation.allocationsPending).toBe(1)
    expect(evaluation.passable).toBe(false)
    // It is not a blocker finding: the state is expected, the verdict is not.
    expect(evaluation.findings).toEqual([])
  })

  test('every quirk kind has a written note, so the report can explain each count', () => {
    expect(Object.keys(QUIRK_NOTES).sort()).toEqual([...TAX_QUIRKS].sort())
    for (const quirk of TAX_QUIRKS) {
      expect(QUIRK_NOTES[quirk].length).toBeGreaterThan(30)
    }
  })
})

describe('evaluateCutover — allocation phase', () => {
  test('a settled document with an allocation passes, and the balance matches', () => {
    const evaluation = evaluateCutover({
      phase: 'allocations',
      baseline: baseline({
        documents: [document({ settledInSource: true, allocatedInSourceCents: 11_300 })],
        receivables: [{ contactRef: 's50-contact:1', cents: 0 }],
      }),
      readings: [
        reading({ allocatedCents: 11_300, outstandingCents: 0 }),
      ],
      contactMap: { 's50-contact:1': 'ledger-contact-1' },
    })
    expect(evaluation.findings).toEqual([])
    expect(evaluation.allocationsPending).toBe(0)
    expect(evaluation.passable).toBe(true)
  })

  test('a settled document still outstanding is a balance blocker in this phase', () => {
    const evaluation = evaluateCutover({
      phase: 'allocations',
      baseline: baseline({
        documents: [document({ settledInSource: true })],
        receivables: [{ contactRef: 's50-contact:1', cents: 0 }],
      }),
      readings: [reading({ allocatedCents: 0, outstandingCents: 11_300 })],
      contactMap: { 's50-contact:1': 'ledger-contact-1' },
    })
    expect(evaluation.passable).toBe(false)
    const codes = evaluation.findings.map((finding) => finding.code)
    expect(codes).toContain('BALANCE_MISMATCH')
    expect(evaluation.balanceDifferences).toEqual([
      { contactRef: 's50-contact:1', expectedCents: 0, actualCents: 11_300 },
    ])
  })

  test('an allocation short of the source amount is a blocker even when outstanding is zero', () => {
    const evaluation = evaluateCutover({
      phase: 'allocations',
      baseline: baseline({
        documents: [document({ settledInSource: true, allocatedInSourceCents: 11_300 })],
        receivables: [{ contactRef: 's50-contact:1', cents: 0 }],
      }),
      readings: [reading({ allocatedCents: 10_000, outstandingCents: 0 })],
      contactMap: { 's50-contact:1': 'ledger-contact-1' },
    })
    const mismatch = evaluation.findings.find((finding) => finding.code === 'BALANCE_MISMATCH')
    expect(mismatch?.detail.reason).toContain('allocations do not equal')
    expect(evaluation.passable).toBe(false)
  })

  test('an open balance is judged against the quirk-adjusted source amount', () => {
    const evaluation = evaluateCutover({
      phase: 'allocations',
      baseline: baseline({
        // Legacy 113.00 open; converted at 5% is 105.00, so the quirk is 8.00.
        receivables: [{ contactRef: 's50-contact:1', cents: 11_300 }],
      }),
      readings: [reading({ totalCents: 10_500, taxCents: 500, netCents: 10_000, allocatedCents: 0, outstandingCents: 10_500 })],
      contactMap: { 's50-contact:1': 'ledger-contact-1' },
    })
    expect(evaluation.findings.filter((finding) => finding.code === 'BALANCE_MISMATCH')).toEqual([])
    expect(evaluation.balanceDifferences).toEqual([])
    expect(evaluation.divergenceTotalCents).toBe(800)
  })

  test('a baseline contact with no row-map entry is reported, not assumed zero', () => {
    const evaluation = evaluateCutover({
      phase: 'allocations',
      baseline: baseline({ receivables: [{ contactRef: 's50-contact:404', cents: 4_500 }] }),
      readings: [reading({ allocatedCents: 11_300, outstandingCents: 0 })],
    })
    expect(evaluation.findings.map((finding) => finding.code)).toContain(
      'BALANCE_ROLLFORWARD_UNAVAILABLE',
    )
  })
})
