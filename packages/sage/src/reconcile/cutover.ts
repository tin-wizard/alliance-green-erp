/**
 * Cutover mode (SAGE-RECONCILIATION §8): the same money, against the signed
 * legacy baseline instead of our own posting history.
 *
 * Two differences from the daily checks, both deliberate:
 *
 * - **The baseline is evidence, not a target.** Where the legacy's arithmetic
 *   and the ledger's disagree for one of the five documented reasons
 *   (SAGE50-MIGRATION §6.5), the difference is *classified*, counted, and added
 *   to a divergence total the finance owner signs. It is never normalised away
 *   and never silently reproduced.
 * - **The phase decides what "pass" means.** After the document pass, documents
 *   exist and nothing is paid: if the source ageing says a document is settled,
 *   that run must fail until the allocation pass has run. After the allocation
 *   pass, a settled document with money outstanding is a blocker.
 */
import type { Finding } from './types'
import { findingFor } from './types'

export type CutoverPhase = 'documents' | 'allocations'

/** The five quirks in SAGE50-MIGRATION §6.5, in the order that doc lists them. */
export const TAX_QUIRKS = [
  'HARDCODED_13_PERCENT_LOCAL_LINES',
  'ZERO_TAX_ADDITION',
  'TTAXDTL_RATE_13',
  'PURCHASE_RATE_SPLIT',
  'ONE_CENT_CORRECTION',
] as const

export type TaxQuirk = (typeof TAX_QUIRKS)[number]

/**
 * Two quirks never move money, and saying so is part of classifying them:
 * a zero-tax document is an addition (none exist in the legacy), and
 * `ttaxdtl.dRate = 13` makes grouping by the source rate meaningless, so the
 * report groups by period and tenant rate instead.
 */
export const QUIRK_NOTES: Record<TaxQuirk, string> = {
  HARDCODED_13_PERCENT_LOCAL_LINES:
    'Legacy computed local lines at 13% regardless of province; the converted document uses the tenant rate. Recorded as a signed divergence.',
  ZERO_TAX_ADDITION:
    'Legacy could not post a zero-tax sale; these documents exist only in the cloud ledger. An addition, not a difference.',
  TTAXDTL_RATE_13:
    'Legacy wrote rate 13 and authority 1 into sales tax detail for every document, so grouping by source rate is meaningless. Grouped by period and tenant rate.',
  PURCHASE_RATE_SPLIT:
    'Legacy billed BC parts at 5% + 7% PST and labour at a flat 5%; the conversion uses one configured rate per line. A few cents per document, recorded.',
  ONE_CENT_CORRECTION:
    'Legacy subtracted one cent from one historical document (work order 73850). Not reproduced and not corrected back.',
}

/** One document as the signed Sage 50 extract reports it. */
export interface BaselineDocument {
  externalRef: string
  docType: string
  /** `YYYY-MM`, the month the extract files it under. */
  period: string
  contactRef?: string
  subtotalCents: number
  taxCents: number
  totalCents: number
  /** The source ageing says this document is paid. */
  settledInSource?: boolean
  /** What the source says was received against it, when it was. */
  allocatedInSourceCents?: number
  /** True when the source document carries more than one tax authority. */
  multiAuthority?: boolean
}

/**
 * The signed baseline: the extract plus the three reports §8 asks for. The
 * harness writes it; the rehearsal script builds one from dev data with the
 * quirks injected.
 */
export interface CutoverBaseline {
  snapshotId: string
  capturedAt: string
  capturedBy: string
  source: string
  /** The three live-file VERIFY queries, recorded before the baseline was taken. */
  verifiedQueries: string[]
  documents: BaselineDocument[]
  receivables: { contactRef: string; cents: number }[]
  payables: { contactRef: string; cents: number }[]
}

/** What the ledger says about one document, read from the API. */
export interface CutoverReading {
  externalRef: string
  totalCents: number | null
  taxCents: number | null
  netCents: number | null
  allocatedCents?: number | null
  outstandingCents?: number | null
  contactId?: string | null
}

