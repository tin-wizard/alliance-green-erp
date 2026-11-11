/**
 * The six checks (`SAGE-RECONCILIATION.md` §4), as pure functions.
 *
 * Each returns findings and a count of what it compared. A check never throws for
 * a data problem — a missing link is a finding, not an exception — because a run
 * must complete and produce a report even when everything is wrong.
 */
import {
  findingFor,
  type CheckResult,
  type Finding,
} from './types'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

export interface PostingRow {
  docType: string
  docId: string
  externalRef: string
  status: string
  attempts: number
  updatedAt: Date
}

export interface LinkRow {
  docType: string
  docId: string
  externalRef: string
  apiId: string
  apiTotalCents?: number | null
  apiTaxCents?: number | null
}

/** §4.1 — posted but unlinked, double-linked, or stuck. */
export function checkLinkIntegrity(input: {
  postings: PostingRow[]
  links: LinkRow[]
  now: Date
  stuckAfterMs?: number
}): CheckResult {
  const stuckAfterMs = input.stuckAfterMs ?? HOUR
  const byKey = new Map(input.links.map((link) => [`${link.docType}:${link.docId}`, link]))
  const findings: Finding[] = []
  let checked = 0

  for (const posting of input.postings) {
    checked += 1
    if (posting.status === 'sent' && !byKey.has(`${posting.docType}:${posting.docId}`)) {
      findings.push(
        findingFor('MISSING_IN_SAGE', {
          docType: posting.docType,
          docId: posting.docId,
          externalRef: posting.externalRef,
          detail: { status: posting.status, reason: 'sent without a link row' },
        }),
      )
    }
    if (
      (posting.status === 'queued' || posting.status === 'unknown') &&
      input.now.getTime() - posting.updatedAt.getTime() > stuckAfterMs
    ) {
      findings.push(
        findingFor('STUCK_POSTING', {
          docType: posting.docType,
          docId: posting.docId,
          externalRef: posting.externalRef,
          severityContext: { attempts: posting.attempts },
          detail: {
            status: posting.status,
            attempts: posting.attempts,
            ageMinutes: Math.round((input.now.getTime() - posting.updatedAt.getTime()) / 60_000),
          },
        }),
      )
    }
  }

  const seen = new Map<string, LinkRow[]>()
  for (const link of input.links) {
    const key = `${link.docType}:${link.apiId}`
    const rows = seen.get(key) ?? []
    rows.push(link)
    seen.set(key, rows)
  }
  for (const [key, rows] of seen) {
    if (rows.length < 2) continue
    findings.push(
      findingFor('DUPLICATE_IN_SAGE', {
        docType: rows[0]!.docType,
        externalRef: rows[0]!.externalRef,
        detail: { apiId: key, externalRefs: rows.map((row) => row.externalRef) },
      }),
    )
  }

  return { findings, checked }
}

export interface DocumentComparison {
  docType: string
  docId?: string
  externalRef: string
  apiId: string
  expected: { totalCents: number; taxCents: number; netCents: number }
  actual: { totalCents: number | null; taxCents: number | null; netCents: number | null }
}

/**
 * §4.2 — the ledger's amount and tax against what we sent.
 *
 * One cent is a blocker. The doc says so, and the reason is that a cent compounds
 * and it hides the real cause: the report should show the gap, not round it away.
 */
export function checkAmounts(input: { documents: DocumentComparison[] }): CheckResult {
  const findings: Finding[] = []
  let checked = 0
  for (const document of input.documents) {
    checked += 1
    const pairs: { code: 'AMOUNT_MISMATCH' | 'TAX_MISMATCH'; expected: number; actual: number | null }[] = [
      { code: 'AMOUNT_MISMATCH', expected: document.expected.totalCents, actual: document.actual.totalCents },
      { code: 'TAX_MISMATCH', expected: document.expected.taxCents, actual: document.actual.taxCents },
    ]
    for (const pair of pairs) {
      if (pair.actual === null) continue
      if (pair.expected === pair.actual) continue
      findings.push(
        findingFor(pair.code, {
          docType: document.docType,
          docId: document.docId,
          externalRef: document.externalRef,
          expectedCents: pair.expected,
          actualCents: pair.actual,
          detail: {
            apiId: document.apiId,
            field: pair.code === 'AMOUNT_MISMATCH' ? 'total_amount' : 'tax_amount',
            expectedNetCents: document.expected.netCents,
            actualNetCents: document.actual.netCents,
          },
          severityContext: { amountCents: Math.abs(pair.expected - pair.actual) },
        }),
      )
    }
  }
  return { findings, checked }
}

export interface ContactBalance {
  contactId: string
  /** Our roll-forward, in cents. Null when we cannot compute it. */
  expectedCents: number | null
  /** `outstanding_amount` from the ledger, in cents. */
  actualCents: number | null
  /** What our side was built from, so the report never overstates its evidence. */
  source: string
}