export interface QuirkClassification {
  quirk: TaxQuirk | null
  tolerated: boolean
  differenceCents: number
  reason: string
}

const CLEAN: QuirkClassification = {
  quirk: null,
  tolerated: true,
  differenceCents: 0,
  reason: 'Agrees to the cent.',
}

/**
 * Classify one document's tax difference against the five documented quirks.
 *
 * Order matters: the 13% test is specific (it checks the legacy number was
 * produced by 13% of the net), then the multi-authority split, then the
 * one-cent correction. Anything else is unexplained and stays a blocker.
 */
export function classifyTaxDifference(input: {
  docType: string
  subtotalCents: number
  legacyTaxCents: number
  actualTaxCents: number
  multiAuthority?: boolean
}): QuirkClassification {
  const difference = input.actualTaxCents - input.legacyTaxCents
  if (difference === 0) return CLEAN

  const hardcoded13 = Math.round(input.subtotalCents * 0.13)
  if (input.legacyTaxCents === hardcoded13 && Math.abs(difference) >= 100) {
    return {
      quirk: 'HARDCODED_13_PERCENT_LOCAL_LINES',
      tolerated: true,
      differenceCents: difference,
      reason: QUIRK_NOTES.HARDCODED_13_PERCENT_LOCAL_LINES,
    }
  }

  if (input.docType.startsWith('purchase') && input.multiAuthority && Math.abs(difference) <= 10) {
    return {
      quirk: 'PURCHASE_RATE_SPLIT',
      tolerated: true,
      differenceCents: difference,
      reason: QUIRK_NOTES.PURCHASE_RATE_SPLIT,
    }
  }

  if (Math.abs(difference) === 1) {
    return {
      quirk: 'ONE_CENT_CORRECTION',
      tolerated: true,
      differenceCents: difference,
      reason: QUIRK_NOTES.ONE_CENT_CORRECTION,
    }
  }

  return {
    quirk: null,
    tolerated: false,
    differenceCents: difference,
    reason: 'Tax differs from the signed extract for no documented reason.',
  }
}

export interface CutoverMonth {
  period: string
  documents: number
  legacyTotalCents: number
  ledgerTotalCents: number
  /** Tolerated, signed differences in this month. */
  quirkCents: number
  /** Differences that block the run. */
  unexplainedCents: number
}

export interface CutoverEvaluation {
  findings: Finding[]
  /** Sum of the tolerated tax differences: the number finance signs. */
  divergenceTotalCents: number
  quirkCounts: Record<TaxQuirk, number>
  months: CutoverMonth[]
  documentsChecked: number
  /** Settled in the source but not settled in the ledger. */
  allocationsPending: number
  balanceDifferences: { contactRef: string; expectedCents: number; actualCents: number }[]
  /** No blockers, and nothing the phase expects to have happened is missing. */
  passable: boolean
}

/**
 * Compare one phase against the baseline.
 *
 * The caller supplies the readings (ours, from the API) and, for documents that
 * exist only in the ledger, `ledgerOnly`. Balances are compared only in the
 * allocation phase: after the document pass the ledger is *expected* to show
 * unpaid documents, and the report says so by failing on `allocationsPending`
 * rather than by inventing balance differences.
 */
export function evaluateCutover(input: {
  phase: CutoverPhase
  baseline: CutoverBaseline
  readings: CutoverReading[]
  ledgerOnly?: CutoverReading[]
  /** Baseline contact ref → ledger contact id, from the harness's row map. */
  contactMap?: Record<string, string>
}): CutoverEvaluation {
  const findings: Finding[] = []
  const quirkCounts = Object.fromEntries(TAX_QUIRKS.map((quirk) => [quirk, 0])) as Record<
    TaxQuirk,
    number
  >
  const byRef = new Map(input.readings.map((reading) => [reading.externalRef, reading]))
  const months = new Map<string, CutoverMonth>()
  let divergenceTotalCents = 0
  let allocationsPending = 0
  let documentsChecked = 0
  /**
   * Tolerated quirk per contact, **signed**, for open documents only. The aged
   * report is in legacy amounts, so a contact's converted outstanding differs by
   * exactly the quirks on their unpaid documents — and by nothing else. A
   * settled document contributes no open balance on either side, whatever its
   * quirk, because the quirk was absorbed by the allocation.
   */
  const quirkDeltaByContact = new Map<string, number>()

  const monthFor = (period: string): CutoverMonth => {
    const existing = months.get(period) ?? {
      period,
      documents: 0,
      legacyTotalCents: 0,
      ledgerTotalCents: 0,
      quirkCents: 0,
      unexplainedCents: 0,
    }
    months.set(period, existing)
    return existing
  }

  for (const document of input.baseline.documents) {
    documentsChecked += 1
    const month = monthFor(document.period)
    if (month.documents === 0) month.period = document.period
    month.documents += 1
    month.legacyTotalCents += document.totalCents

    const reading = byRef.get(document.externalRef)
    if (!reading || reading.totalCents === null) {
      findings.push(
        findingFor('MISSING_IN_SAGE', {
          docType: document.docType,
          externalRef: document.externalRef,
          detail: { period: document.period, reason: 'in the signed extract, absent or unreadable in the ledger' },
        }),
      )
      continue
    }
    month.ledgerTotalCents += reading.totalCents

    const legacyTax = document.taxCents
    const actualTax = reading.taxCents ?? legacyTax
    const classified = classifyTaxDifference({
      docType: document.docType,
      subtotalCents: document.subtotalCents,
      legacyTaxCents: legacyTax,
      actualTaxCents: actualTax,
      multiAuthority: document.multiAuthority,
    })

    if (classified.quirk) {
      quirkCounts[classified.quirk] += 1
      if (classified.differenceCents !== 0) {
        divergenceTotalCents += Math.abs(classified.differenceCents)
        month.quirkCents += Math.abs(classified.differenceCents)
        if (document.contactRef && !document.settledInSource) {
          quirkDeltaByContact.set(
            document.contactRef,
            (quirkDeltaByContact.get(document.contactRef) ?? 0) + classified.differenceCents,
          )
        }
        findings.push(
          findingFor('TAX_QUIRK', {
            docType: document.docType,
            externalRef: document.externalRef,
            expectedCents: legacyTax,
            actualCents: actualTax,
            detail: {
              quirk: classified.quirk,
              reason: classified.reason,
              period: document.period,
              differenceCents: classified.differenceCents,
            },
          }),
        )
      }
    } else if (classified.differenceCents !== 0) {
      month.unexplainedCents += Math.abs(classified.differenceCents)
      findings.push(
        findingFor('TAX_MISMATCH', {
          docType: document.docType,
          externalRef: document.externalRef,
          expectedCents: legacyTax,
          actualCents: actualTax,
          detail: {
            period: document.period,
            reason: classified.reason,
            differenceCents: classified.differenceCents,
          },
          severityContext: { amountCents: Math.abs(classified.differenceCents) },
        }),
      )
    }

    // A total that differs by more than the tax difference means the net moved
    // too, which no quirk explains.
    const totalDifference = reading.totalCents - document.totalCents
    if (totalDifference !== classified.differenceCents) {
      month.unexplainedCents += Math.abs(totalDifference - classified.differenceCents)
      findings.push(
        findingFor('AMOUNT_MISMATCH', {
          docType: document.docType,
          externalRef: document.externalRef,
          expectedCents: document.totalCents,
          actualCents: reading.totalCents ?? undefined,
          detail: { period: document.period, taxDifferenceCents: classified.differenceCents },
          severityContext: { amountCents: Math.abs(totalDifference - classified.differenceCents) },
        }),
      )
    }

    if (document.settledInSource) {
      const outstanding = reading.outstandingCents ?? null
      const allocated = reading.allocatedCents ?? null
      const sourceAllocated = document.allocatedInSourceCents ?? document.totalCents

      if (input.phase === 'documents') {
        // Expected at this phase: the source says paid, the ledger says open.
        // The run must not pass; the finding says which documents wait on step 4.
        if (outstanding === null || outstanding > 0) allocationsPending += 1
      } else {
        const shortfall = (allocated ?? 0) - sourceAllocated
        if (outstanding !== null && outstanding > 0) {
          findings.push(
            findingFor('BALANCE_MISMATCH', {
              docType: document.docType,
              externalRef: document.externalRef,
              expectedCents: 0,
              actualCents: outstanding,
              detail: {
                period: document.period,
                sourceSettled: true,
                reason: 'source ageing says settled; the ledger still shows money outstanding',
              },
              severityContext: { amountCents: Math.abs(outstanding) },
            }),
          )
        }
        if (shortfall !== 0) {
          findings.push(
            findingFor('BALANCE_MISMATCH', {
              docType: document.docType,
              externalRef: document.externalRef,
              expectedCents: sourceAllocated,
              actualCents: allocated ?? 0,
              detail: { period: document.period, reason: 'allocations do not equal the source amount' },
              severityContext: { amountCents: Math.abs(shortfall) },
            }),
          )
        }
      }
    }
  }

  for (const reading of input.ledgerOnly ?? []) {
    // Documents the cloud ledger has and the source does not. A zero-tax sale is
    // the documented quirk; anything else needs a human.
    if ((reading.taxCents ?? 0) === 0) {
      quirkCounts.ZERO_TAX_ADDITION += 1
      continue
    }
    findings.push(
      findingFor('ORPHAN_IN_SAGE', {
        externalRef: reading.externalRef,
        actualCents: reading.totalCents ?? undefined,
        detail: { reason: 'in the ledger, absent from the signed extract' },
      }),
    )
  }

  // §8 step 4: after the allocation pass the aged report must match to the cent.
  const balanceDifferences: CutoverEvaluation['balanceDifferences'] = []
  if (input.phase === 'allocations') {
    const outstandingByContact = new Map<string, number>()
    for (const reading of [...input.readings, ...(input.ledgerOnly ?? [])]) {
      if (!reading.contactId) continue
      if (reading.outstandingCents === null || reading.outstandingCents === undefined) continue
      outstandingByContact.set(
        reading.contactId,
        (outstandingByContact.get(reading.contactId) ?? 0) + reading.outstandingCents,
      )
    }
    for (const [contactRef, expectedCents] of [
      ...input.baseline.receivables.map((row) => [row.contactRef, row.cents] as const),
      ...input.baseline.payables.map((row) => [row.contactRef, row.cents] as const),
    ]) {
      const ledgerContact = input.contactMap?.[contactRef]
      if (!ledgerContact) {
        if (expectedCents !== 0) {
          findings.push(
            findingFor('BALANCE_ROLLFORWARD_UNAVAILABLE', {
              contactId: contactRef,
              expectedCents,
              detail: { reason: 'no row-map entry for this legacy contact' },
            }),
          )
        }
        continue
      }
      const quirkCents = quirkDeltaByContact.get(contactRef) ?? 0
      const adjustedExpected = expectedCents + quirkCents
      const actualCents = outstandingByContact.get(ledgerContact) ?? 0
      if (actualCents === adjustedExpected) continue
      balanceDifferences.push({ contactRef, expectedCents: adjustedExpected, actualCents })
      findings.push(
        findingFor('BALANCE_MISMATCH', {
          contactId: ledgerContact,
          expectedCents: adjustedExpected,
          actualCents,
          detail: {
            contactRef,
            phase: input.phase,
            sourceExpectedCents: expectedCents,
            toleratedQuirkCents: quirkCents,
          },
          severityContext: { amountCents: Math.abs(actualCents - adjustedExpected) },
        }),
      )
    }
  }

  const blockers = findings.filter((finding) => finding.severity === 'blocker').length
  const passable = blockers === 0 && allocationsPending === 0

  return {
    findings,
    divergenceTotalCents,
    quirkCounts,
    months: [...months.values()].sort((a, b) => a.period.localeCompare(b.period)),
    documentsChecked,
    allocationsPending,
    balanceDifferences,
    passable,
  }
}