/** §4.3 — balance roll-forward. A mismatch is a conversation, never a correction. */
export function checkBalances(input: { contacts: ContactBalance[] }): CheckResult {
  const findings: Finding[] = []
  let checked = 0
  for (const contact of input.contacts) {
    checked += 1
    if (contact.expectedCents === null || contact.actualCents === null) {
      findings.push(
        findingFor('BALANCE_ROLLFORWARD_UNAVAILABLE', {
          contactId: contact.contactId,
          detail: { source: contact.source },
        }),
      )
      continue
    }
    if (contact.expectedCents === contact.actualCents) continue
    findings.push(
      findingFor('BALANCE_MISMATCH', {
        contactId: contact.contactId,
        expectedCents: contact.expectedCents,
        actualCents: contact.actualCents,
        detail: {
          source: contact.source,
          differenceCents: contact.actualCents - contact.expectedCents,
          // A mismatch on every contact at once is usually the opening load, not
          // the ledger. The app sets this flag when the same difference repeats.
          wholeLedgerSuspect: false,
        },
        severityContext: { amountCents: Math.abs(contact.actualCents - contact.expectedCents) },
      }),
    )
  }
  return { findings, checked }
}

export type ExternalEvent =
  | { kind: 'matched'; apiId: string; externalRef?: string }
  | { kind: 'changed'; apiId: string; externalRef?: string; field: string; expectedCents?: number; actualCents?: number }
  | { kind: 'orphan'; apiId: string; externalRef: string }
  | { kind: 'deleted'; apiId: string; externalRef?: string }
  | { kind: 'payment_unmatched'; contactId?: string; externalRef?: string }

/** §4.4 — the change feed. Classified events, not raw rows. */
export function checkExternalChanges(input: { events: ExternalEvent[] }): CheckResult {
  const findings: Finding[] = []
  for (const event of input.events) {
    switch (event.kind) {
      case 'matched':
        break
      case 'changed':
        findings.push(
          findingFor('EXTERNAL_CHANGE', {
            externalRef: event.externalRef,
            expectedCents: event.expectedCents,
            actualCents: event.actualCents,
            detail: { apiId: event.apiId, field: event.field },
          }),
        )
        break
      case 'orphan':
        findings.push(
          findingFor('ORPHAN_IN_SAGE', {
            externalRef: event.externalRef,
            detail: { apiId: event.apiId },
          }),
        )
        break
      case 'deleted':
        findings.push(
          findingFor('DELETED_IN_SAGE', {
            externalRef: event.externalRef,
            detail: { apiId: event.apiId },
          }),
        )
        break
      case 'payment_unmatched':
        findings.push(
          findingFor('PAYMENT_UNMATCHED', {
            contactId: event.contactId,
            externalRef: event.externalRef,
            detail: {},
          }),
        )
        break
    }
  }
  return { findings, checked: input.events.length }
}

export interface TaxPeriodComparison {
  period: string
  rateId: string
  expectedCents: number
  actualCents: number
}

/** §4.5 — tax by month and rate. The check the hard-coded 13% used to hide. */
export function checkTaxPeriods(input: { periods: TaxPeriodComparison[] }): CheckResult {
  const findings: Finding[] = []
  for (const period of input.periods) {
    if (period.expectedCents === period.actualCents) continue
    const difference = period.actualCents - period.expectedCents
    findings.push(
      findingFor('TAX_PERIOD_MISMATCH', {
        expectedCents: period.expectedCents,
        actualCents: period.actualCents,
        detail: { period: period.period, rateId: period.rateId, differenceCents: difference },
        severityContext: { amountCents: Math.abs(difference) },
      }),
    )
  }
  return { findings, checked: input.periods.length }
}

/**
 * §4.6 — queue, quota and token age. Not money, but the leading indicator: a
 * stale token or a spent quota is the reason tonight's postings will not happen.
 */
export function checkQueueHealth(input: {
  postings: PostingRow[]
  quota: { used: number; limit: number }
  connection: { state: string; daysSinceRefresh: number | null }
  now: Date
  backlogAfterMs?: number
  backlogMinimum?: number
}): CheckResult {
  const findings: Finding[] = []
  const backlogAfterMs = input.backlogAfterMs ?? 2 * HOUR
  const backlogMinimum = input.backlogMinimum ?? 10

  const backlog = input.postings.filter(
    (posting) =>
      (posting.status === 'queued' || posting.status === 'unknown') &&
      input.now.getTime() - posting.updatedAt.getTime() > backlogAfterMs,
  )
  if (backlog.length >= backlogMinimum) {
    findings.push(
      findingFor('QUEUE_BACKLOG', {
        detail: {
          count: backlog.length,
          oldestMinutes: Math.max(
            ...backlog.map((posting) =>
              Math.round((input.now.getTime() - posting.updatedAt.getTime()) / 60_000),
            ),
          ),
        },
      }),
    )
  }

  const share = input.quota.limit > 0 ? input.quota.used / input.quota.limit : 0
  if (share >= 0.98) {
    findings.push(
      findingFor('QUOTA_EXHAUSTED', {
        detail: { used: input.quota.used, limit: input.quota.limit },
        severityContext: { amountCents: 0 },
      }),
    )
  } else if (share >= 0.8) {
    findings.push(
      findingFor('QUOTA_NEAR_LIMIT', {
        detail: { used: input.quota.used, limit: input.quota.limit, percent: Math.round(share * 100) },
      }),
    )
  }

  if (input.connection.state === 'needs_reauth') {
    findings.push(findingFor('REAUTH_REQUIRED', { detail: { state: input.connection.state } }))
  }
  const days = input.connection.daysSinceRefresh
  if (days !== null && days >= 14) {
    findings.push(
      findingFor('TOKEN_STALE', {
        detail: { daysSinceRefresh: days },
        severityContext: { daysSinceRefresh: days },
      }),
    )
  }

  return { findings, checked: input.postings.length }
}

export { DAY }
